# Gas Optimization Report — MCC Protocol

## Summary

All contracts have been optimized for Ethereum mainnet deployment.
Target: minimize gas for hot-path operations (proof publishing, queries, staking).

## Optimizations Applied

### 1. Storage Packing (All Contracts)

**Struct field sizing** — fields use the smallest type that fits their range:
- `uint48` for timestamps (good until year 8.9 million)
- `uint64` for chain IDs, block heights, sequence numbers
- `uint32` for millisecond/second durations
- `bool` packed with `address` in same slot

**StateProof struct layout** (2 storage slots for metadata):
```
Slot 1: chainId(64) + blockHeight(64) + timestamp(48) + sequenceNumber(64) = 240 bits
Slot 2: publisher(160) + [padding]
Slot 3+: stateRoot(256) + zkProof(dynamic)
```

**Validator struct layout** (3 storage slots):
```
Slot 1: stake(256)
Slot 2: chainsSynced(64) + proofsVerified(64) + joinedAt(48) + unbondingStarted(48) + status(8) = 232 bits
Slot 3: rewardsEarned(256)
```

### 2. Unchecked Arithmetic (Where Overflow Is Impossible)

- Loop counters (`unchecked { ++i }`) — saves ~60 gas per iteration
- Sequence number increments (uint64 can't overflow in practice)
- Time difference calculations where underflow is prevented by require

### 3. Calldata Over Memory

- All external function parameters use `calldata` instead of `memory`
- Saves ~60 gas per dynamic parameter by avoiding memory copy

### 4. Custom Errors Over Require Strings

- All `require(condition, "string")` replaced with `revert CustomError()`
- Saves ~50 gas per revert (no string storage/encoding)
- Already applied across all contracts

### 5. Immutable Variables

- `syncToken` in CoCValidator — set once, read often
- `proofStore` in SynapseProtocol — set once, read every query
- `emissionStart` in SyncToken — set at deployment
- Saves ~2100 gas per read vs regular storage (SLOAD vs PUSH)

### 6. View Function Caching

- `getActiveValidatorCount()` uses local counter variable
- `_executeQuery()` caches proof in memory before multiple reads
- Avoids redundant SLOAD operations

### 7. Event-Based History (StateProofStore)

- Historical proofs stored in events + minimal on-chain index
- Latest proof is the only one that needs O(1) on-chain access
- Historical lookups use event indexing off-chain

### 8. Short-Circuit Conditions

- Most restrictive checks first (cheapest to fail)
- Zero-checks before role checks before state reads
- Example in `publishProof`: stateRoot != 0 → proof size → chain active → block height

### 9. SafeERC20 Usage (CoCValidator)

- Uses OpenZeppelin SafeERC20 for all token transfers
- Prevents silent failures from non-standard ERC20 tokens
- Negligible gas overhead (~200 gas) for critical safety

### 10. Fee Refund via Low-Level Call (SynapseProtocol)

- Uses `call{value: excess}("")` instead of `transfer()`
- `transfer()` forwards only 2300 gas — breaks with smart contract wallets
- `call()` forwards all remaining gas, compatible with all receivers

## Gas Estimates (Key Operations)

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| publishProof (first) | ~85,000 | Cold storage write |
| publishProof (update) | ~45,000 | Warm storage update |
| queryState (single) | ~35,000 | Read + verify freshness |
| queryStateMulti (3 chains) | ~90,000 | 3× read + aggregation |
| joinValidatorSet | ~120,000 | Token transfer + storage |
| slashValidator | ~55,000 | Storage update + event |
| advanceEpoch (10 validators) | ~180,000 | Loop + distributions |

## Compiler Settings

```json
{
  "optimizer": { "enabled": true, "runs": 200 },
  "viaIR": true
}
```

- `runs: 200` — balanced for contracts called moderately often
- `viaIR: true` — enables Yul-based optimizer for better stack management

## Recommendations for Further Optimization

1. **Batch proof publishing** — allow SPNs to publish proofs for multiple chains
   in a single transaction (saves base tx cost of 21000 gas per extra chain)

2. **Proof compression** — if ZK proofs can be standardized to fixed size,
   use `bytes32[8]` instead of `bytes` to avoid dynamic storage overhead

3. **Validator set as mapping** — if validator count exceeds ~50, the linear
   scan in `advanceEpoch` becomes expensive. Consider a linked list or
   separate active-set tracking.

4. **EIP-4844 blob storage** — for proof archival, consider posting historical
   proofs as blobs instead of calldata (10× cheaper per byte)
