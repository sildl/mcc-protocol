const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Protocol Invariants", function () {
  let admin, treasury, team, partners, ecosystem, alice, bob;
  let syncToken, stateProofStore, cocValidator, synapseProtocol;
  const MIN_STAKE = ethers.parseEther("100000");

  beforeEach(async function () {
    [admin, treasury, team, partners, ecosystem, alice, bob] = await ethers.getSigners();

    const SyncToken = await ethers.getContractFactory("SyncToken");
    syncToken = await SyncToken.deploy(admin.address, treasury.address, team.address, partners.address, ecosystem.address);

    const StateProofStore = await ethers.getContractFactory("StateProofStore");
    stateProofStore = await StateProofStore.deploy(admin.address, ethers.ZeroAddress);

    const CoCValidator = await ethers.getContractFactory("CoCValidator");
    cocValidator = await CoCValidator.deploy(admin.address, await syncToken.getAddress());

    const SynapseProtocol = await ethers.getContractFactory("SynapseProtocol");
    synapseProtocol = await SynapseProtocol.deploy(admin.address, await stateProofStore.getAddress(), ethers.parseEther("0.001"));

    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await syncToken.connect(admin).grantRole(MINTER_ROLE, await cocValidator.getAddress());
  });

  describe("INV-1: Supply cap", function () {
    it("totalSupply <= MAX_SUPPLY", async function () {
      expect(await syncToken.totalSupply()).to.be.lte(await syncToken.MAX_SUPPLY());
    });

    it("totalSupply == initial + emitted - burned", async function () {
      const totalSupply = await syncToken.totalSupply();
      const initialMinted = ethers.parseEther("650000000");
      const emitted = await syncToken.validatorRewardsEmitted();
      const burned = await syncToken.totalBurned();
      expect(totalSupply).to.equal(initialMinted + emitted - burned);
    });
  });

  describe("INV-2: Validator stake accounting", function () {
    it("sum of stakes == contract balance", async function () {
      await syncToken.connect(admin).transfer(alice.address, MIN_STAKE);
      await syncToken.connect(alice).approve(await cocValidator.getAddress(), MIN_STAKE);
      await cocValidator.connect(alice).joinValidatorSet(MIN_STAKE);

      const aliceInfo = await cocValidator.getValidatorInfo(alice.address);
      const contractBalance = await syncToken.balanceOf(await cocValidator.getAddress());
      const slashed = await cocValidator.slashedFundsTotal();
      expect(aliceInfo.stake + slashed).to.equal(contractBalance);
    });
  });

  describe("INV-3: Proof monotonicity", function () {
    it("block heights are strictly monotonic", async function () {
      await stateProofStore.connect(admin).registerChain(1n, "Eth", 0, 12000, 120, alice.address);
      const proof = ethers.randomBytes(256);

      await stateProofStore.connect(alice).publishProof(1n, 100n, ethers.keccak256("0x01"), proof);
      await stateProofStore.connect(alice).publishProof(1n, 200n, ethers.keccak256("0x02"), proof);

      await expect(
        stateProofStore.connect(alice).publishProof(1n, 150n, ethers.keccak256("0x03"), proof)
      ).to.be.revertedWithCustomError(stateProofStore, "ProofDoesNotAdvance");
    });
  });

  describe("INV-4: Fee accounting", function () {
    it("feeAccumulator matches ETH held", async function () {
      await stateProofStore.connect(admin).registerChain(1n, "Eth", 0, 12000, 120, alice.address);
      await stateProofStore.connect(alice).publishProof(1n, 100n, ethers.keccak256("0x01"), ethers.randomBytes(256));

      const fee = ethers.parseEther("0.001");
      const query = {
        targetChainId: 1n, queryType: 0, targetAddress: bob.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 120,
      };

      await synapseProtocol.connect(bob).queryState(query, { value: fee });
      await synapseProtocol.connect(bob).queryState(query, { value: fee });

      const accumulator = await synapseProtocol.feeAccumulator();
      const ethBalance = await ethers.provider.getBalance(await synapseProtocol.getAddress());
      expect(accumulator).to.equal(ethBalance);
      expect(accumulator).to.equal(fee * 2n);
    });
  });

  describe("INV-5: Slashing is conservative", function () {
    it("slash never creates tokens", async function () {
      await syncToken.connect(admin).transfer(alice.address, MIN_STAKE);
      await syncToken.connect(alice).approve(await cocValidator.getAddress(), MIN_STAKE);
      await cocValidator.connect(alice).joinValidatorSet(MIN_STAKE);

      const SLASHER = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));
      await cocValidator.connect(admin).grantRole(SLASHER, admin.address);

      const stakeBefore = (await cocValidator.getValidatorInfo(alice.address)).stake;
      await cocValidator.connect(admin).slashValidator(alice.address, 1, 1n);
      const stakeAfter = (await cocValidator.getValidatorInfo(alice.address)).stake;

      expect(stakeAfter).to.be.lt(stakeBefore);
      const balance = await syncToken.balanceOf(await cocValidator.getAddress());
      expect(balance).to.equal(MIN_STAKE);
    });
  });

  describe("INV-6: Paused contracts reject mutations", function () {
    it("SyncToken: no transfers when paused", async function () {
      await syncToken.connect(admin).pause();
      await expect(syncToken.connect(admin).transfer(bob.address, 1n)).to.be.reverted;
    });

    it("StateProofStore: no publishing when paused", async function () {
      await stateProofStore.connect(admin).registerChain(1n, "Eth", 0, 12000, 120, alice.address);
      await stateProofStore.connect(admin).pause();
      await expect(
        stateProofStore.connect(alice).publishProof(1n, 100n, ethers.keccak256("0x01"), ethers.randomBytes(256))
      ).to.be.reverted;
    });
  });
});
