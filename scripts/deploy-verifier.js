const hre = require("hardhat");
const fs = require("fs");

const { ethers } = hre;

/**
 * Deploy the Groth16Verifier and register it with StateProofStore.
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/sepolia-xxx.json \
 *   npx hardhat run scripts/deploy-verifier.js --network sepolia
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployFile = process.env.DEPLOYMENT_FILE;

  if (!deployFile) {
    console.error("Set DEPLOYMENT_FILE env var");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));

  console.log("Deploying Groth16Verifier...");
  const Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Verifier.deploy(deployer.address);
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`  ✓ Groth16Verifier at: ${verifierAddr}`);

  // Link to StateProofStore
  console.log("Linking verifier to StateProofStore...");
  const store = await ethers.getContractAt("StateProofStore", deployment.contracts.stateProofStore);
  const tx = await store.setZKVerifier(verifierAddr);
  await tx.wait();
  console.log("  ✓ StateProofStore now uses Groth16Verifier");

  // Save
  deployment.contracts.groth16Verifier = verifierAddr;
  require("fs").writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`  ✓ Saved to ${deployFile}`);

  // Verify on Etherscan
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    try {
      await hre.run("verify:verify", {
        address: verifierAddr,
        constructorArguments: [deployer.address],
      });
      console.log("  ✓ Verified on Etherscan");
    } catch (err) {
      console.log(`  ✗ Verification failed: ${err.message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
