/**
 * On-chain verification utilities for ProofPort SDK
 */

import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
import { DEFAULT_VERIFIERS, RPC_ENDPOINTS } from './constants';

/**
 * Get verifier contract instance
 */
export function getVerifierContract(
  circuit: CircuitType,
  providerOrSigner: ethers.providers.Provider | ethers.Signer,
  customVerifier?: VerifierContract
): ethers.Contract {
  const verifier = customVerifier || DEFAULT_VERIFIERS[circuit];

  return new ethers.Contract(
    verifier.address,
    verifier.abi,
    providerOrSigner
  );
}

/**
 * Get default provider for a chain
 */
export function getDefaultProvider(chainId: number): ethers.providers.JsonRpcProvider {
  const rpcUrl = RPC_ENDPOINTS[chainId];
  if (!rpcUrl) {
    throw new Error(`No RPC endpoint configured for chain ${chainId}`);
  }
  return new ethers.providers.JsonRpcProvider(rpcUrl);
}

/**
 * Verify proof on-chain
 */
export async function verifyProofOnChain(
  circuit: CircuitType,
  parsedProof: ParsedProof,
  providerOrSigner?: ethers.providers.Provider | ethers.Signer,
  customVerifier?: VerifierContract
): Promise<{ valid: boolean; error?: string }> {
  try {
    const verifier = customVerifier || DEFAULT_VERIFIERS[circuit];
    const provider = providerOrSigner || getDefaultProvider(verifier.chainId);
    const contract = getVerifierContract(circuit, provider, customVerifier);

    // Convert public inputs to bytes32 array
    const publicInputsBytes32 = parsedProof.publicInputsHex.map((input) => {
      // Ensure proper padding to 32 bytes
      const hex = input.startsWith('0x') ? input : `0x${input}`;
      return ethers.utils.hexZeroPad(hex, 32);
    });

    // Call verify function
    const isValid = await contract.verify(
      parsedProof.proofHex,
      publicInputsBytes32
    );

    return { valid: isValid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

/**
 * Parse proof response into format suitable for on-chain verification
 */
export function parseProofForOnChain(
  proof: string,
  publicInputs: string[],
  numPublicInputs: number
): ParsedProof {
  // Ensure proof has 0x prefix
  const proofHex = proof.startsWith('0x') ? proof : `0x${proof}`;

  // Ensure all public inputs have 0x prefix and are properly padded
  const publicInputsHex = publicInputs.map((input) => {
    const hex = input.startsWith('0x') ? input : `0x${input}`;
    // Pad to 32 bytes if needed
    if (hex.length < 66) { // 0x + 64 hex chars = 32 bytes
      return ethers.utils.hexZeroPad(hex, 32);
    }
    return hex;
  });

  return {
    proofHex,
    publicInputsHex,
    numPublicInputs,
  };
}

/**
 * Get verifier contract address for a circuit
 */
export function getVerifierAddress(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): string {
  return customVerifier?.address || DEFAULT_VERIFIERS[circuit].address;
}

/**
 * Get chain ID for a circuit's default verifier
 */
export function getVerifierChainId(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): number {
  return customVerifier?.chainId || DEFAULT_VERIFIERS[circuit].chainId;
}
