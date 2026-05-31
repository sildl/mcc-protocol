# Contributing to MCC Protocol

Thanks for your interest in contributing! MCC is open source and community-driven.

## Getting Started

```bash
git clone https://github.com/sildl/mcc-protocol.git
cd mcc-protocol
npm install
npx hardhat compile
npx hardhat test
```

## Ways to Contribute

### Good First Issues
Look for issues labeled [`good first issue`](https://github.com/sildl/mcc-protocol/labels/good%20first%20issue). These are specifically scoped for newcomers.

### Code
- Bug fixes
- Gas optimizations (must include before/after benchmarks)
- New test cases (especially edge cases and invariants)
- SDK improvements

### Documentation
- Fix typos or unclear explanations
- Add integration examples
- Improve inline code comments
- Translate documentation

### Security
- Run static analysis tools and report findings
- Write fuzz tests for edge cases
- Review code for potential vulnerabilities (see [SECURITY.md](SECURITY.md) for responsible disclosure)

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Write or update tests
4. Run the full test suite: `npx hardhat test`
5. Run Slither: `slither . --config-file slither.config.json`
6. Submit a PR using the template

## Code Standards

### Solidity
- Pragma: `^0.8.24`
- Use OpenZeppelin contracts where possible
- Custom errors over require strings
- NatSpec documentation on all public functions
- Events for all state changes

### Tests
- One `describe` block per contract
- Test happy path, reverts, edge cases, and access control
- Use descriptive test names: `"should reject proof with non-advancing block height"`

### Commits
- Use conventional commits: `fix:`, `feat:`, `test:`, `docs:`, `chore:`
- Keep commits atomic — one logical change per commit
- Reference issues: `fix: prevent double-join (#42)`

## Review Process

1. All PRs require at least 1 review
2. CI must pass (tests + Slither)
3. Security-sensitive changes require 2 reviews
4. Maintainers may request changes before merging

## Community

- [Discord](https://discord.gg/YOUR_INVITE) — `#dev` channel for technical discussion
- [Twitter](https://twitter.com/mcc_protocol) — project updates

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
