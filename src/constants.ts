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
 * The chain each circuit is verified on, per environment. Complete: a circuit
 * added to the SDK is a compile error here until somebody names its chain.
 *
 * Mirrors the mobile app's `CIRCUIT_NETWORKS` (proofport-app
 * src/config/contracts.ts), because a proof is checked where the app said its
 * verifier is: Base for the Coinbase and OIDC circuits, GIWA Sepolia for GIWA
 * and Dojang (testnet-only).
 * The ADDRESS on that chain always comes from core's pinned table, never from
 * a proof response.
 */
export const VERIFICATION_CHAINS = {
  production: {
    coinbase_attestation: 8453,
    coinbase_country_attestation: 8453,
    oidc_domain_attestation: 8453,
    giwa_attestation: 91342,
    dojang_playground: 91342,
  },
  staging: {
    coinbase_attestation: 84532,
    coinbase_country_attestation: 84532,
    oidc_domain_attestation: 84532,
    giwa_attestation: 91342,
    dojang_playground: 91342,
  },
  local: {
    coinbase_attestation: 84532,
    coinbase_country_attestation: 84532,
    oidc_domain_attestation: 84532,
    giwa_attestation: 91342,
    dojang_playground: 91342,
  },
} as const satisfies Record<SDKEnvironment, Record<CircuitType, number>>;

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
 * console.log(metadata.publicInputsCount); // 193
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
    description: 'Prove Coinbase identity verification, optionally authorizing one EIP-712 action',
    // Coinbase KYC v2 (coinbase-attestation-v2/src/main.nr): GIWA's six
    // `pub [u8; 32]` in its order, then `attested_at: pub u64` = 193 fields.
    // signal_hash 0-31, domain_separator 32-63, action_hash 64-95,
    // signer_list_merkle_root 96-127, scope 128-159, nullifier 160-191,
    // attested_at 192. v1's 128 fields are refused on every verify path.
    publicInputsCount: 193,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'scope', 'nullifier', 'attested_at'],
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
    // v2: 148 v1 fields, then aud_hash (32), nonce_mode (1), nonce_binding
    // (32), now (1). oidc-domain-attestation/src/main.nr.
    publicInputsCount: 214,
    publicInputNames: ['pubkey_modulus_limbs', 'domain', 'scope', 'nullifier', 'provider', 'aud_hash', 'nonce_mode', 'nonce_binding', 'now'],
  },
  // Planned circuit — the identifier is reserved and the circuit exists, but it
  // is not officially supported yet. See CIRCUIT_SUPPORT_STATUS in ./circuits.
  // Forked from coinbase_attestation, then given the EIP-712 pair and a
  // branch: with an action the wallet signs the typed data and signal_hash is
  // zero; without one it signs signal_hash and the pair is zero. Read off the
  // compiled ABI (6 x [u8; 32] = 192): signal_hash 0-31, domain_separator
  // 32-63, action_hash 64-95, signer_list_merkle_root 96-127, scope 128-159,
  // nullifier 160-191.
  //
  // signal_hash is NOT part of this circuit's nullifier: a nullifier derived
  // from a public input nobody signs and nothing constrains would let one
  // wallet mint as many nullifiers as it likes; here the secret is the address
  // plus a constant compiled into the circuit.
  giwa_attestation: {
    name: 'GIWA Attestation',
    description: 'Prove GIWA identity verification, optionally authorizing one EIP-712 action (planned — not officially supported yet)',
    publicInputsCount: 192,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'scope', 'nullifier'],
  },
  // Experimental, GIWA Sepolia only. The wallet signs the request (an EIP-712
  // action, or signal_hash when none is given -- the same branch as GIWA), and
  // the same key must have signed a payAndIssueEAS() call to the Playground
  // faucet. No issuer list, so no merkle root: 5 x [u8; 32] = 160, read off the
  // compiled ABI -- signal_hash 0-31, domain_separator 32-63, action_hash
  // 64-95, scope 96-127, nullifier 128-159.
  dojang_playground: {
    name: 'Dojang Playground',
    description: 'Prove this wallet issued itself a Dojang through the GIWA Playground, optionally authorizing one EIP-712 action',
    publicInputsCount: 160,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'scope', 'nullifier'],
  },
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

// Moved to @zkproofport-app/core, re-exported so existing imports keep working.
export {
  VERIFIER_ABI,
  RPC_ENDPOINTS,
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
} from '@zkproofport-app/core';
