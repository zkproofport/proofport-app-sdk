/**
 * On-chain verification utilities for ZKProofport SDK
 *
 * Compatible with both ethers v5 and v6.
 */

import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
import { VERIFIER_ABI, RPC_ENDPOINTS, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT } from './constants';
import { ALL_CIRCUIT_IDS, isCircuitId, type CircuitId } from './circuits';

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
 * @param circuit - The canonical circuit identifier. REQUIRED.
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
 * @param circuit - The canonical circuit identifier. REQUIRED.
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
 * @param circuit - The canonical circuit identifier. REQUIRED.
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
 * Where `scope` and `nullifier` sit in each circuit's public inputs.
 *
 * Keyed by `CircuitId`, which is the point: adding a circuit to the SDK makes
 * this object a compile error until somebody opens that circuit's `fn main`
 * and writes its offsets down. Nothing here can be inferred from the proof —
 * the public inputs are a flat array of bytes with no framing.
 *
 * It replaced an `if / else if / else` chain whose final `else` handed every
 * unrecognised circuit — and every call that named no circuit at all —
 * Coinbase's offsets. For `arc_eligibility` that is not a near miss: its
 * public inputs are signal_hash, domain_separator, action_hash, merkle root,
 * scope, nullifier, so the nullifier slot under Coinbase's offsets holds the
 * MERKLE ROOT, a value identical for every user. Duplicate detection built on
 * it would report one person.
 */
const PUBLIC_INPUT_OFFSETS: Readonly<Record<CircuitId, { scope: readonly [number, number]; nullifier: readonly [number, number] }>> = Object.freeze({
  // signal_hash, signer_list_merkle_root, scope, nullifier
  coinbase_attestation: { scope: [64, 95], nullifier: [96, 127] },
  // No longer Coinbase's layout. The GIWA circuit gained the EIP-712 pair, so
  // it reads like Arc: signal_hash, domain_separator, action_hash, merkle
  // root, then scope and nullifier 64 bytes further along than Coinbase.
  giwa_attestation: { scope: [128, 159], nullifier: [160, 191] },
  // country_list, country_list_length and is_included sit before scope.
  coinbase_country_attestation: { scope: [86, 117], nullifier: [118, 149] },
  // pubkey_modulus_limbs and the bounded domain sit before scope.
  oidc_domain_attestation: { scope: [83, 114], nullifier: [115, 146] },
  // signal_hash, domain_separator, action_hash, merkle root, then the pair.
  arc_eligibility: { scope: [128, 159], nullifier: [160, 191] },
  // The Korea mDL circuits open with the pair; signal_hash is commented out.
  mdl_kr_ownership: { scope: [0, 31], nullifier: [32, 63] },
  mdl_kr_age: { scope: [0, 31], nullifier: [32, 63] },
  mdl_kr_region: { scope: [0, 31], nullifier: [32, 63] },
});

/**
 * The offsets for a circuit, or an error naming what was asked for.
 *
 * Throwing is the whole point. A caller that omits the circuit, or names one
 * this SDK has never heard of, is asking a question with no answer; returning
 * a guess produced a scope and a nullifier that belong to different bytes and
 * looked exactly like real ones.
 */
function offsetsFor(circuit: string | undefined): { scope: readonly [number, number]; nullifier: readonly [number, number] } {
  if (circuit === undefined) {
    throw new Error(
      `A circuit id is required to read public inputs: the layout differs per circuit and cannot be inferred from the proof. Pass one of: ${ALL_CIRCUIT_IDS.join(', ')}`,
    );
  }
  if (!isCircuitId(circuit)) {
    throw new Error(
      `Unknown circuit '${circuit}'. Expected one of: ${ALL_CIRCUIT_IDS.join(', ')}`,
    );
  }
  return PUBLIC_INPUT_OFFSETS[circuit];
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
  circuit: string,
): string | null {
  const [start, end] = offsetsFor(circuit).scope;
  if (publicInputsHex.length <= end) return null;
  const scopeFields = publicInputsHex.slice(start, end + 1);
  return reconstructBytes32FromFields(scopeFields);
}

/**
 * Extracts the nullifier (bytes32) from public inputs based on circuit type.
 *
 * The nullifier is a unique, deterministic hash derived from the user's attestation
 * and scope. It serves as a privacy-preserving user identifier — the same user
 * with the same scope always produces the same nullifier, enabling duplicate
 * detection without revealing the wallet address.
 *
 * @param publicInputsHex - Array of hex-encoded field elements
 * @param circuit - Circuit id. REQUIRED: the layout differs per circuit and
 *   cannot be inferred from the proof. It used to default to
 *   `coinbase_attestation`, which returned the right-shaped bytes read from
 *   the wrong place for every other circuit.
 * @returns Nullifier as hex string (bytes32), or null if publicInputs too short
 *
 * @example
 * ```typescript
 * const nullifier = extractNullifierFromPublicInputs(publicInputs, 'coinbase_attestation');
 * console.log(nullifier); // '0xabc123...'
 * ```
 */
export function extractNullifierFromPublicInputs(
  publicInputsHex: string[],
  circuit: string,
): string | null {
  const [start, end] = offsetsFor(circuit).nullifier;
  if (publicInputsHex.length <= end) return null;
  const nullifierFields = publicInputsHex.slice(start, end + 1);
  return reconstructBytes32FromFields(nullifierFields);
}

/**
 * Extract domain string from OIDC Domain Attestation public inputs.
 *
 * The domain is stored as a Noir BoundedVec<u8, 64>, which serializes as
 * [storage[0..64], len]. Each storage element is a u8 value in a field element.
 *
 * @param publicInputsHex - Array of public input hex strings
 * @param circuit - Circuit identifier (must be 'oidc_domain_attestation')
 * @returns Domain as ASCII string, or null if circuit doesn't match or inputs are insufficient
 *
 * @example
 * ```typescript
 * const domain = extractDomainFromPublicInputs(publicInputs, 'oidc_domain_attestation');
 * console.log(domain); // 'example.com'
 * ```
 */
export function extractDomainFromPublicInputs(
  publicInputsHex: string[],
  circuit?: string,
): string | null {
  if (circuit !== 'oidc_domain_attestation') return null;

  const layout = OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT;
  if (publicInputsHex.length <= layout.DOMAIN_LEN) return null;

  const len = Number(BigInt(publicInputsHex[layout.DOMAIN_LEN]) & 0xFFn);
  if (len === 0 || len > 64) return null;

  const storageFields = publicInputsHex.slice(
    layout.DOMAIN_STORAGE_START,
    layout.DOMAIN_STORAGE_START + len,
  );

  const chars = storageFields.map(f => {
    const byte = Number(BigInt(f) & 0xFFn);
    return String.fromCharCode(byte);
  });

  return chars.join('');
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
