// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title SyncVesting — Token vesting for team, partners, and ecosystem
/// @notice Linear vesting with cliff. Optionally revocable by the grantor.
///
/// @dev    Schedule parameters:
///           - cliff:    Time before any tokens vest (e.g., 12 months for team)
///           - duration: Total vesting period including cliff (e.g., 48 months)
///           - revocable: If true, grantor can revoke unvested tokens
///
///         Vesting math:
///           if (elapsed < cliff) → 0
///           if (elapsed >= duration) → totalAmount
///           else → totalAmount × (elapsed - cliff) / (duration - cliff)
///
///         Example schedules:
///           Team:     150M SYNC, 12-month cliff, 48-month total, revocable
///           Partners: 100M SYNC, 6-month cliff, 36-month total, revocable

contract SyncVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════════

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 released;
        uint48  startTime;
        uint32  cliffDuration;   // seconds
        uint32  vestingDuration; // seconds (total, including cliff)
        bool    revocable;
        bool    revoked;
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════

    IERC20 public immutable token;
    address public immutable grantor;

    mapping(bytes32 => VestingSchedule) public schedules;
    bytes32[] public scheduleIds;
    uint256 public scheduleCount;

    /// @notice Total tokens committed to active schedules
    uint256 public totalCommitted;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event ScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint32  cliffDuration,
        uint32  vestingDuration
    );
    event TokensReleased(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(bytes32 indexed scheduleId, uint256 unvestedReturned);

    // ═══════════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════════

    error OnlyGrantor();
    error OnlyBeneficiary();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidDuration();
    error ScheduleAlreadyExists(bytes32 id);
    error ScheduleNotFound(bytes32 id);
    error ScheduleNotRevocable();
    error ScheduleAlreadyRevoked();
    error NothingToRelease();
    error InsufficientBalance(uint256 available, uint256 needed);

    // ═══════════════════════════════════════════════════════════════
    //  MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier onlyGrantor() {
        if (msg.sender != grantor) revert OnlyGrantor();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    /// @param token_   The SYNC token address
    /// @param grantor_ Address that can create and revoke schedules (admin multisig)
    constructor(address token_, address grantor_) {
        if (token_ == address(0) || grantor_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        grantor = grantor_;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SCHEDULE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /// @notice Create a new vesting schedule
    /// @param beneficiary    Who receives the vested tokens
    /// @param totalAmount    Total tokens to vest
    /// @param cliffDuration  Cliff period in seconds (e.g., 365 days)
    /// @param vestingDuration Total vesting period in seconds (must be > cliff)
    /// @param revocable      Whether the grantor can revoke unvested tokens
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint32  cliffDuration,
        uint32  vestingDuration,
        bool    revocable
    ) external onlyGrantor nonReentrant {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        if (vestingDuration == 0 || cliffDuration >= vestingDuration) revert InvalidDuration();

        bytes32 id = _computeId(beneficiary, scheduleCount);
        if (schedules[id].totalAmount > 0) revert ScheduleAlreadyExists(id);

        // Verify contract holds enough tokens
        uint256 available = token.balanceOf(address(this)) - totalCommitted;
        if (available < totalAmount) revert InsufficientBalance(available, totalAmount);

        schedules[id] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            released: 0,
            startTime: uint48(block.timestamp),
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revocable: revocable,
            revoked: false
        });

        scheduleIds.push(id);
        scheduleCount++;
        totalCommitted += totalAmount;

        emit ScheduleCreated(id, beneficiary, totalAmount, cliffDuration, vestingDuration);
    }

    /// @notice Release vested tokens to beneficiary
    /// @param scheduleId The schedule to release from
    function release(bytes32 scheduleId) external nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        if (s.totalAmount == 0) revert ScheduleNotFound(scheduleId);
        if (msg.sender != s.beneficiary) revert OnlyBeneficiary();

        uint256 releasable = _vestedAmount(s) - s.released;
        if (releasable == 0) revert NothingToRelease();

        s.released += releasable;
        totalCommitted -= releasable;

        token.safeTransfer(s.beneficiary, releasable);

        emit TokensReleased(scheduleId, s.beneficiary, releasable);
    }

    /// @notice Revoke a schedule and return unvested tokens to grantor
    function revoke(bytes32 scheduleId) external onlyGrantor nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        if (s.totalAmount == 0) revert ScheduleNotFound(scheduleId);
        if (!s.revocable) revert ScheduleNotRevocable();
        if (s.revoked) revert ScheduleAlreadyRevoked();

        uint256 vested = _vestedAmount(s);
        uint256 unvested = s.totalAmount - vested;

        s.revoked = true;
        s.totalAmount = vested; // Reduce to only vested portion
        totalCommitted -= unvested;

        if (unvested > 0) {
            token.safeTransfer(grantor, unvested);
        }

        emit ScheduleRevoked(scheduleId, unvested);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Get the currently releasable amount for a schedule
    function releasableAmount(bytes32 scheduleId) external view returns (uint256) {
        VestingSchedule storage s = schedules[scheduleId];
        if (s.totalAmount == 0) return 0;
        return _vestedAmount(s) - s.released;
    }

    /// @notice Get the total vested amount for a schedule
    function vestedAmount(bytes32 scheduleId) external view returns (uint256) {
        return _vestedAmount(schedules[scheduleId]);
    }

    /// @notice Get schedule ID for a beneficiary by index
    function getScheduleId(address beneficiary, uint256 index)
        external
        pure
        returns (bytes32)
    {
        return _computeId(beneficiary, index);
    }

    /// @notice Get all schedule IDs
    function getAllScheduleIds() external view returns (bytes32[] memory) {
        return scheduleIds;
    }

    // ═══════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════

    function _vestedAmount(VestingSchedule storage s)
        internal
        view
        returns (uint256)
    {
        if (s.revoked) return s.totalAmount; // All remaining is vested
        if (s.totalAmount == 0) return 0;

        uint256 elapsed = block.timestamp - s.startTime;

        // Before cliff: nothing vested
        if (elapsed < s.cliffDuration) return 0;

        // After full duration: everything vested
        if (elapsed >= s.vestingDuration) return s.totalAmount;

        // Linear vesting between cliff and end
        // vested = total × (elapsed - cliff) / (duration - cliff)
        uint256 vestableTime = s.vestingDuration - s.cliffDuration;
        uint256 elapsedSinceCliff = elapsed - s.cliffDuration;

        return (s.totalAmount * elapsedSinceCliff) / vestableTime;
    }

    function _computeId(address beneficiary, uint256 index)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(beneficiary, index));
    }

    // ═══════════════════════════════════════════════════════════════
    //  EMERGENCY
    // ═══════════════════════════════════════════════════════════════

    /// @notice Recover tokens accidentally sent to this contract
    ///         (not SYNC tokens committed to schedules)
    function recoverERC20(address tokenAddr, uint256 amount) external onlyGrantor {
        if (tokenAddr == address(token)) {
            // Only allow recovering excess beyond committed
            uint256 excess = IERC20(tokenAddr).balanceOf(address(this)) - totalCommitted;
            require(amount <= excess, "Cannot recover committed tokens");
        }
        IERC20(tokenAddr).safeTransfer(grantor, amount);
    }
}
