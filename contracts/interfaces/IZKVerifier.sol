// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZKVerifier — Interface for ZK state proof verification
/// @notice Any verifier plugged into StateProofStore must implement this.
///         The verifier confirms that the prover knows a witness (chain state)
///         that hashes to the claimed stateRoot at the claimed blockHeight.

interface IZKVerifier {

    /// @notice Verify a ZK-SNARK state proof
    /// @param chainId     MCC chain identifier
    /// @param blockHeight Block height the proof covers
    /// @param stateRoot   Claimed Merkle root of the chain's state
    /// @param proof       Raw proof bytes (Groth16 format: 256 bytes)
    /// @return valid      True if the proof is cryptographically valid
    function verifyProof(
        uint64  chainId,
        uint64  blockHeight,
        bytes32 stateRoot,
        bytes   calldata proof
    ) external view returns (bool valid);

    /// @notice Check if a verification key is registered for a chain
    /// @param chainId The chain to check
    /// @return True if a VK exists
    function hasVerificationKey(uint64 chainId) external view returns (bool);
}
