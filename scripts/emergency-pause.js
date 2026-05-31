const hre = require("hardhat");
const fs = require("fs");

const { ethers } = hre;

/**
 * EMERGENCY: Pause all protocol contracts.
 *
 * This script pauses every contract in a single transaction batch.
 * Use when a vulnerability is discovered or suspicious activity is detected.
 *
 * WHO CAN RUN THIS:
 *   - Any address with OPERATOR_ROLE on the contracts
 *   - If admin is a multisig, this must be executed through the Safe
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/mainnet-xxx.json \
 *   npx hardhat run scripts/emergency-pause.js --network mainnet
 */

async function main() {
  const [caller] = await ethers.getSigners();
  const deployFile = process.env.DEPLOYMENT_FILE;

  if (!deployFile) {
    console.error("Set DEPLOYMENT_FILE env var");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const addrs = deployment.contracts;

  console.log("🚨 EMERGENCY PAUSE — ALL CONTRACTS");
  console.log(`   Caller: ${caller.address}`);
  console.log(`   Network: ${hre.network.name}\n`);

  const contracts = [
    { name: "SyncToken", addr: addrs.syncToken },
    { name: "StateProofStore", addr: addrs.stateProofStore },
    { name: "CoCValidator", addr: addrs.cocValidator },
    { name: "SynapseProtocol", addr: addrs.synapseProtocol },
  ];

  for (const c of contracts) {
    try {
      const contract = await ethers.getContractAt(c.name, c.addr);
      const isPaused = await contract.paused();

      if (isPaused) {
        console.log(`  ⏸ ${c.name} — already paused`);
      } else {
        const tx = await contract.pause();
        await tx.wait();
        console.log(`  🔴 ${c.name} — PAUSED (tx: ${tx.hash})`);
      }
    } catch (err) {
      console.log(`  ✗ ${c.name} — FAILED: ${err.message}`);
    }
  }

  console.log("\n✅ Emergency pause complete.");
  console.log("   Next steps:");
  console.log("   1. Investigate the issue");
  console.log("   2. Fix the vulnerability");
  console.log("   3. Get audit review of the fix");
  console.log("   4. Unpause via Gnosis Safe (requires DEFAULT_ADMIN_ROLE)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
