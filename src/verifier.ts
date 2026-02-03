/**
 * On-chain verification utilities for ZKProofPort SDK
 *
 * Compatible with both ethers v5 and v6.
 */

import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
import { VERIFIER_ABI, RPC_ENDPOINTS } from './constants';

// ethers v5/v6 compatibility shims
const _ethers = ethers as any;

function hexZeroPad(value: string, length: number): string {
  // v6: ethers.zeroPadValue, v5: ethers.utils.hexZeroPad
  if (typeof _ethers.zeroPadValue === 'function') return _ethers.zeroPadValue(value, length);
  if (_ethers.utils?.hexZeroPad) return _ethers.utils.hexZeroPad(value, length);
  // manual fallback
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return '0x' + hex.padStart(length * 2, '0');
}

function createJsonRpcProvider(url: string) {
  // v6: ethers.JsonRpcProvider, v5: ethers.providers.JsonRpcProvider
  if (typeof _ethers.JsonRpcProvider === 'function') return new _ethers.JsonRpcProvider(url);
  if (_ethers.providers?.JsonRpcProvider) return new _ethers.providers.JsonRpcProvider(url);
  throw new Error('No JsonRpcProvider found in ethers');
}

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
  providerOrSigner: any,
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
export function getDefaultProvider(chainId: number) {
  const rpcUrl = RPC_ENDPOINTS[chainId];
  if (!rpcUrl) {
    throw new Error(`No RPC endpoint configured for chain ${chainId}`);
  }
  return createJsonRpcProvider(rpcUrl);
}

/**
 * Verify proof on-chain
 */
export async function verifyProofOnChain(
  circuit: CircuitType,
  parsedProof: ParsedProof,
  providerOrSigner?: any,
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
    return hexZeroPad(ensureHexPrefix(input), 32);
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

export function extractScopeFromPublicInputs(
  publicInputsHex: string[],
  circuit?: string,
): string | null {
  let start: number, end: number;
  if (circuit === 'coinbase_country_attestation') {
    start = 86; end = 117;
  } else {
    start = 64; end = 95;
  }
  if (publicInputsHex.length <= end) return null;
  const scopeFields = publicInputsHex.slice(start, end + 1);
  return reconstructBytes32FromFields(scopeFields);
}

export function extractNullifierFromPublicInputs(
  publicInputsHex: string[],
  circuit?: string,
): string | null {
  let start: number, end: number;
  if (circuit === 'coinbase_country_attestation') {
    start = 118; end = 149;
  } else {
    start = 96; end = 127;
  }
  if (publicInputsHex.length <= end) return null;
  const nullifierFields = publicInputsHex.slice(start, end + 1);
  return reconstructBytes32FromFields(nullifierFields);
}

function reconstructBytes32FromFields(fields: string[]): string {
  if (fields.length !== 32) {
    throw new Error(`Expected 32 fields, got ${fields.length}`);
  }
  const bytes = fields.map(f => {
    const byte = BigInt(f) & 0xFFn;
    return byte.toString(16).padStart(2, '0');
  }).join('');
  return '0x' + bytes;
}

/**
 * Check if a nullifier is registered on-chain (Plan 2)
 */
export async function isNullifierRegistered(
  nullifier: string,
  registryAddress: string,
  provider: any
): Promise<boolean> {
  const { ZKPROOFPORT_NULLIFIER_REGISTRY_ABI } = await import('./constants');
  const contract = new ethers.Contract(registryAddress, ZKPROOFPORT_NULLIFIER_REGISTRY_ABI, provider);
  try {
    return await contract.isNullifierRegistered(nullifier);
  } catch {
    return false;
  }
}

/**
 * Get nullifier info from on-chain registry (Plan 2)
 */
export async function getNullifierInfo(
  nullifier: string,
  registryAddress: string,
  provider: any
): Promise<{ registeredAt: number; scope: string; circuitId: string } | null> {
  const { ZKPROOFPORT_NULLIFIER_REGISTRY_ABI } = await import('./constants');
  const contract = new ethers.Contract(registryAddress, ZKPROOFPORT_NULLIFIER_REGISTRY_ABI, provider);
  try {
    const [registeredAt, scope, circuitId] = await contract.getNullifierInfo(nullifier);
    if (BigInt(registeredAt) === 0n) return null;
    return {
      registeredAt: Number(registeredAt),
      scope: scope as string,
      circuitId: circuitId as string,
    };
  } catch {
    return null;
  }
}
