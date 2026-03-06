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
 * console.log(metadata.publicInputsCount); // 2
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
    publicInputsCount: 2,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
  },
  coinbase_country_attestation: {
    name: 'Coinbase Country',
    description: 'Prove Coinbase country verification',
    publicInputsCount: 14,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root', 'country_list', 'country_list_length', 'is_included'],
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
} as const;
