// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title StateProofStore — The Neural Mesh's shared memory (production)
/// @notice Stores, indexes, and serves ZK state proofs from all connected chains.
///         Does NOT hold user assets or execute external logic.
/// @dev    Roles:
///           DEFAULT_ADMIN_ROLE — governance (register chains, set verifier)
///           SPN_ROLE           — State Proof Neurons (publish proofs)
///           OPERATOR_ROLE      — operational tasks (pause, emergency)

contract StateProofStore is AccessControl, Pausable, ReentrancyGuard {

    // ═══════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════

    bytes32 public constant SPN_ROLE      = keccak256("SPN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ═══════════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════════

    enum ChainModel { ACCOUNT_BASED, UTXO_BASED }

    struct ChainInfo {
        uint64  chainId;
        string  name;
        ChainModel model;
        uint32  avgBlockTimeMs;
        uint32  maxStalenessSeconds;
        address spn;
        bool    active;
    }

    struct StateProof {
        uint64  chainId;            // slot 1: packed (64+64+48+64 = 240 bits)
        uint64  blockHeight;
        uint48  timestamp;
        uint64  sequenceNumber;
        address publisher;          // slot 2: 160 bits
        bytes32 stateRoot;          // slot 3: 256 bits
        bytes   zkProof;            // slot 4+: dynamic
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE — packed for gas efficiency
    // ═══════════════════════════════════════════════════════════════

    /// @notice Registry of connected chains
    mapping(uint64 => ChainInfo) public chains;
    uint64[] public chainIds;
    uint256 public chainCount;

    /// @notice Latest proof per chain (hot path)
    mapping(uint64 => StateProof) internal _latestProofs;

    /// @notice Historical proofs: chainId => seq => proof
    mapping(uint64 => mapping(uint64 => StateProof)) internal _history;

    /// @notice Proof count per chain
    mapping(uint64 => uint64) public proofCount;

    /// @notice ZK verifier contract (pluggable, upgradeable)
    address public zkVerifier;

    /// @notice Minimum proof size to accept (prevents empty proof spam)
    uint256 public minProofSize = 256;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event ChainRegistered(uint64 indexed chainId, string name, address spn);
    event ChainDeactivated(uint64 indexed chainId);
    event ChainReactivated(uint64 indexed chainId);
    event ProofPublished(
        uint64 indexed chainId,
        uint64 blockHeight,
        bytes32 stateRoot,
        uint64 sequenceNumber,
        address indexed publisher
    );
    event ZKVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event MinProofSizeUpdated(uint256 oldSize, uint256 newSize);

    // ═══════════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════════

    error ChainAlreadyRegistered(uint64 chainId);
    error ChainNotActive(uint64 chainId);
    error ChainNotFound(uint64 chainId);
    error InvalidSPNAddress();
    error InvalidStaleness();
    error EmptyStateRoot();
    error ProofTooSmall(uint256 size, uint256 minimum);
    error ProofDoesNotAdvance(uint64 currentHeight, uint64 newHeight);
    error ProofVerificationFailed();
    error SequenceOutOfRange(uint64 requested, uint64 max);
    error NoProofAvailable(uint64 chainId);

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(address admin, address zkVerifier_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        zkVerifier = zkVerifier_;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CHAIN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /// @notice Register a new chain in the Neural Mesh
    function registerChain(
        uint64  chainId,
        string  calldata name,
        ChainModel model,
        uint32  avgBlockTimeMs,
        uint32  maxStalenessSeconds,
        address spn
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (chains[chainId].active) revert ChainAlreadyRegistered(chainId);
        if (spn == address(0)) revert InvalidSPNAddress();
        if (maxStalenessSeconds == 0) revert InvalidStaleness();

        chains[chainId] = ChainInfo({
            chainId: chainId,
            name: name,
            model: model,
            avgBlockTimeMs: avgBlockTimeMs,
            maxStalenessSeconds: maxStalenessSeconds,
            spn: spn,
            active: true
        });

        chainIds.push(chainId);
        chainCount++;

        // Grant SPN_ROLE to the SPN address
        _grantRole(SPN_ROLE, spn);

        emit ChainRegistered(chainId, name, spn);
    }

    /// @notice Deactivate a chain (stops accepting proofs)
    function deactivateChain(uint64 chainId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        ChainInfo storage chain_ = chains[chainId];
        if (!chain_.active) revert ChainNotActive(chainId);

        chain_.active = false;
        _revokeRole(SPN_ROLE, chain_.spn);

        emit ChainDeactivated(chainId);
    }

    /// @notice Reactivate a previously deactivated chain
    function reactivateChain(uint64 chainId, address newSpn)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        ChainInfo storage chain_ = chains[chainId];
        if (bytes(chain_.name).length == 0) revert ChainNotFound(chainId);
        if (newSpn == address(0)) revert InvalidSPNAddress();

        chain_.active = true;
        chain_.spn = newSpn;
        _grantRole(SPN_ROLE, newSpn);

        emit ChainReactivated(chainId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  PROOF PUBLISHING
    // ═══════════════════════════════════════════════════════════════

    /// @notice Publish a new state proof (called by SPNs)
    /// @param chainId     Source chain
    /// @param blockHeight Block height of proven state
    /// @param stateRoot   Merkle root of chain state
    /// @param zkProof     ZK-SNARK proof bytes (Groth16)
    function publishProof(
        uint64  chainId,
        uint64  blockHeight,
        bytes32 stateRoot,
        bytes   calldata zkProof
    )
        external
        nonReentrant
        onlyRole(SPN_ROLE)
        whenNotPaused
    {
        // Validate chain is active
        if (!chains[chainId].active) revert ChainNotActive(chainId);

        // Validate caller is the registered SPN for this chain
        if (msg.sender != chains[chainId].spn) revert InvalidSPNAddress();

        // Validate proof structure
        if (stateRoot == bytes32(0)) revert EmptyStateRoot();
        if (zkProof.length < minProofSize) {
            revert ProofTooSmall(zkProof.length, minProofSize);
        }

        // Ensure monotonic block height advancement
        StateProof storage current = _latestProofs[chainId];
        if (current.timestamp > 0 && blockHeight <= current.blockHeight) {
            revert ProofDoesNotAdvance(current.blockHeight, blockHeight);
        }

        // Verify ZK proof
        if (!_verifyProof(chainId, blockHeight, stateRoot, zkProof)) {
            revert ProofVerificationFailed();
        }

        // Store proof
        uint64 seq = proofCount[chainId];
        StateProof memory newProof = StateProof({
            chainId: chainId,
            blockHeight: blockHeight,
            timestamp: uint48(block.timestamp),
            stateRoot: stateRoot,
            zkProof: zkProof,
            sequenceNumber: seq,
            publisher: msg.sender
        });

        _latestProofs[chainId] = newProof;
        _history[chainId][seq] = newProof;

        // Safe increment (uint64 overflow at 1.8 × 10^19 — not reachable)
        unchecked { proofCount[chainId] = seq + 1; }

        emit ProofPublished(chainId, blockHeight, stateRoot, seq, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    //  PROOF QUERIES
    // ═══════════════════════════════════════════════════════════════

    /// @notice Get latest proof for a chain
    function getLatestProof(uint64 chainId)
        external
        view
        returns (StateProof memory)
    {
        if (!chains[chainId].active) revert ChainNotActive(chainId);
        StateProof memory proof = _latestProofs[chainId];
        if (proof.timestamp == 0) revert NoProofAvailable(chainId);
        return proof;
    }

    /// @notice Get historical proof by sequence number
    function getProofBySequence(uint64 chainId, uint64 seq)
        external
        view
        returns (StateProof memory)
    {
        if (seq >= proofCount[chainId]) {
            revert SequenceOutOfRange(seq, proofCount[chainId]);
        }
        return _history[chainId][seq];
    }

    /// @notice Seconds since latest proof was published
    function getProofAge(uint64 chainId) external view returns (uint256) {
        StateProof memory proof = _latestProofs[chainId];
        if (proof.timestamp == 0) return type(uint256).max;
        return block.timestamp - proof.timestamp;
    }

    /// @notice Whether the latest proof is within the chain's staleness window
    function isProofFresh(uint64 chainId) external view returns (bool) {
        StateProof memory proof = _latestProofs[chainId];
        if (proof.timestamp == 0) return false;
        return (block.timestamp - proof.timestamp) <= chains[chainId].maxStalenessSeconds;
    }

    /// @notice Get the latest state root for a chain (convenience)
    function getStateRoot(uint64 chainId) external view returns (bytes32) {
        StateProof memory proof = _latestProofs[chainId];
        if (proof.timestamp == 0) revert NoProofAvailable(chainId);
        return proof.stateRoot;
    }

    /// @notice Get all registered chain IDs
    function getAllChainIds() external view returns (uint64[] memory) {
        return chainIds;
    }

    // ═══════════════════════════════════════════════════════════════
    //  ZK VERIFICATION (internal)
    // ═══════════════════════════════════════════════════════════════

    /// @dev Delegates to external verifier. If no verifier is set, accepts
    ///      structurally valid proofs (testnet mode only).
    ///      Production verifier must implement:
    ///        function verifyProof(
    ///            uint64 chainId, uint64 blockHeight,
    ///            bytes32 stateRoot, bytes calldata proof
    ///        ) external view returns (bool);
    function _verifyProof(
        uint64 chainId,
        uint64 blockHeight,
        bytes32 stateRoot,
        bytes calldata zkProof
    ) internal view returns (bool) {
        if (zkVerifier == address(0)) {
            // Testnet mode — accept structurally valid proofs
            return true;
        }

        // Production: call external Groth16 verifier
        (bool success, bytes memory result) = zkVerifier.staticcall(
            abi.encodeWithSignature(
                "verifyProof(uint64,uint64,bytes32,bytes)",
                chainId, blockHeight, stateRoot, zkProof
            )
        );

        return success && result.length >= 32 && abi.decode(result, (bool));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════

    function setZKVerifier(address newVerifier)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        emit ZKVerifierUpdated(zkVerifier, newVerifier);
        zkVerifier = newVerifier;
    }

    function setMinProofSize(uint256 newSize)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        emit MinProofSizeUpdated(minProofSize, newSize);
        minProofSize = newSize;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
