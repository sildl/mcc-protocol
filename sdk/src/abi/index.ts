export const SYNAPSE_ABI = [
  "function queryState(tuple(uint64 targetChainId, uint8 queryType, address targetAddress, bytes32 storageSlot, uint32 maxStalenessSeconds) query) payable returns (tuple(uint64 chainId, uint64 blockHeight, uint48 timestamp, bytes32 stateRoot, bytes value, bool verified))",
  "function queryStateMulti(tuple(uint64 targetChainId, uint8 queryType, address targetAddress, bytes32 storageSlot, uint32 maxStalenessSeconds)[] queries) payable returns (tuple(uint64 chainId, uint64 blockHeight, uint48 timestamp, bytes32 stateRoot, bytes value, bool verified)[])",
  "function isChainAvailable(uint64 chainId) view returns (bool)",
  "function getProofAge(uint64 chainId) view returns (uint256)",
  "function queryFee() view returns (uint256)",
  "function totalQueries() view returns (uint256)",
  "function chainQueryCount(uint64 chainId) view returns (uint256)",
  "event QueryExecuted(address indexed caller, uint64 indexed targetChainId, uint8 queryType, uint64 blockHeight, uint256 fee)",
  "event MultiQueryExecuted(address indexed caller, uint256 chainCount, uint256 totalFee)",
] as const;

export const STATE_PROOF_STORE_ABI = [
  "function getLatestProof(uint64 chainId) view returns (tuple(uint64 chainId, uint64 blockHeight, uint48 timestamp, uint64 sequenceNumber, address publisher, bytes32 stateRoot, bytes zkProof))",
  "function getProofBySequence(uint64 chainId, uint64 seq) view returns (tuple(uint64 chainId, uint64 blockHeight, uint48 timestamp, uint64 sequenceNumber, address publisher, bytes32 stateRoot, bytes zkProof))",
  "function getProofAge(uint64 chainId) view returns (uint256)",
  "function isProofFresh(uint64 chainId) view returns (bool)",
  "function getStateRoot(uint64 chainId) view returns (bytes32)",
  "function getAllChainIds() view returns (uint64[])",
  "function chainCount() view returns (uint256)",
  "function chains(uint64) view returns (uint64 chainId, string name, uint8 model, uint32 avgBlockTimeMs, uint32 maxStalenessSeconds, address spn, bool active)",
  "event ProofPublished(uint64 indexed chainId, uint64 blockHeight, bytes32 stateRoot, uint64 sequenceNumber, address indexed publisher)",
] as const;

export const COC_VALIDATOR_ABI = [
  "function getValidatorInfo(address) view returns (tuple(uint256 stake, uint256 rewardsEarned, uint64 chainsSynced, uint64 proofsVerified, uint48 joinedAt, uint48 unbondingStarted, uint8 status))",
  "function getValidatorCount() view returns (uint256)",
  "function getActiveValidatorCount() view returns (uint256)",
  "function validatorSet(uint256) view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function slashedFundsTotal() view returns (uint256)",
  "event ValidatorJoined(address indexed validator, uint256 stake)",
  "event ValidatorSlashed(address indexed validator, uint8 reason, uint256 amount)",
  "event EpochAdvanced(uint256 indexed epoch, uint256 totalRewards)",
] as const;

export const SYNC_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function totalBurned() view returns (uint256)",
  "function validatorRewardsEmitted() view returns (uint256)",
  "function currentEmissionRate() view returns (uint256)",
  "function effectiveMaxSupply() view returns (uint256)",
  "function remainingValidatorRewards() view returns (uint256)",
  "function isNetDeflationary() view returns (bool)",
] as const;
