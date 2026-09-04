/**
 * ZKProofport SDK Constants
 */

import type { CircuitType, SDKEnvironment } from './types';

/**
 * Pre-configured relay server URLs for each environment.
 * Used by `ProofportSDK.create('production')` for zero-config initialization.
 *
 * @example
 * ```typescript
 * const sdk = ProofportSDK.create('production');
 * // Uses RELAY_URLS.production = 'https://relay.zkproofport.app'
 * ```
 */
export const RELAY_URLS: Record<SDKEnvironment, string> = {
  production: 'https://relay.zkproofport.app',
  staging: 'https://stg-relay.zkproofport.app',
  local: 'http://localhost:4001',
};

/**
 * Default deep link URL scheme for ZKProofport mobile app.
 * Used to construct deep link URLs that open the mobile app.
 *
 * @example
 * ```typescript
 * const deepLink = `${DEFAULT_SCHEME}://proof-request?...`;
 * // Results in: zkproofport://proof-request?...
 * ```
 */
export const DEFAULT_SCHEME = 'zkproofport';

/**
 * Deep link URL hosts for different proof request flows.
 * Used as the host component in deep link URLs.
 *
 * @example
 * ```typescript
 * const requestUrl = `zkproofport://${DEEP_LINK_HOSTS.PROOF_REQUEST}`;
 * const responseUrl = `zkproofport://${DEEP_LINK_HOSTS.PROOF_RESPONSE}`;
 * ```
 */
export const DEEP_LINK_HOSTS = {
  /** Host for proof requests sent to mobile app */
  PROOF_REQUEST: 'proof-request',
  /** Host for proof responses returned from mobile app */
  PROOF_RESPONSE: 'proof-response',
} as const;

/**
 * Circuit metadata containing display names, descriptions, and public input specifications.
 * Each circuit has a defined number and layout of public inputs that must match
 * the Noir circuit definition.
 *
 * @example
 * ```typescript
 * const metadata = CIRCUIT_METADATA['coinbase_attestation'];
 * console.log(metadata.name); // "Coinbase KYC"
 * console.log(metadata.publicInputsCount); // 128
 * ```
 */
export const CIRCUIT_METADATA: Record<CircuitType, {
  name: string;
  description: string;
  publicInputsCount: number;
  publicInputNames: string[];
}> = {
  coinbase_attestation: {
    name: 'Coinbase KYC',
    description: 'Prove Coinbase identity verification',
    // 4 x `pub [u8; 32]` in coinbase-attestation/src/main.nr, flattened to
    // bytes: signal_hash, signer_list_merkle_root, scope, nullifier.
    // Read 2 here until 2026-09-04, which was wrong under any reading —
    // the circuit has never had two public inputs, logical or flattened.
    publicInputsCount: 128,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
  },
  coinbase_country_attestation: {
    name: 'Coinbase Country',
    description: 'Prove Coinbase country verification',
    // 32 + 32 + (10 x 2) + 1 + 1 + 32 + 32 = 150, counted off
    // coinbase-country-attestation/src/main.nr. Read 14 until 2026-09-04.
    publicInputsCount: 150,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root', 'country_list', 'country_list_length', 'is_included'],
  },
  oidc_domain_attestation: {
    name: 'OIDC Domain',
    description: 'Prove email domain affiliation via OIDC JWT',
    publicInputsCount: 148,
    publicInputNames: ['pubkey_modulus_limbs', 'domain', 'scope', 'nullifier', 'provider'],
  },
  // Planned circuit — the identifier is reserved and the circuit exists, but it
  // is not officially supported yet. See CIRCUIT_SUPPORT_STATUS in ./circuits.
  // Forked from coinbase_attestation and shares its four public inputs, so the
  // count is the byte-flattened total (4 x [u8; 32] = 128), matching the
  // COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT indices below. The
  // coinbase_attestation entry above reports a legacy logical count of 2 and is
  // left as-is for backwards compatibility.
  giwa_attestation: {
    name: 'GIWA Attestation',
    description: 'Prove GIWA identity verification (planned — not officially supported yet)',
    publicInputsCount: 128,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root', 'scope', 'nullifier'],
  },
  // Korea Mobile ID (mDL) circuits. Planned — not officially supported yet.
  // Counts are byte-flattened field totals from the compiled circuit ABIs:
  // [u8; 32] arrays contribute 32 inputs each.
  mdl_kr_ownership: {
    name: 'Korea Mobile ID — Ownership',
    description: "Prove valid Korean mobile driver's license ownership with selective disclosure",
    publicInputsCount: 97,
    publicInputNames: ['scope', 'nullifier_value', 'disclose_flags', 'owner_commit'],
  },
  mdl_kr_age: {
    name: 'Korea Mobile ID — Age',
    description: "Prove minimum age from Korean mobile driver's license without revealing birth date",
    publicInputsCount: 66,
    publicInputNames: ['scope', 'nullifier_value', 'age_threshold', 'current_year'],
  },
  mdl_kr_region: {
    name: 'Korea Mobile ID — Region',
    description: "Prove si/do residency from Korean mobile driver's license without revealing address",
    publicInputsCount: 96,
    publicInputNames: ['scope', 'nullifier_value', 'region_code'],
  },
};

/**
 * Standard verifier contract ABI shared across all Barretenberg-generated verifiers.
 * This ABI defines the interface for calling the verify function on deployed verifier contracts.
 *
 * Uses ethers v6 human-readable ABI format.
 *
 * @example
 * ```typescript
 * import { Contract } from 'ethers';
 *
 * const verifier = new Contract(verifierAddress, VERIFIER_ABI, provider);
 * const isValid = await verifier.verify(proofBytes, publicInputs);
 * ```
 */
export const VERIFIER_ABI = [
  'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];

/**
 * Public RPC endpoint URLs for supported blockchain networks.
 * Used as fallback when no custom provider is supplied.
 *
 * Supported networks:
 * - 84532: Base Sepolia (testnet)
 * - 8453: Base Mainnet (production)
 *
 * @example
 * ```typescript
 * import { JsonRpcProvider } from 'ethers';
 *
 * const provider = new JsonRpcProvider(RPC_ENDPOINTS[84532]);
 * ```
 */
export const RPC_ENDPOINTS: Record<number, string> = {
  84532: 'https://sepolia.base.org', // Base Sepolia
  8453: 'https://mainnet.base.org', // Base Mainnet
};

/**
 * Default proof request expiration time in milliseconds.
 * Requests older than this are considered expired and should not be processed.
 *
 * Default: 10 minutes (600,000 ms)
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   // ...
 *   createdAt: Date.now(),
 *   expiresAt: Date.now() + DEFAULT_REQUEST_EXPIRY_MS
 * };
 * ```
 */
export const DEFAULT_REQUEST_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Maximum data size (in bytes) that can be encoded in a QR code.
 * Based on QR Code Version 40 with L (Low) error correction level.
 *
 * Requests exceeding this size should use alternative methods (HTTP, WebSocket).
 *
 * @example
 * ```typescript
 * const deepLinkUrl = generateDeepLink(request);
 * if (deepLinkUrl.length > MAX_QR_DATA_SIZE) {
 *   console.warn('Request too large for QR code');
 * }
 * ```
 */
export const MAX_QR_DATA_SIZE = 2953; // Version 40 with L error correction

/**
 * Coinbase Attestation circuit public input layout (byte offsets).
 * Defines the byte positions of each field in the flattened public inputs array.
 *
 * Public inputs are packed as bytes32 values:
 * - signal_hash: bytes 0-31
 * - merkle_root: bytes 32-63
 * - scope: bytes 64-95
 *
 * @example
 * ```typescript
 * const publicInputs = response.publicInputs;
 * const signalHash = publicInputs.slice(
 *   COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.SIGNAL_HASH_START,
 *   COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.SIGNAL_HASH_END + 1
 * );
 * ```
 */
export const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  SCOPE_START: 64,
  SCOPE_END: 95,
  NULLIFIER_START: 96,
  NULLIFIER_END: 127,
} as const;

/**
 * Coinbase Country Attestation circuit public input layout (byte offsets).
 * Defines the byte positions of each field in the flattened public inputs array.
 *
 * Public inputs are packed as bytes32 values:
 * - signal_hash: bytes 0-31
 * - merkle_root: bytes 32-63
 * - country_list: bytes 64-83 (20 bytes for 10 countries)
 * - country_list_length: byte 84
 * - is_included: byte 85
 * - scope: bytes 86-117
 *
 * @example
 * ```typescript
 * const publicInputs = response.publicInputs;
 * const countryList = publicInputs.slice(
 *   COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.COUNTRY_LIST_START,
 *   COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.COUNTRY_LIST_END + 1
 * );
 * ```
 */
export const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  COUNTRY_LIST_START: 64,
  COUNTRY_LIST_END: 83,
  COUNTRY_LIST_LENGTH: 84,
  IS_INCLUDED: 85,
  SCOPE_START: 86,
  SCOPE_END: 117,
  NULLIFIER_START: 118,
  NULLIFIER_END: 149,
} as const;

/**
 * Korea Mobile ID (mDL) circuit public input layout (field offsets).
 * All three mDL circuits share the same prefix: scope [0..31] and
 * nullifier_value [32..63], each stored one byte per field element.
 * The suffix differs per predicate circuit:
 * - mdl_kr_ownership (97 inputs): disclose_flags [64], owner_commit [65..96]
 * - mdl_kr_age (66 inputs): age_threshold [64], current_year [65]
 * - mdl_kr_region (96 inputs): region_code [64..95]
 *
 * @example
 * ```typescript
 * const nullifier = publicInputs.slice(
 *   MDL_KR_PUBLIC_INPUT_LAYOUT.NULLIFIER_START,
 *   MDL_KR_PUBLIC_INPUT_LAYOUT.NULLIFIER_END + 1
 * );
 * ```
 */
export const MDL_KR_PUBLIC_INPUT_LAYOUT = {
  SCOPE_START: 0,
  SCOPE_END: 31,
  NULLIFIER_START: 32,
  NULLIFIER_END: 63,
  OWNERSHIP_DISCLOSE_FLAGS: 64,
  OWNERSHIP_OWNER_COMMIT_START: 65,
  OWNERSHIP_OWNER_COMMIT_END: 96,
  AGE_THRESHOLD: 64,
  AGE_CURRENT_YEAR: 65,
  REGION_CODE_START: 64,
  REGION_CODE_END: 95,
} as const;

/**
 * OIDC Domain Attestation circuit public input layout (field offsets).
 * Defines the field positions in the flattened public inputs array (148 fields total).
 *
 * Circuit public inputs (from main.nr):
 * - pubkey_modulus_limbs: pub [u128; 18] → 18 fields (0–17)
 * - domain: pub BoundedVec<u8, 64> → 1 len + 64 storage = 65 fields (18–82)
 * - scope: pub [u8; 32] → 32 fields (83–114)
 * - nullifier: pub [u8; 32] → 32 fields (115–146)
 * - provider: pub u8 → 1 field (147)
 *
 * @example
 * ```typescript
 * const scope = publicInputs.slice(
 *   OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_START,
 *   OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_END + 1
 * );
 * ```
 */
export const OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  PUBKEY_MODULUS_START: 0,
  PUBKEY_MODULUS_END: 17,
  DOMAIN_STORAGE_START: 18,
  DOMAIN_STORAGE_END: 81,
  DOMAIN_LEN: 82,
  SCOPE_START: 83,
  SCOPE_END: 114,
  NULLIFIER_START: 115,
  NULLIFIER_END: 146,
  PROVIDER: 147,
  /** @deprecated Use DOMAIN_STORAGE_START */
  DOMAIN_START: 18,
  /** @deprecated Use DOMAIN_LEN */
  DOMAIN_END: 82,
} as const;
