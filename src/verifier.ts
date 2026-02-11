/**
 * On-chain verification utilities for ZKProofport SDK
 *
 * Compatible with both ethers v5 and v6.
 */

import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
import { VERIFIER_ABI, RPC_ENDPOINTS } from './constants';

// ethers v5/v6 compatibility shims
const _ethers = ethers as any;

/** @internal ethers v5/v6 compatibility shim */
function hexZeroPad(value: string, length: number): string {
  // v6: ethers.zeroPadValue, v5: ethers.utils.hexZeroPad
  if (typeof _ethers.zeroPadValue === 'function') return _ethers.zeroPadValue(value, length);
  if (_ethers.utils?.hexZeroPad) return _ethers.utils.hexZeroPad(value, length);
  // manual fallback
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return '0x' + hex.padStart(length * 2, '0');
}

/** @internal ethers v5/v6 compatibility shim */
function createJsonRpcProvider(url: string) {
  // v6: ethers.JsonRpcProvider, v5: ethers.providers.JsonRpcProvider
  if (typeof _ethers.JsonRpcProvider === 'function') return new _ethers.JsonRpcProvider(url);
  if (_ethers.providers?.JsonRpcProvider) return new _ethers.providers.JsonRpcProvider(url);
  throw new Error('No JsonRpcProvider found in ethers');
}

/**
 * @internal Resolve verifier from SDK config or proof response.
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
 * Get verifier contract instance for interacting with on-chain verifier contracts.
 *
 * @param providerOrSigner - ethers.js Provider or Signer instance (v5 or v6 compatible)
 * @param verifier - Verifier contract configuration containing address and ABI
 * @returns ethers.Contract instance connected to the verifier
 *
 * @example
 * ```typescript
 * const provider = new ethers.JsonRpcProvider(rpcUrl);
 * const contract = getVerifierContract(provider, {
 *   address: '0x...',
 *   chainId: 11155111,
 *   abi: VERIFIER_ABI
 * });
 * ```
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
 * Get default JSON-RPC provider for a chain using pre-configured RPC endpoints.
 *
 * @param chainId - The chain ID (e.g., 11155111 for Sepolia, 84532 for Base Sepolia)
 * @returns ethers.JsonRpcProvider instance for the specified chain
 * @throws Error if no RPC endpoint is configured for the chain
 *
 * @example
 * ```typescript
 * const provider = getDefaultProvider(11155111); // Sepolia
 * ```
 */
export function getDefaultProvider(chainId: number) {
  const rpcUrl = RPC_ENDPOINTS[chainId];
  if (!rpcUrl) {
    throw new Error(`No RPC endpoint configured for chain ${chainId}`);
  }
  return createJsonRpcProvider(rpcUrl);
}

/**
 * Verify a zero-knowledge proof on-chain by calling the verifier smart contract.
 *
 * This function resolves the verifier contract from SDK config or proof response,
 * connects to the blockchain, and calls the verify() method with the proof and public inputs.
 *
 * @param circuit - The canonical circuit identifier (e.g., "coinbase_attestation")
 * @param parsedProof - Parsed proof object containing proofHex and publicInputsHex
 * @param providerOrSigner - Optional ethers.js Provider or Signer instance. If not provided, uses default RPC for the chain
 * @param customVerifier - Optional custom verifier contract config (takes priority over responseVerifier)
 * @param responseVerifier - Optional verifier info from proof generation response
 * @returns Promise resolving to verification result with valid flag and optional error message
 *
 * @example
 * ```typescript
 * const parsed = parseProofForOnChain(proof, publicInputs, numPublicInputs);
 * const result = await verifyProofOnChain(
 *   'coinbase_attestation',
 *   parsed,
 *   provider,
 *   { address: '0x...', chainId: 11155111, abi: VERIFIER_ABI }
 * );
 *
 * if (result.valid) {
 *   console.log('Proof is valid!');
 * } else {
 *   console.error('Verification failed:', result.error);
 * }
 * ```
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

/** @internal Ensure a hex string has the 0x prefix */
function ensureHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/**
 * Parse proof response into format suitable for on-chain verification.
 *
 * Converts proof and public inputs from relay response format to the format
 * expected by Solidity verifier contracts. Public inputs are zero-padded to
 * 32 bytes (bytes32) to match Solidity's bytes32[] type.
 *
 * @param proof - Proof bytes as hex string (with or without 0x prefix)
 * @param publicInputs - Array of public input values as hex strings
 * @param numPublicInputs - Number of public inputs (for validation)
 * @returns Parsed proof object ready for on-chain verification
 *
 * @example
 * ```typescript
 * const parsed = parseProofForOnChain(
 *   '0x1a2b3c...',
 *   ['0x01', '0x02', '0x03'],
 *   3
 * );
 *
 * // parsed.proofHex: '0x1a2b3c...'
 * // parsed.publicInputsHex: ['0x0000...01', '0x0000...02', '0x0000...03']
 * ```
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

/** @internal Require a verifier or throw with a helpful message */
function requireVerifier(circuit: CircuitType, verifier?: VerifierContract): VerifierContract {
  if (!verifier) {
    throw new Error(`No verifier configured for circuit '${circuit}'. Configure via SDK verifiers option.`);
  }
  return verifier;
}

/**
 * Get verifier contract address for a circuit.
 *
 * @param circuit - The canonical circuit identifier (e.g., "coinbase_attestation")
 * @param customVerifier - Optional custom verifier contract config
 * @returns Verifier contract address as hex string
 * @throws Error if no verifier is configured for the circuit
 *
 * @example
 * ```typescript
 * const address = getVerifierAddress('coinbase_attestation', verifierConfig);
 * console.log(address); // '0x1234...'
 * ```
 */
export function getVerifierAddress(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): string {
  return requireVerifier(circuit, customVerifier).address;
}

/**
 * Get chain ID for a circuit's verifier contract.
 *
 * @param circuit - The canonical circuit identifier (e.g., "coinbase_attestation")
 * @param customVerifier - Optional custom verifier contract config
 * @returns Chain ID number (e.g., 11155111 for Sepolia, 84532 for Base Sepolia)
 * @throws Error if no verifier is configured for the circuit
 *
 * @example
 * ```typescript
 * const chainId = getVerifierChainId('coinbase_attestation', verifierConfig);
 * console.log(chainId); // 11155111
 * ```
 */
export function getVerifierChainId(
  circuit: CircuitType,
  customVerifier?: VerifierContract
): number {
  return requireVerifier(circuit, customVerifier).chainId;
}

/**
 * Extract scope value from public inputs array.
 *
 * The scope is a bytes32 value encoded across 32 consecutive field elements
 * in the public inputs. The exact position depends on the circuit type.
 *
 * @param publicInputsHex - Array of public input hex strings (zero-padded to 32 bytes)
 * @param circuit - Optional circuit identifier to determine field positions
 * @returns Reconstructed scope as hex string with 0x prefix, or null if inputs are insufficient
 *
 * @example
 * ```typescript
 * const scope = extractScopeFromPublicInputs(publicInputsHex, 'coinbase_attestation');
 * console.log(scope); // '0x7a6b70726f6f66706f72742e636f6d...'
 * ```
 */
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

/**
 * Extract nullifier value from public inputs array.
 *
 * The nullifier is a bytes32 value encoded across 32 consecutive field elements
 * in the public inputs. The exact position depends on the circuit type.
 * Nullifiers are used for duplicate proof detection and must be unique per user+scope.
 *
 * @param publicInputsHex - Array of public input hex strings (zero-padded to 32 bytes)
 * @param circuit - Optional circuit identifier to determine field positions
 * @returns Reconstructed nullifier as hex string with 0x prefix, or null if inputs are insufficient
 *
 * @example
 * ```typescript
 * const nullifier = extractNullifierFromPublicInputs(publicInputsHex, 'coinbase_attestation');
 * console.log(nullifier); // '0xabcd1234...'
 *
 * // Check if nullifier is already registered
 * const isRegistered = await isNullifierRegistered(nullifier, registryAddress, provider);
 * ```
 */
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

/** @internal Reconstruct a bytes32 value from 32 individual field elements */
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
 * Check if a nullifier is already registered on-chain in the ZKProofport nullifier registry.
 *
 * This function queries the on-chain nullifier registry contract to determine if a nullifier
 * has been used before. This is used to prevent duplicate proof submissions from the same user
 * for the same scope.
 *
 * @param nullifier - The nullifier hash as hex string with 0x prefix
 * @param registryAddress - ZKProofportNullifierRegistry contract address
 * @param provider - ethers.js Provider instance (v5 or v6 compatible)
 * @returns Promise resolving to true if nullifier is registered, false otherwise
 *
 * @example
 * ```typescript
 * const nullifier = extractNullifierFromPublicInputs(publicInputsHex, circuit);
 * const isRegistered = await isNullifierRegistered(
 *   nullifier,
 *   '0x...',
 *   provider
 * );
 *
 * if (isRegistered) {
 *   console.log('This nullifier has already been used');
 * }
 * ```
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
 * Get detailed information about a registered nullifier from the on-chain registry.
 *
 * This function retrieves the registration timestamp, scope, and circuit ID for a nullifier
 * that has been registered on-chain. This metadata is useful for auditing and analytics.
 *
 * @param nullifier - The nullifier hash as hex string with 0x prefix
 * @param registryAddress - ZKProofportNullifierRegistry contract address
 * @param provider - ethers.js Provider instance (v5 or v6 compatible)
 * @returns Promise resolving to nullifier info object, or null if not registered
 *
 * @example
 * ```typescript
 * const info = await getNullifierInfo(nullifier, registryAddress, provider);
 *
 * if (info) {
 *   console.log('Registered at:', new Date(info.registeredAt * 1000));
 *   console.log('Scope:', info.scope);
 *   console.log('Circuit:', info.circuitId);
 * } else {
 *   console.log('Nullifier not registered');
 * }
 * ```
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
