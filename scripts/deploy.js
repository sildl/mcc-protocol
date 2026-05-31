const hre = require("hardhat");

const { ethers } = hre;

/**
 * MCC Protocol — Mainnet Deployment Script
 *
 * Deployment order:
 *   1. SyncToken       — ERC-20 with burn + emission
 *   2. StateProofStore — Neural Mesh storage
 *   3. CoCValidator    — Validator staking + slashing
 *   4. SynapseProtocol — Cross-chain query engine
 *   5. Wire contracts  — Grant roles, link references
 *   6. Verify          — Etherscan verification
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   npx hardhat run scripts/deploy.js --network mainnet
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  console.log("═══════════════════════════════════════════════════");
  console.log("  MCC Protocol — Deployment");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Network:   ${network}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("═══════════════════════════════════════════════════\n");

  // ── Load configuration ──
  const ADMIN        = process.env.ADMIN_MULTISIG || deployer.address;
  const TREASURY     = process.env.TREASURY_ADDRESS || deployer.address;
  const TEAM_VESTING = process.env.TEAM_VESTING_ADDRESS || deployer.address;
  const PARTNER_VEST = process.env.PARTNER_VESTING_ADDRESS || deployer.address;
  const ECOSYSTEM    = process.env.ECOSYSTEM_FUND_ADDRESS || deployer.address;
  const ZK_VERIFIER  = process.env.ZK_VERIFIER_ADDRESS || ethers.ZeroAddress;
  const QUERY_FEE    = BigInt(process.env.QUERY_FEE_WEI || "1000000000000000"); // 0.001 ETH

  console.log("Configuration:");
  console.log(`  Admin:        ${ADMIN}`);
  console.log(`  Treasury:     ${TREASURY}`);
  console.log(`  Team Vesting: ${TEAM_VESTING}`);
  console.log(`  Partners:     ${PARTNER_VEST}`);
  console.log(`  Ecosystem:    ${ECOSYSTEM}`);
  console.log(`  ZK Verifier:  ${ZK_VERIFIER}`);
  console.log(`  Query Fee:    ${ethers.formatEther(QUERY_FEE)} ETH\n`);

  // Safety check for mainnet
  if (network === "mainnet") {
    console.log("⚠️  MAINNET DEPLOYMENT — 10 second delay for confirmation...");
    await new Promise(r => setTimeout(r, 10000));
    if (ADMIN === deployer.address) {
      console.log("⚠️  WARNING: Admin is set to deployer address, not a multisig!");
      console.log("   This is acceptable for initial deployment but must be");
      console.log("   transferred to a multisig before going live.\n");
    }
  }

  const deployed = {};

  // ════════════════════════════════════════════════════
  // STEP 1: Deploy SyncToken
  // ════════════════════════════════════════════════════
  console.log("Step 1/6: Deploying SyncToken...");
  const SyncToken = await ethers.getContractFactory("SyncToken");
  const syncToken = await SyncToken.deploy(
    ADMIN, TREASURY, TEAM_VESTING, PARTNER_VEST, ECOSYSTEM
  );
  await syncToken.waitForDeployment();
  deployed.syncToken = await syncToken.getAddress();
  console.log(`  ✓ SyncToken deployed at: ${deployed.syncToken}`);
  console.log(`    Total supply: ${ethers.formatEther(await syncToken.totalSupply())} SYNC\n`);

  // ════════════════════════════════════════════════════
  // STEP 2: Deploy StateProofStore
  // ════════════════════════════════════════════════════
  console.log("Step 2/6: Deploying StateProofStore...");
  const StateProofStore = await ethers.getContractFactory("StateProofStore");
  const stateProofStore = await StateProofStore.deploy(ADMIN, ZK_VERIFIER);
  await stateProofStore.waitForDeployment();
  deployed.stateProofStore = await stateProofStore.getAddress();
  console.log(`  ✓ StateProofStore deployed at: ${deployed.stateProofStore}\n`);

  // ════════════════════════════════════════════════════
  // STEP 3: Deploy CoCValidator
  // ════════════════════════════════════════════════════
  console.log("Step 3/6: Deploying CoCValidator...");
  const CoCValidator = await ethers.getContractFactory("CoCValidator");
  const cocValidator = await CoCValidator.deploy(ADMIN, deployed.syncToken);
  await cocValidator.waitForDeployment();
  deployed.cocValidator = await cocValidator.getAddress();
  console.log(`  ✓ CoCValidator deployed at: ${deployed.cocValidator}\n`);

  // ════════════════════════════════════════════════════
  // STEP 4: Deploy SynapseProtocol
  // ════════════════════════════════════════════════════
  console.log("Step 4/6: Deploying SynapseProtocol...");
  const SynapseProtocol = await ethers.getContractFactory("SynapseProtocol");
  const synapseProtocol = await SynapseProtocol.deploy(
    ADMIN, deployed.stateProofStore, QUERY_FEE
  );
  await synapseProtocol.waitForDeployment();
  deployed.synapseProtocol = await synapseProtocol.getAddress();
  console.log(`  ✓ SynapseProtocol deployed at: ${deployed.synapseProtocol}\n`);

  // ════════════════════════════════════════════════════
  // STEP 5: Wire contracts (grant roles)
  // ════════════════════════════════════════════════════
  console.log("Step 5/6: Wiring contracts...");

  // If deployer is admin, wire directly. Otherwise these must be
  // executed via the admin multisig after deployment.
  if (ADMIN === deployer.address) {
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));

    // CoC Validator can mint SYNC for validator rewards
    let tx = await syncToken.grantRole(MINTER_ROLE, deployed.cocValidator);
    await tx.wait();
    console.log("  ✓ Granted MINTER_ROLE to CoCValidator");

    // Synapse Protocol can burn SYNC for fee burns
    tx = await syncToken.grantRole(BURNER_ROLE, deployed.synapseProtocol);
    await tx.wait();
    console.log("  ✓ Granted BURNER_ROLE to SynapseProtocol");

    console.log("  ✓ All roles wired\n");
  } else {
    console.log("  ⚠ Admin is a multisig — role grants must be executed separately:");
    console.log(`    syncToken.grantRole(MINTER_ROLE, ${deployed.cocValidator})`);
    console.log(`    syncToken.grantRole(BURNER_ROLE, ${deployed.synapseProtocol})\n`);
  }

  // ════════════════════════════════════════════════════
  // STEP 6: Verify on Etherscan
  // ════════════════════════════════════════════════════
  if (network !== "hardhat" && network !== "localhost") {
    console.log("Step 6/6: Verifying contracts on Etherscan...");

    const contracts = [
      {
        name: "SyncToken",
        address: deployed.syncToken,
        args: [ADMIN, TREASURY, TEAM_VESTING, PARTNER_VEST, ECOSYSTEM],
      },
      {
        name: "StateProofStore",
        address: deployed.stateProofStore,
        args: [ADMIN, ZK_VERIFIER],
      },
      {
        name: "CoCValidator",
        address: deployed.cocValidator,
        args: [ADMIN, deployed.syncToken],
      },
      {
        name: "SynapseProtocol",
        address: deployed.synapseProtocol,
        args: [ADMIN, deployed.stateProofStore, QUERY_FEE],
      },
    ];

    for (const c of contracts) {
      try {
        await hre.run("verify:verify", {
          address: c.address,
          constructorArguments: c.args,
        });
        console.log(`  ✓ ${c.name} verified`);
      } catch (err) {
        console.log(`  ✗ ${c.name} verification failed: ${err.message}`);
      }
    }
  } else {
    console.log("Step 6/6: Skipping verification (local network)\n");
  }

  // ════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  SyncToken:       ${deployed.syncToken}`);
  console.log(`  StateProofStore: ${deployed.stateProofStore}`);
  console.log(`  CoCValidator:    ${deployed.cocValidator}`);
  console.log(`  SynapseProtocol: ${deployed.synapseProtocol}`);
  console.log("═══════════════════════════════════════════════════");

  // Write deployment addresses to file
  const fs = require("fs");
  const output = {
    network,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployed,
    configuration: {
      admin: ADMIN,
      treasury: TREASURY,
      zkVerifier: ZK_VERIFIER,
      queryFee: QUERY_FEE.toString(),
    },
  };

  const filename = `deployments/${network}-${Date.now()}.json`;
  require("fs").mkdirSync("deployments", { recursive: true });
  require("fs").writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n  Deployment saved to: ${filename}`);

  // ════════════════════════════════════════════════════
  // POST-DEPLOYMENT CHECKLIST
  // ════════════════════════════════════════════════════
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║  POST-DEPLOYMENT CHECKLIST                        ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log("║  □ Transfer admin roles to multisig               ║");
  console.log("║  □ Register initial chains (Ethereum, Polygon)    ║");
  console.log("║  □ Deploy and register SPN nodes                  ║");
  console.log("║  □ Set ZK verifier (when ready)                   ║");
  console.log("║  □ Grant SLASHER_ROLE to fraud proof contract     ║");
  console.log("║  □ Fund validator reward pool                     ║");
  console.log("║  □ Verify all contracts on Etherscan              ║");
  console.log("║  □ Run integration tests against deployment       ║");
  console.log("║  □ Announce deployment addresses publicly         ║");
  console.log("╚═══════════════════════════════════════════════════╝");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
