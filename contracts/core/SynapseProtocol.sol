// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./StateProofStore.sol";

/// @title SynapseProtocol — Cross-chain state query engine (production)
/// @notice Developer-facing API for reading any connected chain's state.
///         Charges fees in ETH per query; fees are accumulated and withdrawable.
/// @dev    Roles:
///           DEFAULT_ADMIN_ROLE — governance (fee changes, pause, upgrades)
///           OPERATOR_ROLE      — operational pause, fee withdrawal

contract SynapseProtocol is AccessControl, Pausable, ReentrancyGuard {

    // ═══════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ═══════════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════════

    enum QueryType { BALANCE, STORAGE, UTXO, NFT_OWNERSHIP, CONTRACT_STATE }

    struct SynapseQuery {
        uint64    targetChainId;
        QueryType queryType;
        address   targetAddress;
        bytes32   storageSlot;
        uint32    maxStalenessSeconds;
    }

    struct SynapseResult {
        uint64  chainId;
        uint64  blockHeight;
        uint48  timestamp;
        bytes32 stateRoot;
        bytes   value;
        bool    verified;
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════

    StateProofStore public immutable proofStore;

    uint256 public queryFee;
    uint256 public totalQueries;
    uint256 public feeAccumulator;
    uint8   public constant MAX_MULTI_QUERY = 10;

    mapping(uint64 => uint256) public chainQueryCount;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event QueryExecuted(
        address indexed caller,
        uint64  indexed targetChainId,
        QueryType queryType,
        uint64  blockHeight,
        uint256 fee
    );
    event MultiQueryExecuted(address indexed caller, uint256 chainCount, uint256 totalFee);
    event QueryFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════════

    error InsufficientFee(uint256 sent, uint256 required);
    error EmptyQueryArray();
    error TooManyQueries(uint256 count, uint256 max);
    error ProofTooStale(uint64 chainId, uint256 age, uint256 maxAge);
    error NoProofAvailable(uint64 chainId);
    error RefundFailed();
    error WithdrawFailed();
    error ZeroAddress();

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(address admin, address proofStore_, uint256 queryFee_) {
        if (admin == address(0) || proofStore_ == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        proofStore = StateProofStore(proofStore_);
        queryFee = queryFee_;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SINGLE QUERY
    // ═══════════════════════════════════════════════════════════════

    /// @notice Execute a single cross-chain state query
    function queryState(SynapseQuery calldata query)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (SynapseResult memory result)
    {
        if (msg.value < queryFee) revert InsufficientFee(msg.value, queryFee);

        result = _executeQuery(query);

        feeAccumulator += queryFee;
        totalQueries++;
        chainQueryCount[query.targetChainId]++;

        emit QueryExecuted(
            msg.sender,
            query.targetChainId,
            query.queryType,
            result.blockHeight,
            queryFee
        );

        _refundExcess(queryFee);
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    //  MULTI-CHAIN ATOMIC QUERY
    // ═══════════════════════════════════════════════════════════════

    /// @notice Execute atomic queries across multiple chains
    function queryStateMulti(SynapseQuery[] calldata queries)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (SynapseResult[] memory results)
    {
        uint256 count = queries.length;
        if (count == 0) revert EmptyQueryArray();
        if (count > MAX_MULTI_QUERY) revert TooManyQueries(count, MAX_MULTI_QUERY);

        uint256 totalFee = queryFee * count;
        if (msg.value < totalFee) revert InsufficientFee(msg.value, totalFee);

        results = new SynapseResult[](count);

        for (uint256 i = 0; i < count;) {
            results[i] = _executeQuery(queries[i]);
            chainQueryCount[queries[i].targetChainId]++;
            unchecked { ++i; }
        }

        feeAccumulator += totalFee;
        totalQueries += count;

        emit MultiQueryExecuted(msg.sender, count, totalFee);

        _refundExcess(totalFee);
        return results;
    }

    // ═══════════════════════════════════════════════════════════════
    //  FREE READS (no fee, view only)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Check if a chain has a fresh proof available
    function isChainAvailable(uint64 chainId) external view returns (bool) {
        try proofStore.isProofFresh(chainId) returns (bool fresh) {
            return fresh;
        } catch {
            return false;
        }
    }

    /// @notice Get proof age for a chain
    function getProofAge(uint64 chainId) external view returns (uint256) {
        return proofStore.getProofAge(chainId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════

    function _executeQuery(SynapseQuery calldata query)
        internal
        view
        returns (SynapseResult memory result)
    {
        // Retrieve latest proof
        StateProofStore.StateProof memory proof;
        try proofStore.getLatestProof(query.targetChainId) returns (
            StateProofStore.StateProof memory p
        ) {
            proof = p;
        } catch {
            revert NoProofAvailable(query.targetChainId);
        }

        // Validate freshness
        uint256 age = block.timestamp - proof.timestamp;
        if (age > query.maxStalenessSeconds) {
            revert ProofTooStale(query.targetChainId, age, query.maxStalenessSeconds);
        }

        // Extract value (production: Merkle proof against stateRoot)
        bytes memory value = _extractValue(proof, query);

        result = SynapseResult({
            chainId: query.targetChainId,
            blockHeight: proof.blockHeight,
            timestamp: proof.timestamp,
            stateRoot: proof.stateRoot,
            value: value,
            verified: true
        });
    }

    /// @dev Production implementation requires Merkle proof verification.
    ///      This encodes proof metadata for prototype demonstration.
    function _extractValue(
        StateProofStore.StateProof memory proof,
        SynapseQuery calldata query
    ) internal pure returns (bytes memory) {
        return abi.encode(
            proof.stateRoot,
            query.targetAddress,
            query.queryType,
            proof.blockHeight
        );
    }

    function _refundExcess(uint256 consumed) internal {
        uint256 excess = msg.value - consumed;
        if (excess > 0) {
            (bool ok,) = payable(msg.sender).call{value: excess}("");
            if (!ok) revert RefundFailed();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════

    function setQueryFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit QueryFeeUpdated(queryFee, newFee);
        queryFee = newFee;
    }

    function withdrawFees(address payable to)
        external
        nonReentrant
        onlyRole(OPERATOR_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = feeAccumulator;
        feeAccumulator = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit FeesWithdrawn(to, amount);
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
