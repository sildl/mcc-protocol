# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-01

### Added
- SyncToken — ERC-20 with EIP-2612 permits, halving emission, protocol burns
- SyncVesting — linear vesting with cliff period and revocation
- StateProofStore — Neural Mesh storage with pluggable ZK verifier
- CoCValidator — validator staking, slashing (3 tiers), epoch rewards
- SynapseProtocol — cross-chain query engine with atomic multi-chain support
- Groth16Verifier — on-chain ZK-SNARK verification via bn128 precompiles
- IZKVerifier — verifier interface for StateProofStore
- 35 unit and invariant tests
- Deployment scripts (deploy, register chains, vesting setup, admin transfer, emergency pause)
- TypeScript SDK (@mcc-protocol/sdk)
- Gas optimization report
- Audit preparation documentation
- Launch playbook (8 phases)
- Slither configuration
- Foundry configuration for fuzz testing
- GitHub Actions CI (tests + Slither)
