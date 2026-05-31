// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title SyncToken — Production ERC-20 for Multi-Chain Consciousness
/// @notice SYNC aligns incentives across validators, chains, and developers.

contract SyncToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl, Pausable, ReentrancyGuard {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 public constant MAX_SUPPLY           = 1_000_000_000 ether;
    uint256 public constant VALIDATOR_REWARDS     = 350_000_000 ether;
    uint256 public constant ECOSYSTEM_DEV         = 250_000_000 ether;
    uint256 public constant CORE_TEAM             = 150_000_000 ether;
    uint256 public constant STRATEGIC_PARTNERS    = 100_000_000 ether;
    uint256 public constant COMMUNITY_TREASURY    = 100_000_000 ether;
    uint256 public constant INITIAL_LIQUIDITY     =  50_000_000 ether;

    uint256 public constant HALVING_INTERVAL  = 730 days;
    uint256 public constant EMISSION_DURATION = 3650 days;
    uint256 public constant MAX_HALVINGS      = 4;

    uint256 public immutable emissionStart;
    uint256 public validatorRewardsEmitted;
    uint256 public totalBurned;

    event ValidatorRewardsMinted(address indexed to, uint256 amount);
    event ProtocolBurn(address indexed from, uint256 amount, bytes32 indexed reason);

    error ExceedsMaxSupply(uint256 requested, uint256 remaining);
    error EmissionPeriodEnded();
    error ZeroAmount();
    error ZeroAddress();

    constructor(
        address admin,
        address treasury,
        address teamVesting,
        address partnerVesting,
        address ecosystemFund
    ) ERC20("Multi-Chain Consciousness", "SYNC") ERC20Permit("Multi-Chain Consciousness") {
        if (admin == address(0) || treasury == address(0) || teamVesting == address(0)
            || partnerVesting == address(0) || ecosystemFund == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        emissionStart = block.timestamp;

        _mint(admin, INITIAL_LIQUIDITY);
        _mint(treasury, COMMUNITY_TREASURY);
        _mint(teamVesting, CORE_TEAM);
        _mint(partnerVesting, STRATEGIC_PARTNERS);
        _mint(ecosystemFund, ECOSYSTEM_DEV);
    }

    function mintValidatorRewards(address to, uint256 amount)
        external nonReentrant onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 minted)
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp - emissionStart > EMISSION_DURATION) revert EmissionPeriodEnded();

        uint256 remaining = VALIDATOR_REWARDS - validatorRewardsEmitted;
        if (remaining == 0) revert EmissionPeriodEnded();
        minted = amount > remaining ? remaining : amount;
        if (totalSupply() + minted > MAX_SUPPLY) minted = MAX_SUPPLY - totalSupply();
        if (minted == 0) revert EmissionPeriodEnded();

        validatorRewardsEmitted += minted;
        _mint(to, minted);
        emit ValidatorRewardsMinted(to, minted);
    }

    function currentEmissionRate() external view returns (uint256 rate) {
        uint256 elapsed = block.timestamp - emissionStart;
        if (elapsed >= EMISSION_DURATION) return 0;
        uint256 halvings = elapsed / HALVING_INTERVAL;
        if (halvings > MAX_HALVINGS) halvings = MAX_HALVINGS;
        rate = (VALIDATOR_REWARDS / 5) >> halvings;
        rate = rate / (HALVING_INTERVAL / 1 hours);
    }

    function protocolBurn(address from, uint256 amount, bytes32 reason)
        external nonReentrant onlyRole(BURNER_ROLE) whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        _spendAllowance(from, _msgSender(), amount);
        _burn(from, amount);
        totalBurned += amount;
        emit ProtocolBurn(from, amount, reason);
    }

    function effectiveMaxSupply() external view returns (uint256) { return MAX_SUPPLY - totalBurned; }
    function remainingValidatorRewards() external view returns (uint256) { return VALIDATOR_REWARDS - validatorRewardsEmitted; }
    function isNetDeflationary() external view returns (bool) { return totalBurned > validatorRewardsEmitted; }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal override whenNotPaused
    {
        super._beforeTokenTransfer(from, to, amount);
    }
}
