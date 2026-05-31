# Security Policy

## Reporting a Vulnerability

**DO NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in the MCC Protocol, please report it responsibly:

### Email
Send details to: **security@mcc-protocol.org**

### What to Include
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline
- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix timeline**: Depends on severity (critical: 24-72 hours)

## Scope

The following are in scope for security reports:

| Component | Repository |
|---|---|
| SyncToken | `contracts/token/SyncToken.sol` |
| SyncVesting | `contracts/token/SyncVesting.sol` |
| StateProofStore | `contracts/core/StateProofStore.sol` |
| CoCValidator | `contracts/core/CoCValidator.sol` |
| SynapseProtocol | `contracts/core/SynapseProtocol.sol` |
| Groth16Verifier | `contracts/core/Groth16Verifier.sol` |
| SDK | `sdk/src/**` |

### Out of Scope
- Issues in dependencies (OpenZeppelin) — report to them directly
- Issues requiring social engineering
- Denial of service via gas griefing (known limitation)
- Front-running of public mempool transactions (inherent to Ethereum)

## Bug Bounty

We plan to launch a formal bug bounty program on [Immunefi](https://immunefi.com) before mainnet.

Until then, valid security reports will be recognized in our Hall of Fame and may be eligible for retroactive rewards after token launch.

## Security Measures

See [`AUDIT_PREP.md`](AUDIT_PREP.md) for our security architecture, known considerations, and audit preparation status.

### Tooling We Use
- [Slither](https://github.com/crytic/slither) — static analysis (runs on every PR)
- [Mythril](https://github.com/Consensys/mythril) — symbolic execution
- [Foundry](https://github.com/foundry-rs/foundry) — fuzz testing (100K+ iterations)
- OpenZeppelin contracts v4.9 — battle-tested base contracts

## Supported Versions

| Version | Supported |
|---|---|
| main branch | Yes |
| Testnet deployments | Yes |
| Mainnet deployments | Not yet deployed |

## Acknowledgments

We thank the following researchers for responsible disclosures:

*No reports yet — be the first!*
