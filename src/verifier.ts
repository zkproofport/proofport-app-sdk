/**
 * On-chain verification utilities for ProofPort SDK
 */

import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
import { VERIFIER_ABI, RPC_ENDPOINTS } from './constants';

/**
 * Resolve verifier from SDK config or proof response.
 * SDK config (customVerifier) takes priority over response-provided verifier.
 */
function resolveVerifier(
  customVerifier?: VerifierContract,
  responseVerifier?: { verifierAddress?: string; chainId?: number }
): VerifierContract | null {
  if (customVerifier) return customVerifier;
  if (responseVerifier?.verifierAddress) {
    return {
      address: responseVerifier.verifierAddress,
      chainId: responseVerifier.chainId ?? 0,
      abi: VERIFIER_ABI,
    };
  }
  return null;
}

/**
 * Get verifier contract instance
 */
export function getVerifierContract(
  providerOrSigner: ethers.providers.Provider | ethers.Signer,
  verifier: VerifierContract
): ethers.Contract {
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
  customVerifier?: VerifierContract,
  responseVerifier?: { verifierAddress?: string; chainId?: number }
): Promise<{ valid: boolean; error?: string }> {
  const verifier = resolveVerifier(customVerifier, responseVerifier);
  if (!verifier) {
    return {
      valid: false,
      error: 'No verifier address provided. Configure via SDK or ensure proof response includes verifierAddress.',
    };
  }

  const provider = providerOrSigner || (verifier.chainId > 0 ? getDefaultProvider(verifier.chainId) : null);
  if (!provider) {
    return {
      valid: false,
      error: 'No provider available. Provide a provider or ensure chainId is set for RPC lookup.',
    };
  }

  const contract = getVerifierContract(provider, verifier);

  try {
    const isValid = await contract.verify(
      parsedProof.proofHex,
      parsedProof.publicInputsHex
    );

    return { valid: isValid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

/**
 * Ensure a hex string has the 0x prefix
 */
function ensureHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/**
 * Parse proof response into format suitable for on-chain verification.
 * Public inputs are zero-padded to 32 bytes (bytes32).
 */
export function parseProofForOnChain(
  proof: string,
  publicInputs: string[],
  numPublicInputs: number
): ParsedProof {
  const proofHex = ensureHexPrefix(proof);

  const publicInputsHex = publicInputs.map((input) => {
    return ethers.utils.hexZeroPad(ensureHexPrefix(input), 32);
  });

  return {
    proofHex,
    publicInputsHex,
    numPublicInputs,
  };
}

/**
 * Require a verifier or throw with a helpful message
 */
function requireVerifier(circuit: CircuitType, verifier?: VerifierContract): VerifierContract {
  if (!verifier) {
    throw new Error(`No verifier configured for circuit '${circuit}'. Configure via SDK verifiers option.`);
  }
  return verifier;
}

/**
 * Get verifier contract address for a circuit
 */
export function getVerifierAddress(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): string {
  return requireVerifier(circuit, customVerifier).address;
}

/**
 * Get chain ID for a circuit's verifier
 */
export function getVerifierChainId(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): number {
  return requireVerifier(circuit, customVerifier).chainId;
}
