// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CoCValidator — Consensus of Consciousness Validator Registry (production)
/// @notice Manages the validator set securing cross-chain state integrity.
/// @dev    Roles:
///           DEFAULT_ADMIN_ROLE — governance (parameter changes, emergency)
///           SLASHER_ROLE       — fraud proof contract / governance multisig
///           OPERATOR_ROLE      — epoch advancement, operational tasks

contract CoCValidator is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════

    bytes32 public constant SLASHER_ROLE  = keccak256("SLASHER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ═══════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    uint256 public constant MIN_STAKE            = 100_000 ether;
    uint256 public constant UNBONDING_PERIOD      = 7 days;
    uint256 public constant EPOCH_DURATION        = 1 hours;

    // Slash rates in basis points (1 bp = 0.01%)
    uint256 public constant SLASH_FABRICATION     = 10_000; // 100%
    uint256 public constant SLASH_STALENESS       = 1_000;  // 10%
    uint256 public constant SLASH_CENSORSHIP      = 2_500;  // 25%

    // ═══════════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════════

    enum Status { INACTIVE, ACTIVE, UNBONDING, SLASHED }
    enum SlashReason { PROOF_FABRICATION, STALENESS_NEGLIGENCE, CENSORSHIP }

    struct Validator {
        uint256 stake;              // slot 1: 256 bits
        uint256 rewardsEarned;      // slot 2: 256 bits
        uint64  chainsSynced;       // slot 3: packed (64+64+48+48+8 = 232 bits)
        uint64  proofsVerified;
        uint48  joinedAt;
        uint48  unbondingStarted;
        Status  status;
    }

    struct SlashRecord {
        address validator;
        SlashReason reason;
        uint256 amount;
        uint48  timestamp;
        uint64  chainId;
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════

    IERC20 public immutable syncToken;

    mapping(address => Validator) public validators;
    address[] public validatorSet;
    mapping(address => bool) public isInSet;

    mapping(address => mapping(uint64 => bool)) public validatorChains;

    SlashRecord[] public slashHistory;
    uint256 public slashedFundsTotal;

    uint256 public currentEpoch;
    uint48  public lastEpochTimestamp;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event ValidatorJoined(address indexed validator, uint256 stake);
    event StakeIncreased(address indexed validator, uint256 added, uint256 newTotal);
    event UnbondingStarted(address indexed validator, uint256 unbondingEnd);
    event ValidatorExited(address indexed validator, uint256 stakeReturned);
    event ValidatorSlashed(address indexed validator, SlashReason reason, uint256 amount);
    event ChainSyncRegistered(address indexed validator, uint64 indexed chainId);
    event ChainSyncRemoved(address indexed validator, uint64 indexed chainId);
    event RewardDistributed(address indexed validator, uint256 amount);
    event EpochAdvanced(uint256 indexed epoch, uint256 totalRewards);
    event SlashedFundsWithdrawn(address indexed to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════════

    error StakeBelowMinimum(uint256 provided, uint256 minimum);
    error AlreadyValidator();
    error NotActiveValidator();
    error NotUnbonding();
    error UnbondingNotElapsed(uint256 remaining);
    error AlreadySyncingChain(uint64 chainId);
    error NotSyncingChain(uint64 chainId);
    error ValidatorNotSlashable();
    error ZeroAmount();
    error ZeroAddress();

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(address admin, address syncToken_) {
        if (admin == address(0) || syncToken_ == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        syncToken = IERC20(syncToken_);
        lastEpochTimestamp = uint48(block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VALIDATOR LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Stake SYNC and join the validator set
    function joinValidatorSet(uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount < MIN_STAKE) revert StakeBelowMinimum(amount, MIN_STAKE);
        if (isInSet[msg.sender]) revert AlreadyValidator();

        syncToken.safeTransferFrom(msg.sender, address(this), amount);

        validators[msg.sender] = Validator({
            stake: amount,
            chainsSynced: 0,
            proofsVerified: 0,
            rewardsEarned: 0,
            joinedAt: uint48(block.timestamp),
            unbondingStarted: 0,
            status: Status.ACTIVE
        });

        validatorSet.push(msg.sender);
        isInSet[msg.sender] = true;

        emit ValidatorJoined(msg.sender, amount);
    }

    /// @notice Add more SYNC to existing stake
    function increaseStake(uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        _requireActive(msg.sender);

        syncToken.safeTransferFrom(msg.sender, address(this), amount);
        validators[msg.sender].stake += amount;

        emit StakeIncreased(msg.sender, amount, validators[msg.sender].stake);
    }

    /// @notice Begin unbonding (7-day cooldown before exit)
    function startUnbonding() external whenNotPaused {
        _requireActive(msg.sender);

        validators[msg.sender].status = Status.UNBONDING;
        validators[msg.sender].unbondingStarted = uint48(block.timestamp);

        emit UnbondingStarted(msg.sender, block.timestamp + UNBONDING_PERIOD);
    }

    /// @notice Complete exit after unbonding period
    function completeExit() external nonReentrant {
        Validator storage v = validators[msg.sender];
        if (v.status != Status.UNBONDING) revert NotUnbonding();

        uint256 elapsed = block.timestamp - v.unbondingStarted;
        if (elapsed < UNBONDING_PERIOD) {
            revert UnbondingNotElapsed(UNBONDING_PERIOD - elapsed);
        }

        uint256 stakeToReturn = v.stake;
        v.stake = 0;
        v.status = Status.INACTIVE;
        isInSet[msg.sender] = false;

        syncToken.safeTransfer(msg.sender, stakeToReturn);

        emit ValidatorExited(msg.sender, stakeToReturn);
    }

    // ═══════════════════════════════════════════════════════════════
    //  CHAIN SYNC
    // ═══════════════════════════════════════════════════════════════

    function registerChainSync(uint64 chainId) external whenNotPaused {
        _requireActive(msg.sender);
        if (validatorChains[msg.sender][chainId]) revert AlreadySyncingChain(chainId);

        validatorChains[msg.sender][chainId] = true;
        validators[msg.sender].chainsSynced++;

        emit ChainSyncRegistered(msg.sender, chainId);
    }

    function removeChainSync(uint64 chainId) external {
        _requireActive(msg.sender);
        if (!validatorChains[msg.sender][chainId]) revert NotSyncingChain(chainId);

        validatorChains[msg.sender][chainId] = false;
        validators[msg.sender].chainsSynced--;

        emit ChainSyncRemoved(msg.sender, chainId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  PROOF ATTESTATION
    // ═══════════════════════════════════════════════════════════════

    /// @notice Record proof verification (called by validators)
    function attestProofVerification(uint64 chainId) external whenNotPaused {
        _requireActive(msg.sender);
        if (!validatorChains[msg.sender][chainId]) revert NotSyncingChain(chainId);

        // Safe increment
        validators[msg.sender].proofsVerified++;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SLASHING
    // ═══════════════════════════════════════════════════════════════

    /// @notice Slash a validator (requires fraud proof or governance)
    function slashValidator(
        address validator,
        SlashReason reason,
        uint64 chainId
    )
        external
        nonReentrant
        onlyRole(SLASHER_ROLE)
    {
        Validator storage v = validators[validator];
        if (v.status != Status.ACTIVE && v.status != Status.UNBONDING) {
            revert ValidatorNotSlashable();
        }

        uint256 slashBps;
        if (reason == SlashReason.PROOF_FABRICATION) {
            slashBps = SLASH_FABRICATION;
        } else if (reason == SlashReason.STALENESS_NEGLIGENCE) {
            slashBps = SLASH_STALENESS;
        } else {
            slashBps = SLASH_CENSORSHIP;
        }

        uint256 slashAmount = (v.stake * slashBps) / 10_000;
        v.stake -= slashAmount;
        slashedFundsTotal += slashAmount;

        if (v.stake < MIN_STAKE) {
            v.status = Status.SLASHED;
            isInSet[validator] = false;
        }

        slashHistory.push(SlashRecord({
            validator: validator,
            reason: reason,
            amount: slashAmount,
            timestamp: uint48(block.timestamp),
            chainId: chainId
        }));

        emit ValidatorSlashed(validator, reason, slashAmount);
    }

    // ═══════════════════════════════════════════════════════════════
    //  EPOCH REWARDS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Advance epoch and distribute rewards
    /// @param rewardAmount Amount of SYNC to distribute (transferred from caller)
    function advanceEpoch(uint256 rewardAmount)
        external
        nonReentrant
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        require(
            block.timestamp >= uint256(lastEpochTimestamp) + EPOCH_DURATION,
            "CoC: epoch not elapsed"
        );

        if (rewardAmount > 0) {
            syncToken.safeTransferFrom(msg.sender, address(this), rewardAmount);
        }

        // Calculate weights
        uint256 totalWeight = 0;
        uint256 len = validatorSet.length;
        uint256[] memory weights = new uint256[](len);

        for (uint256 i = 0; i < len;) {
            Validator storage v = validators[validatorSet[i]];
            if (v.status == Status.ACTIVE && v.chainsSynced > 0) {
                weights[i] = _weight(v.stake, v.chainsSynced);
                totalWeight += weights[i];
            }
            unchecked { ++i; }
        }

        // Distribute proportionally
        if (totalWeight > 0 && rewardAmount > 0) {
            for (uint256 i = 0; i < len;) {
                if (weights[i] > 0) {
                    uint256 reward = (rewardAmount * weights[i]) / totalWeight;
                    if (reward > 0) {
                        Validator storage v = validators[validatorSet[i]];
                        v.rewardsEarned += reward;
                        v.stake += reward; // Auto-compound
                        emit RewardDistributed(validatorSet[i], reward);
                    }
                }
                unchecked { ++i; }
            }
        }

        currentEpoch++;
        lastEpochTimestamp = uint48(block.timestamp);

        emit EpochAdvanced(currentEpoch, rewardAmount);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function getValidatorCount() external view returns (uint256) {
        return validatorSet.length;
    }

    function getActiveValidatorCount() external view returns (uint256 count) {
        uint256 len = validatorSet.length;
        for (uint256 i = 0; i < len;) {
            if (validators[validatorSet[i]].status == Status.ACTIVE) count++;
            unchecked { ++i; }
        }
    }

    function getValidatorInfo(address addr) external view returns (Validator memory) {
        return validators[addr];
    }

    function getSlashCount() external view returns (uint256) {
        return slashHistory.length;
    }

    // ═══════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════

    function _requireActive(address addr) internal view {
        if (validators[addr].status != Status.ACTIVE) revert NotActiveValidator();
    }

    /// @dev weight = sqrt(stake_in_tokens) × chainsSynced
    function _weight(uint256 stake, uint64 chainsSynced)
        internal
        pure
        returns (uint256)
    {
        return _sqrt(stake / 1 ether) * uint256(chainsSynced);
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════

    /// @notice Withdraw slashed funds to treasury
    function withdrawSlashedFunds(address to)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = slashedFundsTotal;
        slashedFundsTotal = 0;
        syncToken.safeTransfer(to, amount);
        emit SlashedFundsWithdrawn(to, amount);
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
