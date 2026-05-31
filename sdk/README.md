# @mcc-protocol/sdk

TypeScript SDK for [Multi-Chain Consciousness](https://github.com/mcc-protocol) — read any blockchain's state from any other blockchain, with zero-knowledge proof verification.

## Install

```bash
npm install @mcc-protocol/sdk ethers
```

## Quick Start

```typescript
import { MCCClient, QueryType, MCC_CHAINS } from "@mcc-protocol/sdk";
import { ethers } from "ethers";

// Connect to provider
const provider = new ethers.JsonRpcProvider("https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY");

// Initialize client with deployed contract addresses
const client = new MCCClient(provider, {
  syncToken: "0x...",
  stateProofStore: "0x...",
  cocValidator: "0x...",
  synapseProtocol: "0x...",
});

// Check if Solana state is queryable
const available = await client.isChainAvailable(MCC_CHAINS.SOLANA);
console.log("Solana available:", available);

// Query a balance on Solana (from Ethereum)
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const signedClient = new MCCClient(signer, addresses);

const result = await signedClient.queryBalance(
  MCC_CHAINS.SOLANA,
  "0xUserSolanaAddress"
);

console.log("Block height:", result.blockHeight);
console.log("State root:", result.stateRoot);
console.log("Verified:", result.verified);
```

## API Reference

### Queries

```typescript
// Single-chain balance query
const result = await client.queryBalance(chainId, address);

// Single-chain storage query
const result = await client.queryStorage(chainId, contract, slot);

// NFT ownership query
const result = await client.queryNFTOwnership(chainId, nftContract);

// Atomic multi-chain query
const results = await client.queryMulti([
  { targetChainId: 1n, queryType: QueryType.BALANCE, targetAddress: "0x..." },
  { targetChainId: 2n, queryType: QueryType.BALANCE, targetAddress: "0x..." },
]);
```

### Chain Info

```typescript
const available = await client.isChainAvailable(chainId);
const age = await client.getProofAge(chainId);          // seconds
const proof = await client.getLatestProof(chainId);      // full proof data
const info = await client.getChainInfo(chainId);          // chain metadata
const chains = await client.getAllChainIds();              // all chain IDs
```

### Validators

```typescript
const validator = await client.getValidator("0x...");
const count = await client.getActiveValidatorCount();
const epoch = await client.getCurrentEpoch();
```

### Token

```typescript
const stats = await client.getTokenStats();
console.log("Supply:", ethers.formatEther(stats.totalSupply));
console.log("Burned:", ethers.formatEther(stats.totalBurned));
console.log("Deflationary:", stats.isNetDeflationary);

const balance = await client.getSyncBalance("0x...");
```

### Events

```typescript
// Listen for new proofs
client.onProofPublished((chainId, blockHeight, stateRoot) => {
  console.log(`New proof: chain=${chainId} block=${blockHeight}`);
});

// Listen for queries
client.onQueryExecuted((caller, chainId, queryType) => {
  console.log(`Query: ${caller} → chain ${chainId}`);
});

// Cleanup
client.removeAllListeners();
```

## Chain IDs

```typescript
import { MCC_CHAINS } from "@mcc-protocol/sdk";

MCC_CHAINS.ETHEREUM // 1n
MCC_CHAINS.SOLANA   // 2n
MCC_CHAINS.BITCOIN  // 3n
MCC_CHAINS.POLYGON  // 137n
```

## License

MIT
