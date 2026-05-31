const hre = require("hardhat");
const fs = require("fs");

const { ethers } = hre;

/**
 * Register initial chains in the Neural Mesh.
 * Run after deployment with the deployment JSON.
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/sepolia-xxx.json \
 *   npx hardhat run scripts/register-chains.js --network sepolia
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  // Load deployment addresses
  const deployFile = process.env.DEPLOYMENT_FILE;
  if (!deployFile) {
    console.error("Set DEPLOYMENT_FILE env var to the deployment JSON path");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const storeAddr = deployment.contracts.stateProofStore;

  console.log(`Loading StateProofStore at ${storeAddr}...`);
  const store = await ethers.getContractAt("StateProofStore", storeAddr);

  // ── Chain definitions ──
  // In production, SPN addresses would be real deployed SPN node addresses.
  // These are placeholders for testnet.

  const chains = [
    {
      chainId: 1n,
      name: "Ethereum",
      model: 0,              // ACCOUNT_BASED
      avgBlockTimeMs: 12000,
      maxStalenessSeconds: 120,
      spn: process.env.ETH_SPN_ADDRESS || deployer.address,
    },
    {
      chainId: 2n,
      name: "Solana",
      model: 0,              // ACCOUNT_BASED (SVM uses accounts)
      avgBlockTimeMs: 400,
      maxStalenessSeconds: 30,
      spn: process.env.SOL_SPN_ADDRESS || deployer.address,
    },
    {
      chainId: 3n,
      name: "Bitcoin",
      model: 1,              // UTXO_BASED
      avgBlockTimeMs: 600000, // 10 minutes
      maxStalenessSeconds: 3600,
      spn: process.env.BTC_SPN_ADDRESS || deployer.address,
    },
    {
      chainId: 137n,
      name: "Polygon",
      model: 0,
      avgBlockTimeMs: 2000,
      maxStalenessSeconds: 60,
      spn: process.env.POLYGON_SPN_ADDRESS || deployer.address,
    },
  ];

  console.log(`\nRegistering ${chains.length} chains on ${network}...\n`);

  for (const chain of chains) {
    try {
      const existing = await store.chains(chain.chainId);
      if (existing.active) {
        console.log(`  ⏭ ${chain.name} (ID: ${chain.chainId}) — already registered`);
        continue;
      }

      const tx = await store.registerChain(
        chain.chainId,
        chain.name,
        chain.model,
        chain.avgBlockTimeMs,
        chain.maxStalenessSeconds,
        chain.spn
      );
      await tx.wait();
      console.log(`  ✓ ${chain.name} (ID: ${chain.chainId}) — registered (SPN: ${chain.spn})`);
    } catch (err) {
      console.log(`  ✗ ${chain.name} — failed: ${err.message}`);
    }
  }

  const count = await store.chainCount();
  console.log(`\nTotal chains registered: ${count}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
