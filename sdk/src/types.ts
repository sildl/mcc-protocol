// ═══════════════════════════════════════════════════
//  Query Types
// ═══════════════════════════════════════════════════

export enum QueryType {
  BALANCE = 0,
  STORAGE = 1,
  UTXO = 2,
  NFT_OWNERSHIP = 3,
  CONTRACT_STATE = 4,
}

export interface SynapseQuery {
  targetChainId: bigint;
  queryType: QueryType;
  targetAddress: string;
  storageSlot?: string;
  maxStalenessSeconds?: number;
}

export interface SynapseResult {
  chainId: bigint;
  blockHeight: bigint;
  timestamp: number;
  stateRoot: string;
  value: string;
  verified: boolean;
}

// ═══════════════════════════════════════════════════
//  Chain Info
// ═══════════════════════════════════════════════════

export enum ChainModel {
  ACCOUNT_BASED = 0,
  UTXO_BASED = 1,
}

export interface ChainInfo {
  chainId: bigint;
  name: string;
  model: ChainModel;
  avgBlockTimeMs: number;
  maxStalenessSeconds: number;
  spn: string;
  active: boolean;
}

// ═══════════════════════════════════════════════════
//  State Proofs
// ═══════════════════════════════════════════════════

export interface StateProof {
  chainId: bigint;
  blockHeight: bigint;
  timestamp: number;
  sequenceNumber: bigint;
  publisher: string;
  stateRoot: string;
  zkProof: string;
}

// ═══════════════════════════════════════════════════
//  Validators
// ═══════════════════════════════════════════════════

export enum ValidatorStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  UNBONDING = 2,
  SLASHED = 3,
}

export interface ValidatorInfo {
  stake: bigint;
  rewardsEarned: bigint;
  chainsSynced: number;
  proofsVerified: number;
  joinedAt: number;
  unbondingStarted: number;
  status: ValidatorStatus;
}

// ═══════════════════════════════════════════════════
//  Token Info
// ═══════════════════════════════════════════════════

export interface TokenStats {
  totalSupply: bigint;
  totalBurned: bigint;
  validatorRewardsEmitted: bigint;
  currentEmissionRate: bigint;
  effectiveMaxSupply: bigint;
  remainingValidatorRewards: bigint;
  isNetDeflationary: boolean;
}

// ═══════════════════════════════════════════════════
//  Network Config
// ═══════════════════════════════════════════════════

export interface MCCAddresses {
  syncToken: string;
  stateProofStore: string;
  cocValidator: string;
  synapseProtocol: string;
}

export const SEPOLIA_ADDRESSES: MCCAddresses = {
  syncToken: "0x0000000000000000000000000000000000000000",
  stateProofStore: "0x0000000000000000000000000000000000000000",
  cocValidator: "0x0000000000000000000000000000000000000000",
  synapseProtocol: "0x0000000000000000000000000000000000000000",
};

// Chain ID constants used by MCC (not Ethereum chain IDs)
export const MCC_CHAINS = {
  ETHEREUM: 1n,
  SOLANA: 2n,
  BITCOIN: 3n,
  POLYGON: 137n,
} as const;
