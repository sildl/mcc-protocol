const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MCC Protocol — Production Test Suite", function () {

  let admin, treasury, team, partners, ecosystem;
  let alice, bob, charlie;
  let syncToken, stateProofStore, cocValidator, synapseProtocol;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const SPN_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("SPN_ROLE"));
  const SLASHER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));

  const ETH_CHAIN_ID  = 1n;
  const SOL_CHAIN_ID  = 2n;
  const QUERY_FEE     = ethers.parseEther("0.001");
  const MIN_STAKE     = ethers.parseEther("100000");

  beforeEach(async function () {
    [admin, treasury, team, partners, ecosystem, alice, bob, charlie] = await ethers.getSigners();

    const SyncToken = await ethers.getContractFactory("SyncToken");
    syncToken = await SyncToken.deploy(
      admin.address, treasury.address, team.address, partners.address, ecosystem.address
    );

    const StateProofStore = await ethers.getContractFactory("StateProofStore");
    stateProofStore = await StateProofStore.deploy(admin.address, ethers.ZeroAddress);

    const CoCValidator = await ethers.getContractFactory("CoCValidator");
    cocValidator = await CoCValidator.deploy(admin.address, await syncToken.getAddress());

    const SynapseProtocol = await ethers.getContractFactory("SynapseProtocol");
    synapseProtocol = await SynapseProtocol.deploy(
      admin.address, await stateProofStore.getAddress(), QUERY_FEE
    );

    await syncToken.connect(admin).grantRole(MINTER_ROLE, await cocValidator.getAddress());
    await syncToken.connect(admin).grantRole(BURNER_ROLE, await synapseProtocol.getAddress());
    await cocValidator.connect(admin).grantRole(SLASHER_ROLE, admin.address);

    await stateProofStore.connect(admin).registerChain(
      ETH_CHAIN_ID, "Ethereum", 0, 12000, 120, alice.address
    );
  });

  describe("SyncToken", function () {
    it("should mint initial allocations correctly", async function () {
      const initialLiquidity = ethers.parseEther("50000000");
      const communityTreasury = ethers.parseEther("100000000");
      expect(await syncToken.balanceOf(admin.address)).to.equal(initialLiquidity);
      expect(await syncToken.balanceOf(treasury.address)).to.equal(communityTreasury);
    });

    it("should have correct total supply after deployment", async function () {
      const expected = ethers.parseEther("650000000");
      expect(await syncToken.totalSupply()).to.equal(expected);
    });

    it("should prevent non-minters from minting", async function () {
      await expect(
        syncToken.connect(bob).mintValidatorRewards(bob.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("should pause and unpause transfers", async function () {
      await syncToken.connect(admin).pause();
      await expect(
        syncToken.connect(admin).transfer(bob.address, 100n)
      ).to.be.reverted;

      await syncToken.connect(admin).unpause();
      await syncToken.connect(admin).transfer(bob.address, 100n);
      expect(await syncToken.balanceOf(bob.address)).to.equal(100n);
    });

    it("should perform protocol burns correctly", async function () {
      const amount = ethers.parseEther("1000");
      await syncToken.connect(admin).transfer(alice.address, amount);
      await syncToken.connect(admin).grantRole(BURNER_ROLE, admin.address);
      await syncToken.connect(alice).approve(admin.address, amount);

      const reason = ethers.keccak256(ethers.toUtf8Bytes("DEV_REGISTRATION"));
      await syncToken.connect(admin).protocolBurn(alice.address, amount, reason);

      expect(await syncToken.balanceOf(alice.address)).to.equal(0n);
      expect(await syncToken.totalBurned()).to.equal(amount);
    });

    it("should reject zero-address in constructor", async function () {
      const SyncToken = await ethers.getContractFactory("SyncToken");
      await expect(
        SyncToken.deploy(ethers.ZeroAddress, treasury.address, team.address, partners.address, ecosystem.address)
      ).to.be.revertedWithCustomError(syncToken, "ZeroAddress");
    });
  });

  describe("StateProofStore", function () {
    const fakeProof = ethers.randomBytes(256);
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("ethereum-state-root-1"));

    it("should register a chain and assign SPN role", async function () {
      const chain = await stateProofStore.chains(ETH_CHAIN_ID);
      expect(chain.active).to.be.true;
      expect(chain.name).to.equal("Ethereum");
      expect(await stateProofStore.hasRole(SPN_ROLE, alice.address)).to.be.true;
    });

    it("should reject duplicate chain registration", async function () {
      await expect(
        stateProofStore.connect(admin).registerChain(ETH_CHAIN_ID, "Ethereum2", 0, 12000, 120, bob.address)
      ).to.be.revertedWithCustomError(stateProofStore, "ChainAlreadyRegistered");
    });

    it("should allow SPN to publish a proof", async function () {
      await expect(
        stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, stateRoot, fakeProof)
      ).to.emit(stateProofStore, "ProofPublished");
      expect(await stateProofStore.proofCount(ETH_CHAIN_ID)).to.equal(1n);
    });

    it("should reject proof from non-SPN", async function () {
      await expect(
        stateProofStore.connect(bob).publishProof(ETH_CHAIN_ID, 100n, stateRoot, fakeProof)
      ).to.be.reverted;
    });

    it("should reject non-advancing block height", async function () {
      await stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, stateRoot, fakeProof);
      const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state-root-2"));
      await expect(
        stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 50n, stateRoot2, fakeProof)
      ).to.be.revertedWithCustomError(stateProofStore, "ProofDoesNotAdvance");
    });

    it("should reject empty state root", async function () {
      await expect(
        stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, ethers.ZeroHash, fakeProof)
      ).to.be.revertedWithCustomError(stateProofStore, "EmptyStateRoot");
    });

    it("should reject proof too small", async function () {
      const tinyProof = ethers.randomBytes(10);
      await expect(
        stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, stateRoot, tinyProof)
      ).to.be.revertedWithCustomError(stateProofStore, "ProofTooSmall");
    });

    it("should track proof freshness", async function () {
      await stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, stateRoot, fakeProof);
      expect(await stateProofStore.isProofFresh(ETH_CHAIN_ID)).to.be.true;

      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine", []);

      expect(await stateProofStore.isProofFresh(ETH_CHAIN_ID)).to.be.false;
    });
  });

  describe("CoCValidator", function () {
    beforeEach(async function () {
      await syncToken.connect(admin).transfer(alice.address, MIN_STAKE * 2n);
      await syncToken.connect(alice).approve(await cocValidator.getAddress(), MIN_STAKE * 2n);
    });

    it("should allow joining with sufficient stake", async function () {
      await expect(
        cocValidator.connect(alice).joinValidatorSet(MIN_STAKE)
      ).to.emit(cocValidator, "ValidatorJoined").withArgs(alice.address, MIN_STAKE);

      const v = await cocValidator.getValidatorInfo(alice.address);
      expect(v.stake).to.equal(MIN_STAKE);
    });

    it("should reject stake below minimum", async function () {
      const tooLow = ethers.parseEther("1000");
      await expect(
        cocValidator.connect(alice).joinValidatorSet(tooLow)
      ).to.be.revertedWithCustomError(cocValidator, "StakeBelowMinimum");
    });

    it("should handle unbonding and exit flow", async function () {
      await cocValidator.connect(alice).joinValidatorSet(MIN_STAKE);
      await cocValidator.connect(alice).startUnbonding();

      await expect(
        cocValidator.connect(alice).completeExit()
      ).to.be.revertedWithCustomError(cocValidator, "UnbondingNotElapsed");

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await syncToken.balanceOf(alice.address);
      await cocValidator.connect(alice).completeExit();
      const balAfter = await syncToken.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(MIN_STAKE);
    });

    it("should slash validators correctly", async function () {
      await cocValidator.connect(alice).joinValidatorSet(MIN_STAKE);
      await cocValidator.connect(admin).slashValidator(alice.address, 1, ETH_CHAIN_ID);

      const v = await cocValidator.getValidatorInfo(alice.address);
      const expected = MIN_STAKE - (MIN_STAKE * 1000n / 10000n);
      expect(v.stake).to.equal(expected);
    });

    it("should fully slash for fabrication", async function () {
      await cocValidator.connect(alice).joinValidatorSet(MIN_STAKE);
      await cocValidator.connect(admin).slashValidator(alice.address, 0, ETH_CHAIN_ID);

      const v = await cocValidator.getValidatorInfo(alice.address);
      expect(v.stake).to.equal(0n);
    });
  });

  describe("SynapseProtocol", function () {
    const fakeProof = ethers.randomBytes(256);
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("eth-state-root"));

    beforeEach(async function () {
      await stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 100n, stateRoot, fakeProof);
    });

    it("should execute a single query with correct fee", async function () {
      const query = {
        targetChainId: ETH_CHAIN_ID, queryType: 0, targetAddress: bob.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 120,
      };
      await expect(
        synapseProtocol.connect(bob).queryState(query, { value: QUERY_FEE })
      ).to.emit(synapseProtocol, "QueryExecuted");
      expect(await synapseProtocol.totalQueries()).to.equal(1n);
    });

    it("should reject query with insufficient fee", async function () {
      const query = {
        targetChainId: ETH_CHAIN_ID, queryType: 0, targetAddress: bob.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 120,
      };
      await expect(
        synapseProtocol.connect(bob).queryState(query, { value: 0n })
      ).to.be.revertedWithCustomError(synapseProtocol, "InsufficientFee");
    });

    it("should reject query for stale proof", async function () {
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine", []);

      const query = {
        targetChainId: ETH_CHAIN_ID, queryType: 0, targetAddress: bob.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 30,
      };
      await expect(
        synapseProtocol.connect(bob).queryState(query, { value: QUERY_FEE })
      ).to.be.revertedWithCustomError(synapseProtocol, "ProofTooStale");
    });

    it("should allow fee withdrawal by operator", async function () {
      const query = {
        targetChainId: ETH_CHAIN_ID, queryType: 0, targetAddress: bob.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 120,
      };
      await synapseProtocol.connect(bob).queryState(query, { value: QUERY_FEE });

      const treasuryBal = await ethers.provider.getBalance(treasury.address);
      await synapseProtocol.connect(admin).withdrawFees(treasury.address);
      const treasuryBalAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryBalAfter - treasuryBal).to.equal(QUERY_FEE);
    });
  });

  describe("Integration — Full Protocol Flow", function () {
    it("should complete an end-to-end cross-chain query lifecycle", async function () {
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("eth-block-12345"));
      const proof = ethers.randomBytes(256);
      await stateProofStore.connect(alice).publishProof(ETH_CHAIN_ID, 12345n, stateRoot, proof);

      expect(await stateProofStore.isProofFresh(ETH_CHAIN_ID)).to.be.true;

      const query = {
        targetChainId: ETH_CHAIN_ID, queryType: 0, targetAddress: charlie.address,
        storageSlot: ethers.ZeroHash, maxStalenessSeconds: 120,
      };
      await synapseProtocol.connect(charlie).queryState(query, { value: QUERY_FEE });

      expect(await synapseProtocol.totalQueries()).to.equal(1n);
      expect(await synapseProtocol.feeAccumulator()).to.equal(QUERY_FEE);
    });
  });
});
