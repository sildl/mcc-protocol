import { ethers } from "ethers";
import {
  SYNAPSE_ABI,
  STATE_PROOF_STORE_ABI,
  COC_VALIDATOR_ABI,
  SYNC_TOKEN_ABI,
} from "./abi/index.js";
import type {
  MCCAddresses,
  SynapseQuery,
  SynapseResult,
  StateProof,
  ChainInfo,
  ValidatorInfo,
  TokenStats,
} from "./types.js";
import { QueryType } from "./types.js";

/**
 * MCCClient — Main entry point for the MCC SDK
 *
 * @example
 * ```ts
 * import { MCCClient, QueryType } from "@mcc-protocol/sdk";
 * import { ethers } from "ethers";
 *
 * const provider = new ethers.JsonRpcProvider("https://...");
 * const client = new MCCClient(provider, {
 *   syncToken: "0x...",
 *   stateProofStore: "0x...",
 *   cocValidator: "0x...",
 *   synapseProtocol: "0x...",
 * });
 *
 * // Check if Solana state is available
 * const available = await client.isChainAvailable(2n);
 *
 * // Query a balance on Solana from Ethereum
 * const result = await client.queryBalance(2n, "0xUserAddress");
 * console.log("Block height:", result.blockHeight);
 * console.log("State root:", result.stateRoot);
 * ```
 */
export class MCCClient {
  readonly provider: ethers.Provider;
  readonly addresses: MCCAddresses;

  private synapse: ethers.Contract;
  private proofStore: ethers.Contract;
  private validator: ethers.Contract;
  private token: ethers.Contract;

  constructor(
    providerOrSigner: ethers.Provider | ethers.Signer,
    addresses: MCCAddresses
  ) {
    this.addresses = addresses;

    if ("provider" in providerOrSigner && providerOrSigner.provider) {
      this.provider = providerOrSigner.provider;
    } else {
      this.provider = providerOrSigner as ethers.Provider;
    }

    this.synapse = new ethers.Contract(
      addresses.synapseProtocol,
      SYNAPSE_ABI,
      providerOrSigner
    );
    this.proofStore = new ethers.Contract(
      addresses.stateProofStore,
      STATE_PROOF_STORE_ABI,
      providerOrSigner
    );
    this.validator = new ethers.Contract(
      addresses.cocValidator,
      COC_VALIDATOR_ABI,
      providerOrSigner
    );
    this.token = new ethers.Contract(
      addresses.syncToken,
      SYNC_TOKEN_ABI,
      providerOrSigner
    );
  }

  // ═══════════════════════════════════════════════════
  //  CROSS-CHAIN QUERIES
  // ═══════════════════════════════════════════════════

  /**
   * Query an account balance on another chain
   * @param chainId   MCC chain ID (e.g., 2n for Solana)
   * @param address   Address to query on the target chain
   * @param options   Optional: maxStaleness in seconds (default 120)
   * @returns         Verified query result with proof metadata
   */
  async queryBalance(
    chainId: bigint,
    address: string,
    options?: { maxStaleness?: number }
  ): Promise<SynapseResult> {
    return this.query({
      targetChainId: chainId,
      queryType: QueryType.BALANCE,
      targetAddress: address,
      maxStalenessSeconds: options?.maxStaleness ?? 120,
    });
  }

  /**
   * Query a specific storage slot on another chain
   * @param chainId   MCC chain ID
   * @param contract  Contract address on the target chain
   * @param slot      Storage slot (bytes32)
   * @returns         Verified query result
   */
  async queryStorage(
    chainId: bigint,
    contract: string,
    slot: string
  ): Promise<SynapseResult> {
    return this.query({
      targetChainId: chainId,
      queryType: QueryType.STORAGE,
      targetAddress: contract,
      storageSlot: slot,
    });
  }

  /**
   * Query NFT ownership on another chain
   */
  async queryNFTOwnership(
    chainId: bigint,
    nftContract: string
  ): Promise<SynapseResult> {
    return this.query({
      targetChainId: chainId,
      queryType: QueryType.NFT_OWNERSHIP,
      targetAddress: nftContract,
    });
  }

  /**
   * Execute a raw Synapse query
   */
  async query(params: SynapseQuery): Promise<SynapseResult> {
    const fee = await this.getQueryFee();
    const queryStruct = this._buildQuery(params);
    const result = await this.synapse.queryState(queryStruct, { value: fee });
    return this._parseResult(result);
  }

  /**
   * Execute atomic multi-chain queries
   * @param queries Array of queries across different chains
   * @returns       Array of results (same order as queries)
   */
  async queryMulti(queries: SynapseQuery[]): Promise<SynapseResult[]> {
    const fee = await this.getQueryFee();
    const totalFee = fee * BigInt(queries.length);
    const structs = queries.map((q) => this._buildQuery(q));
    const results = await this.synapse.queryStateMulti(structs, {
      value: totalFee,
    });
    return results.map((r: any) => this._parseResult(r));
  }

  // ═══════════════════════════════════════════════════
  //  CHAIN INFO
  // ═══════════════════════════════════════════════════

  /** Check if a chain has a fresh proof available */
  async isChainAvailable(chainId: bigint): Promise<boolean> {
    return this.synapse.isChainAvailable(chainId);
  }

  /** Get the age (in seconds) of the latest proof for a chain */
  async getProofAge(chainId: bigint): Promise<number> {
    const age = await this.proofStore.getProofAge(chainId);
    return Number(age);
  }

  /** Get the latest state proof for a chain */
  async getLatestProof(chainId: bigint): Promise<StateProof> {
    const p = await this.proofStore.getLatestProof(chainId);
    return {
      chainId: p.chainId,
      blockHeight: p.blockHeight,
      timestamp: Number(p.timestamp),
      sequenceNumber: p.sequenceNumber,
      publisher: p.publisher,
      stateRoot: p.stateRoot,
      zkProof: p.zkProof,
    };
  }

  /** Get info about a registered chain */
  async getChainInfo(chainId: bigint): Promise<ChainInfo> {
    const c = await this.proofStore.chains(chainId);
    return {
      chainId: c.chainId,
      name: c.name,
      model: Number(c.model),
      avgBlockTimeMs: Number(c.avgBlockTimeMs),
      maxStalenessSeconds: Number(c.maxStalenessSeconds),
      spn: c.spn,
      active: c.active,
    };
  }

  /** Get all registered chain IDs */
  async getAllChainIds(): Promise<bigint[]> {
    return this.proofStore.getAllChainIds();
  }

  /** Get total number of connected chains */
  async getChainCount(): Promise<number> {
    return Number(await this.proofStore.chainCount());
  }

  // ═══════════════════════════════════════════════════
  //  VALIDATOR INFO
  // ═══════════════════════════════════════════════════

  /** Get info about a specific validator */
  async getValidator(address: string): Promise<ValidatorInfo> {
    const v = await this.validator.getValidatorInfo(address);
    return {
      stake: v.stake,
      rewardsEarned: v.rewardsEarned,
      chainsSynced: Number(v.chainsSynced),
      proofsVerified: Number(v.proofsVerified),
      joinedAt: Number(v.joinedAt),
      unbondingStarted: Number(v.unbondingStarted),
      status: Number(v.status),
    };
  }

  /** Get the total number of validators (including inactive) */
  async getValidatorCount(): Promise<number> {
    return Number(await this.validator.getValidatorCount());
  }

  /** Get the number of active validators */
  async getActiveValidatorCount(): Promise<number> {
    return Number(await this.validator.getActiveValidatorCount());
  }

  /** Get the current epoch number */
  async getCurrentEpoch(): Promise<number> {
    return Number(await this.validator.currentEpoch());
  }

  // ═══════════════════════════════════════════════════
  //  TOKEN INFO
  // ═══════════════════════════════════════════════════

  /** Get comprehensive SYNC token statistics */
  async getTokenStats(): Promise<TokenStats> {
    const [
      totalSupply,
      totalBurned,
      emitted,
      emissionRate,
      effectiveMax,
      remaining,
      isDefl,
    ] = await Promise.all([
      this.token.totalSupply(),
      this.token.totalBurned(),
      this.token.validatorRewardsEmitted(),
      this.token.currentEmissionRate(),
      this.token.effectiveMaxSupply(),
      this.token.remainingValidatorRewards(),
      this.token.isNetDeflationary(),
    ]);

    return {
      totalSupply,
      totalBurned,
      validatorRewardsEmitted: emitted,
      currentEmissionRate: emissionRate,
      effectiveMaxSupply: effectiveMax,
      remainingValidatorRewards: remaining,
      isNetDeflationary: isDefl,
    };
  }

  /** Get SYNC balance for an address */
  async getSyncBalance(address: string): Promise<bigint> {
    return this.token.balanceOf(address);
  }

  // ═══════════════════════════════════════════════════
  //  PROTOCOL STATS
  // ═══════════════════════════════════════════════════

  /** Get the current query fee in wei */
  async getQueryFee(): Promise<bigint> {
    return this.synapse.queryFee();
  }

  /** Get total queries executed across all chains */
  async getTotalQueries(): Promise<number> {
    return Number(await this.synapse.totalQueries());
  }

  /** Get query count for a specific chain */
  async getChainQueryCount(chainId: bigint): Promise<number> {
    return Number(await this.synapse.chainQueryCount(chainId));
  }

  // ═══════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ═══════════════════════════════════════════════════

  /** Listen for new state proofs */
  onProofPublished(
    callback: (chainId: bigint, blockHeight: bigint, stateRoot: string) => void
  ): void {
    this.proofStore.on("ProofPublished", (chainId, blockHeight, stateRoot) => {
      callback(chainId, blockHeight, stateRoot);
    });
  }

  /** Listen for cross-chain queries */
  onQueryExecuted(
    callback: (caller: string, chainId: bigint, queryType: number) => void
  ): void {
    this.synapse.on("QueryExecuted", (caller, chainId, queryType) => {
      callback(caller, chainId, Number(queryType));
    });
  }

  /** Stop all event listeners */
  removeAllListeners(): void {
    this.proofStore.removeAllListeners();
    this.synapse.removeAllListeners();
    this.validator.removeAllListeners();
  }

  // ═══════════════════════════════════════════════════
  //  INTERNAL
  // ═══════════════════════════════════════════════════

  private _buildQuery(params: SynapseQuery) {
    return {
      targetChainId: params.targetChainId,
      queryType: params.queryType,
      targetAddress: params.targetAddress,
      storageSlot: params.storageSlot ?? ethers.ZeroHash,
      maxStalenessSeconds: params.maxStaleness ?? 120,
    };
  }

  private _parseResult(raw: any): SynapseResult {
    return {
      chainId: raw.chainId,
      blockHeight: raw.blockHeight,
      timestamp: Number(raw.timestamp),
      stateRoot: raw.stateRoot,
      value: raw.value,
      verified: raw.verified,
    };
  }
}
