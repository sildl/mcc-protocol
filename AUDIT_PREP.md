# Security Audit Preparation — MCC Protocol

## Pre-Audit Checklist

### Static Analysis
```bash
# Slither (primary)
pip install slither-analyzer
slither . --config-file slither.config.json

# Mythril (symbolic execution)
pip install mythril
myth analyze contracts/token/SyncToken.sol --solv 0.8.28
myth analyze contracts/core/StateProofStore.sol --solv 0.8.28
myth analyze contracts/core/CoCValidator.sol --solv 0.8.28
myth analyze contracts/core/SynapseProtocol.sol --solv 0.8.28

# Aderyn (Rust-based, fast)
aderyn .
```

### Fuzzing
```bash
# Foundry fuzz testing (recommended)
forge test --fuzz-runs 10000

# Echidna (property-based)
echidna . --contract SyncTokenEchidna --config echidna.yaml
```

### Manual Review Focus Areas

Priority items for auditors, ordered by risk:

## Known Considerations

### 1. ZK Verifier Trust Boundary (CRITICAL)

**Risk**: The `StateProofStore._verifyProof()` delegates to an external contract
via `staticcall`. If `zkVerifier` is set to a malicious address, it could return
`true` for invalid proofs.

**Mitigation**: 
- `zkVerifier` is only settable by `DEFAULT_ADMIN_ROLE`
- Testnet mode (address(0)) clearly documented as unsafe
- Recommend: timelock on `setZKVerifier()` changes

**Auditor action**: Verify that `staticcall` cannot be exploited via return
data manipulation, and that the Groth16Verifier correctly validates all
pairing check inputs.

### 2. Fee Refund via Low-Level Call (HIGH)

**Risk**: `SynapseProtocol._refundExcess()` uses `call{value:}("")` to refund
excess ETH. If the caller is a contract that reverts on receive, the query
would fail.

**Mitigation**:
- Refund failure reverts the entire transaction (user doesn't lose funds)
- `ReentrancyGuard` prevents re-entrancy via the refund

**Auditor action**: Verify reentrancy is impossible through the refund path.

### 3. Validator Reward Rounding (MEDIUM)

**Risk**: `CoCValidator.advanceEpoch()` distributes rewards proportionally.
Integer division means `sum(rewards) <= rewardAmount`. Dust stays in the
contract and compounds over epochs.

**Mitigation**: 
- Dust accumulation is negligible (wei-level per epoch)
- No mechanism for dust to be extracted by an attacker
- `withdrawSlashedFunds` only withdraws slashed amounts, not dust

**Auditor action**: Verify dust cannot be extracted and doesn't create
an accounting discrepancy that breaks `completeExit()`.

### 4. Unbonding Period Bypass (MEDIUM)

**Risk**: If `block.timestamp` can be manipulated (miner/proposer), the
7-day unbonding period could be shortened.

**Mitigation**:
- Ethereum block timestamps have limited manipulation (~15 seconds)
- 7 days provides massive buffer against timestamp manipulation
- Slashing can occur during unbonding

**Auditor action**: Verify no path bypasses the unbonding check.

### 5. Vesting Cliff Edge Case (LOW)

**Risk**: If `cliffDuration == vestingDuration - 1`, all tokens vest in
the last second. This is mathematically correct but might surprise users.

**Mitigation**: Constructor validates `cliffDuration < vestingDuration`.
Documentation specifies expected parameter ranges.

**Auditor action**: Verify linear interpolation is correct at boundary values.

### 6. ERC-20 Approval Race Condition (LOW)

**Risk**: Standard ERC-20 `approve()` front-running issue.

**Mitigation**: `ERC20Permit` (EIP-2612) provides gasless, front-run-resistant
approvals. Users should prefer `permit()` over `approve()`.

**Auditor action**: Standard — no custom mitigation needed.

## Contract Interaction Matrix

```
SyncToken ←→ CoCValidator   : MINTER_ROLE (mint rewards)
SyncToken ←→ SynapseProtocol: BURNER_ROLE (burn fees)
SyncToken ←→ SyncVesting    : SafeERC20 transfers (release/revoke)

StateProofStore ← SPN nodes     : SPN_ROLE (publish proofs)
StateProofStore → SynapseProtocol: view calls (getLatestProof)
StateProofStore ← Groth16Verifier: staticcall (verify proofs)

CoCValidator ← Validators      : stake/unstake/attest
CoCValidator ← FraudProof      : SLASHER_ROLE (slash)
CoCValidator ← Operator        : OPERATOR_ROLE (advance epoch)

SynapseProtocol ← dApps        : queryState (payable)
SynapseProtocol → StateProofStore: getLatestProof (view)
```

## Deployment Security

- [ ] All `DEFAULT_ADMIN_ROLE` transferred to Gnosis Safe (3-of-5 minimum)
- [ ] `OPERATOR_ROLE` on separate ops multisig (2-of-3)
- [ ] `SLASHER_ROLE` only on fraud proof contract (no EOA)
- [ ] Deployer EOA has no remaining roles
- [ ] All contracts verified on Etherscan
- [ ] Emergency pause tested on testnet
- [ ] Upgrade path documented (no upgradeability — intentional)

## Scope for Audit

| Contract | SLOC | Complexity |
|----------|------|------------|
| SyncToken.sol | ~120 | Medium |
| StateProofStore.sol | ~240 | High |
| CoCValidator.sol | ~280 | High |
| SynapseProtocol.sol | ~180 | Medium |
| Groth16Verifier.sol | ~200 | Critical |
| SyncVesting.sol | ~180 | Medium |
| **Total** | **~1200** | |

Estimated audit duration: 2-3 weeks (Tier-1 firm)
Recommended firms: Trail of Bits, OpenZeppelin, Spearbit, Consensys Diligence
