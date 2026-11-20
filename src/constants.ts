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
    human_passport_score: 8453,
  },
  staging: {
    coinbase_attestation: 84532,
    coinbase_country_attestation: 84532,
    oidc_domain_attestation: 84532,
    giwa_attestation: 91342,
    dojang_playground: 91342,
    human_passport_score: 84532,
  },
  local: {
    coinbase_attestation: 84532,
    coinbase_country_attestation: 84532,
    oidc_domain_attestation: 84532,
    giwa_attestation: 91342,
    dojang_playground: 91342,
    human_passport_score: 84532,
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
 * console.log(metadata.publicInputsCount); // 133
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
    // Coinbase KYC v2 (coinbase-attestation-v2/src/main.nr): signal_hash
    // 0-31, domain_separator 32-63, action_hash 64-95, signer_list_merkle_root
    // 96-127, oprf_key_hash 128, domain 129, scope 130, nullifier 131 (one
    // Field each: the OPRF nullifier), attested_at 132 = 133 fields.
    publicInputsCount: 133,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'oprf_key_hash', 'domain', 'scope', 'nullifier', 'attested_at'],
  },
  coinbase_country_attestation: {
    name: 'Coinbase Country',
    description: 'Prove Coinbase country verification, optionally authorizing one EIP-712 action',
    // Coinbase Country v2 (coinbase-country-attestation-v2/src/main.nr):
    // signal_hash 0-31, domain_separator 32-63, action_hash 64-95,
    // signer_list_merkle_root 96-127, country_list 128-147 (10 x 2 bytes),
    // country_list_length 148, is_included 149, oprf_key_hash 150, domain
    // 151, scope 152, nullifier 153, attested_at 154 = 155 fields.
    publicInputsCount: 155,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'country_list', 'country_list_length', 'is_included', 'oprf_key_hash', 'domain', 'scope', 'nullifier', 'attested_at'],
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
  // compiled ABI: signal_hash 0-31, domain_separator 32-63, action_hash
  // 64-95, signer_list_merkle_root 96-127, then the OPRF nullifier's
  // oprf_key_hash 128, domain 129, scope 130, nullifier 131 = 132 fields.
  giwa_attestation: {
    name: 'GIWA Attestation',
    description: 'Prove GIWA identity verification, optionally authorizing one EIP-712 action (planned — not officially supported yet)',
    publicInputsCount: 132,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'oprf_key_hash', 'domain', 'scope', 'nullifier'],
  },
  // Experimental, GIWA Sepolia only. The wallet signs the request (an EIP-712
  // action, or signal_hash when none is given -- the same branch as GIWA), and
  // the same key must have signed a payAndIssueEAS() call to the Playground
  // faucet. No issuer list, so no merkle root: signal_hash 0-31,
  // domain_separator 32-63, action_hash 64-95, then oprf_key_hash 96, domain
  // 97, scope 98, nullifier 99 = 100 fields.
  dojang_playground: {
    name: 'Dojang Playground',
    description: 'Prove this wallet issued itself a Dojang through the GIWA Playground, optionally authorizing one EIP-712 action',
    publicInputsCount: 100,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'oprf_key_hash', 'domain', 'scope', 'nullifier'],
  },
  // human-passport-score/src/main.nr: GIWA's four `pub [u8; 32]` and the OPRF
  // four (128-131), then min_score (u32, score x 10^4), scorer_id and now
  // (u64) = 135 fields.
  human_passport_score: {
    name: 'Human Passport',
    description: 'Prove a Human Passport score at or above a threshold, optionally authorizing one EIP-712 action',
    publicInputsCount: 135,
    publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'oprf_key_hash', 'domain', 'scope', 'nullifier', 'min_score', 'scorer_id', 'now'],
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
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
} from '@zkproofport-app/core';
