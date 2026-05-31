const hre = require("hardhat");
const fs = require("fs");

const { ethers } = hre;

/**
 * Transfer all admin roles from deployer EOA to Gnosis Safe multisig.
 *
 * CRITICAL: Run this AFTER verifying all contracts work correctly.
 *           This is a ONE-WAY operation — the deployer loses all control.
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/mainnet-xxx.json \
 *   ADMIN_SAFE=0x_YOUR_GNOSIS_SAFE \
 *   OPS_SAFE=0x_YOUR_OPS_MULTISIG \
 *   npx hardhat run scripts/transfer-admin.js --network mainnet
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  const ADMIN_SAFE = process.env.ADMIN_SAFE;
  const OPS_SAFE   = process.env.OPS_SAFE;
  const deployFile = process.env.DEPLOYMENT_FILE;

  if (!ADMIN_SAFE || !OPS_SAFE || !deployFile) {
    console.error("Required env vars: ADMIN_SAFE, OPS_SAFE, DEPLOYMENT_FILE");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const addrs = deployment.contracts;

  console.log("═══════════════════════════════════════════════════");
  console.log("  MCC Protocol — Admin Transfer to Multisig");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Network:     ${network}`);
  console.log(`  Deployer:    ${deployer.address}`);
  console.log(`  Admin Safe:  ${ADMIN_SAFE}`);
  console.log(`  Ops Safe:    ${OPS_SAFE}`);
  console.log("═══════════════════════════════════════════════════\n");

  if (network === "mainnet") {
    console.log("⚠️  MAINNET — This is irreversible. 15 second delay...");
    await new Promise(r => setTimeout(r, 15000));
  }

  const DEFAULT_ADMIN = ethers.ZeroHash; // 0x00 is DEFAULT_ADMIN_ROLE
  const MINTER_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const SPN_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("SPN_ROLE"));
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const SLASHER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));

  // ── 1. SyncToken ──
  console.log("1/4  SyncToken...");
  const syncToken = await ethers.getContractAt("SyncToken", addrs.syncToken);

  // Grant admin role to Safe
  let tx = await syncToken.grantRole(DEFAULT_ADMIN, ADMIN_SAFE);
  await tx.wait();
  console.log("  ✓ Granted DEFAULT_ADMIN to Safe");

  // Revoke from deployer
  tx = await syncToken.revokeRole(DEFAULT_ADMIN, deployer.address);
  await tx.wait();
  console.log("  ✓ Revoked DEFAULT_ADMIN from deployer");

  // Verify
  console.log(`  ✓ Safe is admin: ${await syncToken.hasRole(DEFAULT_ADMIN, ADMIN_SAFE)}`);
  console.log(`  ✓ Deployer removed: ${!(await syncToken.hasRole(DEFAULT_ADMIN, deployer.address))}\n`);

  // ── 2. StateProofStore ──
  console.log("2/4  StateProofStore...");
  const store = await ethers.getContractAt("StateProofStore", addrs.stateProofStore);

  tx = await store.grantRole(DEFAULT_ADMIN, ADMIN_SAFE);
  await tx.wait();
  tx = await store.grantRole(OPERATOR_ROLE, OPS_SAFE);
  await tx.wait();
  console.log("  ✓ Granted DEFAULT_ADMIN to Safe");
  console.log("  ✓ Granted OPERATOR_ROLE to Ops Safe");

  // Revoke deployer roles
  tx = await store.revokeRole(OPERATOR_ROLE, deployer.address);
  await tx.wait();
  tx = await store.revokeRole(DEFAULT_ADMIN, deployer.address);
  await tx.wait();
  console.log("  ✓ Revoked all deployer roles\n");

  // ── 3. CoCValidator ──
  console.log("3/4  CoCValidator...");
  const coc = await ethers.getContractAt("CoCValidator", addrs.cocValidator);

  tx = await coc.grantRole(DEFAULT_ADMIN, ADMIN_SAFE);
  await tx.wait();
  tx = await coc.grantRole(OPERATOR_ROLE, OPS_SAFE);
  await tx.wait();
  console.log("  ✓ Granted DEFAULT_ADMIN to Safe");
  console.log("  ✓ Granted OPERATOR_ROLE to Ops Safe");

  // Revoke deployer roles
  tx = await coc.revokeRole(SLASHER_ROLE, deployer.address);
  await tx.wait();
  tx = await coc.revokeRole(OPERATOR_ROLE, deployer.address);
  await tx.wait();
  tx = await coc.revokeRole(DEFAULT_ADMIN, deployer.address);
  await tx.wait();
  console.log("  ✓ Revoked all deployer roles\n");

  // ── 4. SynapseProtocol ──
  console.log("4/4  SynapseProtocol...");
  const synapse = await ethers.getContractAt("SynapseProtocol", addrs.synapseProtocol);

  tx = await synapse.grantRole(DEFAULT_ADMIN, ADMIN_SAFE);
  await tx.wait();
  tx = await synapse.grantRole(OPERATOR_ROLE, OPS_SAFE);
  await tx.wait();
  console.log("  ✓ Granted DEFAULT_ADMIN to Safe");
  console.log("  ✓ Granted OPERATOR_ROLE to Ops Safe");

  tx = await synapse.revokeRole(OPERATOR_ROLE, deployer.address);
  await tx.wait();
  tx = await synapse.revokeRole(DEFAULT_ADMIN, deployer.address);
  await tx.wait();
  console.log("  ✓ Revoked all deployer roles\n");

  // ── Verification ──
  console.log("═══════════════════════════════════════════════════");
  console.log("  TRANSFER COMPLETE — VERIFICATION");
  console.log("═══════════════════════════════════════════════════");

  const contracts = [
    { name: "SyncToken", instance: syncToken },
    { name: "StateProofStore", instance: store },
    { name: "CoCValidator", instance: coc },
    { name: "SynapseProtocol", instance: synapse },
  ];

  let allClean = true;
  for (const c of contracts) {
    const deployerIsAdmin = await c.instance.hasRole(DEFAULT_ADMIN, deployer.address);
    const safeIsAdmin = await c.instance.hasRole(DEFAULT_ADMIN, ADMIN_SAFE);

    if (deployerIsAdmin) {
      console.log(`  ✗ ${c.name}: deployer STILL has admin!`);
      allClean = false;
    } else if (!safeIsAdmin) {
      console.log(`  ✗ ${c.name}: Safe does NOT have admin!`);
      allClean = false;
    } else {
      console.log(`  ✓ ${c.name}: Safe=${safeIsAdmin}, Deployer=${deployerIsAdmin}`);
    }
  }

  if (allClean) {
    console.log("\n  ✅ All contracts transferred successfully.");
    console.log("  The deployer EOA no longer controls any protocol contracts.");
  } else {
    console.log("\n  ⚠️  Some transfers may have failed — review above.");
  }

  console.log("═══════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Transfer failed:", error);
    process.exit(1);
  });
