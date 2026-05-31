const hre = require("hardhat");
const fs = require("fs");

const { ethers } = hre;

/**
 * Deploy vesting contracts and create initial schedules.
 * Run AFTER the main deployment and BEFORE admin transfer.
 *
 * Usage:
 *   DEPLOYMENT_FILE=deployments/mainnet-xxx.json \
 *   TEAM_BENEFICIARY=0x... \
 *   PARTNER_BENEFICIARY=0x... \
 *   npx hardhat run scripts/setup-vesting.js --network mainnet
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployFile = process.env.DEPLOYMENT_FILE;

  if (!deployFile) {
    console.error("Set DEPLOYMENT_FILE env var");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const syncTokenAddr = deployment.contracts.syncToken;
  const syncToken = await ethers.getContractAt("SyncToken", syncTokenAddr);

  console.log("═══════════════════════════════════════════════════");
  console.log("  MCC Protocol — Vesting Setup");
  console.log("═══════════════════════════════════════════════════\n");

  // ── Deploy team vesting contract ──
  console.log("Deploying team vesting contract...");
  const SyncVesting = await ethers.getContractFactory("SyncVesting");

  const teamVesting = await SyncVesting.deploy(syncTokenAddr, deployer.address);
  await teamVesting.waitForDeployment();
  const teamVestingAddr = await teamVesting.getAddress();
  console.log(`  ✓ Team Vesting at: ${teamVestingAddr}`);

  // ── Deploy partner vesting contract ──
  console.log("Deploying partner vesting contract...");
  const partnerVesting = await SyncVesting.deploy(syncTokenAddr, deployer.address);
  await partnerVesting.waitForDeployment();
  const partnerVestingAddr = await partnerVesting.getAddress();
  console.log(`  ✓ Partner Vesting at: ${partnerVestingAddr}`);

  // ── Transfer tokens to vesting contracts ──
  // Note: In the main deploy, team/partner tokens were sent to placeholder
  // addresses. If they went to the deployer, transfer them now.
  const teamAmount = ethers.parseEther("150000000");    // 150M SYNC
  const partnerAmount = ethers.parseEther("100000000"); // 100M SYNC

  const deployerBalance = await syncToken.balanceOf(deployer.address);
  console.log(`\nDeployer SYNC balance: ${ethers.formatEther(deployerBalance)}`);

  if (deployerBalance >= teamAmount + partnerAmount) {
    let tx = await syncToken.transfer(teamVestingAddr, teamAmount);
    await tx.wait();
    console.log(`  ✓ Transferred ${ethers.formatEther(teamAmount)} SYNC to team vesting`);

    tx = await syncToken.transfer(partnerVestingAddr, partnerAmount);
    await tx.wait();
    console.log(`  ✓ Transferred ${ethers.formatEther(partnerAmount)} SYNC to partner vesting`);
  } else {
    console.log("  ⚠ Insufficient balance — tokens may already be in vesting wallets");
  }

  // ── Create vesting schedules ──
  const YEAR = 365 * 24 * 60 * 60;

  // Team schedule: 12-month cliff, 48-month total, revocable
  const teamBeneficiary = process.env.TEAM_BENEFICIARY || deployer.address;
  console.log(`\nCreating team schedule for ${teamBeneficiary}...`);
  let tx = await teamVesting.createSchedule(
    teamBeneficiary,
    teamAmount,
    YEAR,           // 12-month cliff
    4 * YEAR,       // 48-month total vesting
    true            // revocable
  );
  await tx.wait();
  console.log("  ✓ Team vesting schedule created (12m cliff, 48m total)");

  // Partner schedule: 6-month cliff, 36-month total, revocable
  const partnerBeneficiary = process.env.PARTNER_BENEFICIARY || deployer.address;
  console.log(`Creating partner schedule for ${partnerBeneficiary}...`);
  tx = await partnerVesting.createSchedule(
    partnerBeneficiary,
    partnerAmount,
    YEAR / 2,       // 6-month cliff
    3 * YEAR,       // 36-month total vesting
    true            // revocable
  );
  await tx.wait();
  console.log("  ✓ Partner vesting schedule created (6m cliff, 36m total)");

  // ── Summary ──
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  VESTING SETUP COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Team Vesting:    ${teamVestingAddr}`);
  console.log(`  Partner Vesting: ${partnerVestingAddr}`);
  console.log("═══════════════════════════════════════════════════");

  // Save to deployment file
  deployment.contracts.teamVesting = teamVestingAddr;
  deployment.contracts.partnerVesting = partnerVestingAddr;
  require("fs").writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\n  Updated deployment file: ${deployFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
