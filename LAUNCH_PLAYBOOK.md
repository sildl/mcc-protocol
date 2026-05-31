# MCC Protocol — Mainnet Launch & Audit Playbook

> Complete step-by-step from current state to audited mainnet deployment.

---

## Overview — What Needs to Happen

```
PHASE 1: Local Setup             (Week 1)
PHASE 2: Testnet Deployment      (Week 2-3)
PHASE 3: Security Pre-Audit      (Week 3-4)
PHASE 4: Submit to Audit Firm    (Week 4)
PHASE 5: Audit Period            (Week 5-8)
PHASE 6: Fix Audit Findings      (Week 8-9)
PHASE 7: Mainnet Deployment      (Week 9-10)
PHASE 8: Post-Launch             (Week 10+)
```

**Total timeline: ~10 weeks**
**Estimated cost: $80K-$200K** (audit is the largest expense)

---

## PHASE 1: Local Setup (Week 1)

### 1.1 — Prerequisites

Install these tools on your development machine:

```bash
# Node.js 18+ and npm
node --version  # must be >= 18

# Install Foundry (for fuzzing + gas reports)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install Slither (static analysis)
pip install slither-analyzer

# Install Hardhat project deps
cd mcc-prod
npm install

# Verify compilation
npx hardhat compile
```

### 1.2 — Run Full Test Suite

```bash
# Unit + integration tests
npx hardhat test

# Invariant tests
npx hardhat test test/Invariants.test.js

# Gas report
REPORT_GAS=true npx hardhat test

# Coverage report
npx hardhat coverage
```

**Acceptance criteria:**
- All tests pass
- Coverage > 90% on all contracts
- No gas regressions from baseline

### 1.3 — Run Static Analysis

```bash
# Slither
slither . --config-file slither.config.json

# Review findings — fix HIGH and MEDIUM severity
# LOW and INFORMATIONAL are acceptable if documented
```

### 1.4 — Set Up Foundry for Fuzzing

Create a foundry.toml in the project root:

```toml
[profile.default]
src = "contracts"
out = "foundry-out"
libs = ["node_modules"]
solc_version = "0.8.28"
optimizer = true
optimizer_runs = 200
via_ir = true
fuzz = { runs = 10000 }
```

Write fuzz tests (create `test/foundry/`):

```solidity
// test/foundry/SyncTokenFuzz.t.sol
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../../contracts/token/SyncToken.sol";

contract SyncTokenFuzz is Test {
    SyncToken token;
    address admin = address(1);
    address treasury = address(2);

    function setUp() public {
        token = new SyncToken(admin, treasury, address(3), address(4), address(5));
    }

    // Fuzz: transfer never creates tokens
    function testFuzz_transferConservesSupply(address to, uint256 amount) public {
        vm.assume(to != address(0));
        vm.assume(amount <= token.balanceOf(admin));
        uint256 supplyBefore = token.totalSupply();
        vm.prank(admin);
        token.transfer(to, amount);
        assertEq(token.totalSupply(), supplyBefore);
    }

    // Fuzz: burn always reduces supply
    function testFuzz_burnReducesSupply(uint256 amount) public {
        uint256 balance = token.balanceOf(admin);
        vm.assume(amount > 0 && amount <= balance);
        uint256 supplyBefore = token.totalSupply();
        vm.prank(admin);
        token.burn(amount);
        assertEq(token.totalSupply(), supplyBefore - amount);
    }
}
```

Run fuzz tests:

```bash
forge test --fuzz-runs 10000 -vvv
```

---

## PHASE 2: Testnet Deployment (Week 2-3)

### 2.1 — Get Testnet ETH and Configure

```bash
# Copy env template
cp .env.example .env

# Edit .env with:
#   SEPOLIA_RPC_URL — get from Alchemy or Infura (free tier)
#   DEPLOYER_KEY    — testnet wallet private key (NEVER use mainnet key)
#   ETHERSCAN_API_KEY — get from etherscan.io (free)
```

Get Sepolia ETH:
- https://sepoliafaucet.com
- https://faucet.quicknode.com/ethereum/sepolia
- You need ~0.5 SEP ETH for deployment

### 2.2 — Deploy to Sepolia

```bash
# Deploy all contracts
npx hardhat run scripts/deploy.js --network sepolia

# Note the deployment file path (e.g., deployments/sepolia-1719849600000.json)

# Register test chains
DEPLOYMENT_FILE=deployments/sepolia-XXXX.json \
  npx hardhat run scripts/register-chains.js --network sepolia

# Set up vesting (optional on testnet)
DEPLOYMENT_FILE=deployments/sepolia-XXXX.json \
  npx hardhat run scripts/setup-vesting.js --network sepolia
```

### 2.3 — Verify Contracts on Etherscan

The deploy script auto-verifies if ETHERSCAN_API_KEY is set.
If it fails, verify manually:

```bash
npx hardhat verify --network sepolia CONTRACT_ADDRESS "arg1" "arg2"
```

### 2.4 — Manual Testnet Testing

Do these by hand on Etherscan (Write Contract tab):

```
□ Publish a state proof via StateProofStore
□ Query state via SynapseProtocol (send 0.001 ETH)
□ Stake SYNC via CoCValidator
□ Start unbonding, wait, complete exit
□ Slash a validator
□ Advance an epoch with rewards
□ Pause and unpause each contract
□ Create a vesting schedule, wait past cliff, release tokens
□ Set the ZK verifier address
□ Transfer admin role to a second wallet, verify deployer loses access
```

### 2.5 — Deploy Testnet Groth16 Verifier

```bash
# Deploy the verifier
npx hardhat run scripts/deploy-verifier.js --network sepolia

# Register a test verification key for chain ID 1
# (Use test keys from your ZK circuit — see Phase 2.6)

# Update StateProofStore to use the verifier
# Call: stateProofStore.setZKVerifier(verifierAddress)
```

### 2.6 — ZK Circuit Setup (Parallel Track)

This runs in parallel with testnet testing. You need a ZK engineer for this.

**Option A: Use an existing ZK framework**

```bash
# Circom (most common for Groth16)
npm install -g circom snarkjs

# Your circuit proves: "I know a state S such that
#   hash(S) == stateRoot AND S was valid at blockHeight on chainId"
#
# Public inputs:  chainId, blockHeight, stateRoot
# Private inputs: the full state witness (Merkle tree)
```

Circuit development steps:
1. Write the state verification circuit in Circom
2. Compile the circuit
3. Run a trusted setup ceremony (Powers of Tau + phase 2)
4. Generate the Solidity verifier from the setup
5. Deploy the generated verifier (or use our Groth16Verifier with the VK)

**Option B: Use a ZK proving service**

- Succinct (SP1) — https://succinct.xyz
- RiscZero — https://risczero.com
- These handle circuit + proving infrastructure

**Estimated time:** 4-8 weeks with an experienced ZK engineer
**Estimated cost:** $20K-$50K

> NOTE: For the audit, you can submit without a finalized ZK circuit.
> Auditors will review the verifier contract interface and the
> on-chain verification logic. The circuit itself is audited separately.

---

## PHASE 3: Security Pre-Audit (Week 3-4)

### 3.1 — Full Slither Analysis

```bash
slither . --config-file slither.config.json --print human-summary
slither . --config-file slither.config.json --print contract-summary

# Export findings to JSON for the audit firm
slither . --json slither-report.json
```

Fix all HIGH and MEDIUM findings. Document any intentional LOW findings
in AUDIT_PREP.md under "Known Considerations".

### 3.2 — Mythril Deep Analysis

```bash
# Run on each contract individually (takes 10-30 min each)
myth analyze contracts/token/SyncToken.sol \
  --solv 0.8.28 --execution-timeout 300

myth analyze contracts/core/StateProofStore.sol \
  --solv 0.8.28 --execution-timeout 300

myth analyze contracts/core/CoCValidator.sol \
  --solv 0.8.28 --execution-timeout 300

myth analyze contracts/core/SynapseProtocol.sol \
  --solv 0.8.28 --execution-timeout 300

myth analyze contracts/core/Groth16Verifier.sol \
  --solv 0.8.28 --execution-timeout 300

myth analyze contracts/token/SyncVesting.sol \
  --solv 0.8.28 --execution-timeout 300
```

### 3.3 — Foundry Fuzz + Invariant Campaign

```bash
# Run 100K iterations
forge test --fuzz-runs 100000

# Run invariant tests
forge test --match-contract Invariant --fuzz-runs 50000
```

### 3.4 — Manual Code Review Checklist

Go through each contract and verify:

```
REENTRANCY
□ Every external call to untrusted contracts has ReentrancyGuard
□ State changes happen BEFORE external calls (CEI pattern)
□ No callbacks to msg.sender before state updates

ACCESS CONTROL
□ Every state-changing function has a role check
□ DEFAULT_ADMIN_ROLE can be transferred but not abandoned
□ No function is accidentally public

ARITHMETIC
□ No unchecked blocks on user-supplied values
□ Division by zero is impossible (denominators checked)
□ Rounding always favors the protocol (not the user)

TOKEN HANDLING
□ All ERC-20 transfers use SafeERC20
□ Approve race condition documented (EIP-2612 available)
□ No infinite approvals from the protocol

DENIAL OF SERVICE
□ No unbounded loops over user-supplied data
□ advanceEpoch loop is bounded by validator set size
□ External calls have gas limits or try/catch

FRONT-RUNNING
□ Query fees are fixed (no auction/priority manipulation)
□ Staking has no time-sensitive windows exploitable by MEV
□ Proof publishing is permissioned (SPN only)

UPGRADE SAFETY
□ Contracts are NOT upgradeable (intentional — audit this)
□ ZK verifier can be swapped (document the risk)
□ Fee parameters can change (bounded by governance)
```

### 3.5 — Prepare Audit Package

Create a clean repo for the audit firm:

```bash
mkdir mcc-audit-package
cp -r contracts/ mcc-audit-package/
cp -r test/ mcc-audit-package/
cp hardhat.config.js mcc-audit-package/
cp package.json mcc-audit-package/
cp AUDIT_PREP.md mcc-audit-package/
cp GAS_OPTIMIZATION.md mcc-audit-package/
cp slither.config.json mcc-audit-package/
cp slither-report.json mcc-audit-package/

# Create the scope document
```

---

## PHASE 4: Submit to Audit Firm (Week 4)

### 4.1 — Choose an Audit Firm

| Firm | Tier | Cost Estimate | Timeline | Best For |
|------|------|---------------|----------|----------|
| Trail of Bits | Tier 1 | $150K-$250K | 4-6 weeks | Complex protocol logic |
| OpenZeppelin | Tier 1 | $120K-$200K | 3-5 weeks | Token + DeFi contracts |
| Spearbit | Tier 1 | $100K-$180K | 3-4 weeks | Speed + quality |
| Consensys Diligence | Tier 1 | $100K-$180K | 4-6 weeks | Ethereum ecosystem |
| Cyfrin | Tier 2 | $60K-$100K | 3-4 weeks | Great value |
| Code4rena | Contest | $30K-$80K | 2-3 weeks | Crowd audit, good coverage |
| Sherlock | Contest | $30K-$80K | 2-3 weeks | Crowd audit + lead auditor |

**Recommended approach:**
1. Primary: One Tier-1 firm (OpenZeppelin or Spearbit)
2. Secondary: One contest (Code4rena or Sherlock)
3. Total: $130K-$250K

### 4.2 — What to Send the Audit Firm

Email template:

```
Subject: Audit Request — MCC Protocol (~1,200 SLOC Solidity)

Hi [firm],

We'd like to engage your team for a smart contract audit of the
Multi-Chain Consciousness (MCC) protocol — a Layer-0 cross-chain
state verification system targeting Ethereum mainnet.

SCOPE:
- 6 Solidity contracts, ~1,200 SLOC total
- ERC-20 token with emission schedule and burn mechanics
- Validator staking with slashing and reward distribution
- Cross-chain query engine with ETH fee model
- Groth16 ZK-SNARK verifier using bn128 precompiles
- Token vesting with cliff and linear release

DEPENDENCIES:
- OpenZeppelin Contracts v4.9.6 (AccessControl, ReentrancyGuard,
  SafeERC20, Pausable, ERC20, ERC20Permit)

WHAT WE'VE DONE:
- Static analysis with Slither (report attached)
- 35 unit + invariant tests (all passing)
- Fuzz testing with Foundry (100K runs, no failures)
- Internal security review (findings in AUDIT_PREP.md)

TIMELINE:
- Preferred start: [date]
- Mainnet target: [date + 6 weeks]

REPO ACCESS:
- [GitHub link or zip attached]

Attached:
- AUDIT_PREP.md (known considerations, risk analysis)
- slither-report.json (static analysis results)
- Test coverage report

Looking forward to your proposal.

Best,
[Your name]
```

### 4.3 — Prepare for Audit Kickoff Call

Questions the auditors will ask:

```
□ What is the deployment order?
□ Which roles does each contract have?
□ What's the upgrade/migration plan?
□ Are there any off-chain components the contracts depend on?
□ What's the expected transaction volume?
□ What's the TVL at launch?
□ Is there a bug bounty program?
□ Who has admin keys at launch?
□ What's the governance transition plan?
```

Have answers ready. Reference the AUDIT_PREP.md for most of these.

---

## PHASE 5: Audit Period (Week 5-8)

### 5.1 — During the Audit

```
□ Assign a point of contact for auditor questions (respond within 4 hours)
□ DO NOT change the codebase during audit
□ Document any clarifications in a shared doc
□ Prepare a testing environment the auditors can use
□ Review interim findings as they come in
```

### 5.2 — Common Audit Findings to Expect

Based on similar protocols, expect findings in these areas:

**High/Critical (must fix before mainnet):**
- Reentrancy through fee refund path
- Role misconfiguration allowing privilege escalation
- Integer overflow in reward distribution
- Pairing check bypass in Groth16Verifier

**Medium (should fix):**
- Front-running on staking/unstaking
- Dust accumulation in reward distribution
- Timestamp dependence in freshness checks

**Low/Informational (nice to fix):**
- Missing event emissions
- Inconsistent error messages
- Gas optimization suggestions
- Code clarity improvements

---

## PHASE 6: Fix Audit Findings (Week 8-9)

### 6.1 — Triage Findings

```
CRITICAL → Fix immediately, request re-review
HIGH     → Fix before mainnet, request re-review
MEDIUM   → Fix if possible, document if accepted
LOW      → Fix or acknowledge
INFO     → Apply if easy, else document
```

### 6.2 — Apply Fixes

```bash
# Create a branch for fixes
git checkout -b audit-fixes

# For each finding:
# 1. Write a failing test that demonstrates the issue
# 2. Fix the code
# 3. Verify the test passes
# 4. Run full test suite to check for regressions

npx hardhat test
forge test --fuzz-runs 100000
slither .
```

### 6.3 — Request Re-Review

Send the fixed code back to the auditor:

```
Subject: Re: MCC Audit — Fixes for Review

Hi [auditor],

Attached are our fixes for all HIGH and CRITICAL findings:

- Finding #1 (Critical): [description] → Fixed in commit [hash]
- Finding #2 (High): [description] → Fixed in commit [hash]
- Finding #3 (Medium): [description] → Acknowledged, documented in code

Please review the fixes at your convenience. The diff is [X] lines
across [Y] files.

Full test suite passes (35 tests + 100K fuzz runs).
```

### 6.4 — Get the Final Audit Report

The audit firm delivers:
- PDF report with all findings, severity ratings, and fix status
- This report is PUBLIC — you'll share it with your community

---

## PHASE 7: Mainnet Deployment (Week 9-10)

### 7.1 — Pre-Deployment Checklist

```
CONTRACTS
□ All audit findings resolved or documented
□ Final audit report received and reviewed
□ All tests pass on the audited code (no changes after audit)
□ Gas estimates confirmed on forked mainnet

INFRASTRUCTURE
□ Gnosis Safe multisig created (3-of-5 for admin, 2-of-3 for ops)
□ All signers have hardware wallets (Ledger/Trezor)
□ Deployer wallet funded with ~2 ETH for deployment gas

OPERATIONAL
□ Monitoring set up (Tenderly, OpenZeppelin Defender, or custom)
□ Incident response plan documented
□ Emergency pause procedure tested
□ On-call rotation established
```

### 7.2 — Deploy to Mainnet

```bash
# Set mainnet config in .env
# MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
# DEPLOYER_KEY=0x_YOUR_MAINNET_DEPLOYER_KEY
# ADMIN_MULTISIG=0x_YOUR_GNOSIS_SAFE

# Deploy (the script has a 10-second safety delay for mainnet)
npx hardhat run scripts/deploy.js --network mainnet

# Register initial chains
DEPLOYMENT_FILE=deployments/mainnet-XXXX.json \
  npx hardhat run scripts/register-chains.js --network mainnet

# Deploy vesting
DEPLOYMENT_FILE=deployments/mainnet-XXXX.json \
  npx hardhat run scripts/setup-vesting.js --network mainnet

# Transfer admin to multisig (IRREVERSIBLE)
DEPLOYMENT_FILE=deployments/mainnet-XXXX.json \
  ADMIN_SAFE=0x_YOUR_ADMIN_SAFE \
  OPS_SAFE=0x_YOUR_OPS_SAFE \
  npx hardhat run scripts/transfer-admin.js --network mainnet
```

### 7.3 — Post-Deploy Verification

```bash
# Verify all contracts on Etherscan
# (auto-done by deploy script, but double-check)

# Verify roles are correctly assigned
# Use Etherscan Read Contract to call:
#   hasRole(DEFAULT_ADMIN_ROLE, ADMIN_SAFE) → should be true
#   hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER)   → should be false
```

### 7.4 — Launch Bug Bounty

Set up on Immunefi (https://immunefi.com):

```
Program details:
  Protocol: MCC Protocol
  Contracts: [list all 6 addresses]
  Chain: Ethereum Mainnet

Bounty tiers:
  Critical: $50,000 - $100,000
  High:     $10,000 - $50,000
  Medium:   $2,000 - $10,000
  Low:      $500 - $2,000

Total bounty pool: $100,000 - $250,000
```

---

## PHASE 8: Post-Launch (Week 10+)

### 8.1 — First 30 Days

```
□ Monitor all contract events 24/7
□ Verify first SPN proof publications work correctly
□ Process first cross-chain queries
□ Onboard first validators
□ Respond to bug bounty submissions within 24 hours
□ Weekly security review of contract state
```

### 8.2 — Ongoing Security

```
□ Monthly Slither runs on any code changes
□ Quarterly re-audit if significant changes
□ Maintain bug bounty program indefinitely
□ Monitor for dependency vulnerabilities (OpenZeppelin updates)
□ Track gas costs and optimize if needed
```

---

## Budget Summary

| Item | Low Estimate | High Estimate |
|------|-------------|---------------|
| Tier-1 Audit | $80,000 | $200,000 |
| Audit Contest (optional) | $30,000 | $80,000 |
| ZK Circuit Engineer | $20,000 | $50,000 |
| Deployment Gas (~2 ETH) | $5,000 | $8,000 |
| Bug Bounty Pool | $100,000 | $250,000 |
| Infrastructure (1 year) | $12,000 | $36,000 |
| **Total** | **$247,000** | **$624,000** |

> Note: Bug bounty pool is escrowed, not spent unless vulnerabilities
> are found. Most protocols recover 80%+ of their bounty pool.

---

## File Checklist — What You Have

```
✅ contracts/token/SyncToken.sol         — Production ERC-20
✅ contracts/token/SyncVesting.sol        — Vesting with cliff
✅ contracts/core/StateProofStore.sol     — Neural Mesh storage
✅ contracts/core/CoCValidator.sol        — Validator staking
✅ contracts/core/SynapseProtocol.sol     — Query engine
✅ contracts/core/Groth16Verifier.sol     — ZK proof verification
✅ contracts/interfaces/IZKVerifier.sol   — Verifier interface
✅ test/MCC.test.js                       — 22 unit tests
✅ test/Invariants.test.js                — 13 invariant tests
✅ scripts/deploy.js                      — Full deployment
✅ scripts/register-chains.js             — Chain registration
✅ scripts/setup-vesting.js               — Vesting deployment
✅ scripts/transfer-admin.js              — Admin → multisig
✅ hardhat.config.js                      — Compiler + networks
✅ slither.config.json                    — Static analysis
✅ AUDIT_PREP.md                          — Security documentation
✅ GAS_OPTIMIZATION.md                    — Gas optimization report
✅ .env.example                           — Config template
✅ .gitignore                             — Clean repo
```

**What you still need to create:**
```
⬜ Foundry fuzz tests (template provided above)
⬜ Coverage report (run: npx hardhat coverage)
⬜ ZK circuit (Circom) — needs ZK engineer
⬜ SPN node software — off-chain service, separate repo
⬜ Frontend dashboard — optional for launch
⬜ Documentation site — for developers using the Synapse API
```
