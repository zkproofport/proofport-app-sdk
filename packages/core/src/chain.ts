/**
 * What on-chain verification needs: the verifier ABI, public RPC endpoints,
 * and where each circuit's values sit in its flat public-input array.
 */

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
 * - 91342: GIWA Sepolia (testnet) — where the GIWA account circuit verifies
 *
 * A chain missing from this map is not a quiet degradation: `getDefaultProvider`
 * throws "No RPC endpoint configured for chain N". That is what a caller saw
 * when verifying a GIWA proof on chain 91342 — the verifier contract had been
 * deployed and the proof was valid, but the SDK had no way to reach the chain
 * to ask. Deploying a verifier to a new network means adding it here too.
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
  91342: 'https://sepolia-rpc.giwa.io', // GIWA Sepolia
};

/*
 * The wallet credential circuits publish TACEO's OPRF nullifier as four
 * Fields, in this order, where they used to publish `scope` and `nullifier`
 * as 32 bytes each (circuits-dev.md, "OPRF nullifier in every wallet
 * credential circuit"):
 *   oprf_key_hash  Poseidon2(DS_key, D.x, D.y) of the OPRF key that answered
 *   domain         keccak256(utf8(domain string)) mod p
 *   scope          keccak256(utf8(scope string)) mod p
 *   nullifier      the OPRF output
 * Everything before them keeps its offset; everything after moved by -60.
 * ./oprfPolicy reads and judges the four; these layouts are its source.
 */

/**
 * Coinbase KYC (v2) circuit public input layout (field offsets), 133 fields.
 * One field per byte of each `[u8; 32]`, in `fn main`'s order
 * (coinbase-attestation-v2/src/main.nr):
 * - signal_hash: 0-31 (zero when an EIP-712 action is signed)
 * - domain_separator: 32-63 and action_hash: 64-95 (zero without an action)
 * - signer_list_merkle_root: 96-127
 * - oprf_key_hash 128, domain 129, scope 130, nullifier 131 (one Field each)
 * - attested_at: 132, unix seconds the signed statement names
 *
 * Refused by count on every verify path: v1 (68 fields; 128 before the OPRF
 * nullifier) and v2 from before the OPRF nullifier (193).
 */
export const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  DOMAIN_SEPARATOR_START: 32,
  DOMAIN_SEPARATOR_END: 63,
  ACTION_HASH_START: 64,
  ACTION_HASH_END: 95,
  MERKLE_ROOT_START: 96,
  MERKLE_ROOT_END: 127,
  OPRF_KEY_HASH: 128,
  OPRF_DOMAIN: 129,
  SCOPE: 130,
  NULLIFIER: 131,
  ATTESTED_AT: 132,
} as const;

/** Coinbase KYC (v2) public input count. */
export const COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT = 133;

/**
 * Coinbase Country (v2) circuit public input layout (field offsets), 155 fields
 * (coinbase-country-attestation-v2/src/main.nr: Coinbase KYC v2's order with
 * v1's country fields after the signer root, then `attested_at`):
 * - signal_hash: 0-31 (zero when an EIP-712 action is signed)
 * - domain_separator: 32-63 and action_hash: 64-95 (zero without an action)
 * - signer_list_merkle_root: 96-127
 * - country_list: 128-147, ten ISO 3166-1 alpha-2 codes, two ASCII bytes each
 * - country_list_length: 148 (1 to 10; entries at or past it are ignored)
 * - is_included: 149 (1 inclusion, 0 exclusion)
 * - oprf_key_hash 150, domain 151, scope 152, nullifier 153
 * - attested_at: 154, unix seconds the signed statement names
 *
 * Refused by count on every verify path: v1 (90; 150 before the OPRF
 * nullifier) and v2 from before the OPRF nullifier (215).
 */
export const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  DOMAIN_SEPARATOR_START: 32,
  DOMAIN_SEPARATOR_END: 63,
  ACTION_HASH_START: 64,
  ACTION_HASH_END: 95,
  MERKLE_ROOT_START: 96,
  MERKLE_ROOT_END: 127,
  COUNTRY_LIST_START: 128,
  COUNTRY_LIST_END: 147,
  COUNTRY_LIST_LENGTH: 148,
  IS_INCLUDED: 149,
  OPRF_KEY_HASH: 150,
  OPRF_DOMAIN: 151,
  SCOPE: 152,
  NULLIFIER: 153,
  ATTESTED_AT: 154,
} as const;

/** Coinbase Country (v2) public input count. */
export const COINBASE_COUNTRY_PUBLIC_INPUT_COUNT = 155;

/**
 * GIWA attestation public input layout, 132 fields (giwa-attestation/src/main.nr):
 * signal_hash 0-31, domain_separator 32-63, action_hash 64-95,
 * signer_list_merkle_root 96-127, then the OPRF four at 128-131.
 * 192 before the OPRF nullifier.
 */
export const GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  DOMAIN_SEPARATOR_START: 32,
  DOMAIN_SEPARATOR_END: 63,
  ACTION_HASH_START: 64,
  ACTION_HASH_END: 95,
  MERKLE_ROOT_START: 96,
  MERKLE_ROOT_END: 127,
  OPRF_KEY_HASH: 128,
  OPRF_DOMAIN: 129,
  SCOPE: 130,
  NULLIFIER: 131,
} as const;

/** GIWA attestation public input count. */
export const GIWA_ATTESTATION_PUBLIC_INPUT_COUNT = 132;

/**
 * Dojang Playground public input layout, 100 fields (dojang-playground/src/main.nr):
 * signal_hash 0-31, domain_separator 32-63, action_hash 64-95 (no issuer
 * list, so no root), then the OPRF four at 96-99. 160 before the OPRF nullifier.
 */
export const DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  DOMAIN_SEPARATOR_START: 32,
  DOMAIN_SEPARATOR_END: 63,
  ACTION_HASH_START: 64,
  ACTION_HASH_END: 95,
  OPRF_KEY_HASH: 96,
  OPRF_DOMAIN: 97,
  SCOPE: 98,
  NULLIFIER: 99,
} as const;

/** Dojang Playground public input count. */
export const DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT = 100;

/**
 * Human Passport score circuit public input layout (field offsets), 135 fields
 * (human-passport-score/src/main.nr):
 * - signal_hash: 0-31 (zero when an EIP-712 action is signed)
 * - domain_separator: 32-63 and action_hash: 64-95 (zero without an action)
 * - signer_list_merkle_root: 96-127, root over (issuer, GitcoinVerifier domain,
 *   scoreV2 schema) leaves; must be HUMAN_PASSPORT_ISSUER_ROOT
 * - oprf_key_hash 128, domain 129, scope 130, nullifier 131
 * - min_score: 132, threshold in score units (score x 10^4)
 * - scorer_id: 133, the Passport scorer the score belongs to
 * - now: 134, unix seconds the attestation was unexpired at
 * 195 before the OPRF nullifier.
 */
export const HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  DOMAIN_SEPARATOR_START: 32,
  DOMAIN_SEPARATOR_END: 63,
  ACTION_HASH_START: 64,
  ACTION_HASH_END: 95,
  MERKLE_ROOT_START: 96,
  MERKLE_ROOT_END: 127,
  OPRF_KEY_HASH: 128,
  OPRF_DOMAIN: 129,
  SCOPE: 130,
  NULLIFIER: 131,
  MIN_SCORE: 132,
  SCORER_ID: 133,
  NOW: 134,
} as const;

/** Human Passport score public input count. */
export const HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT = 135;

/**
 * OIDC Domain Attestation circuit public input layout (field offsets), v2.
 * Defines the field positions in the flattened public inputs array (214 fields total).
 *
 * Circuit public inputs (from main.nr). Offsets 0-147 are v1's, unchanged;
 * v2 appends the token's audience, nonce and time after `provider`:
 * - pubkey_modulus_limbs: pub [u128; 18] → 18 fields (0–17)
 * - domain: pub BoundedVec<u8, 64> → 64 storage + 1 len = 65 fields (18–82)
 * - scope: pub [u8; 32] → 32 fields (83–114)
 * - nullifier: pub [u8; 32] → 32 fields (115–146)
 * - provider: pub u8 → 1 field (147), 0 Google, 1 Microsoft
 * - aud_hash: pub [u8; 32] → 32 fields (148–179), keccak256 of the token's `aud`
 * - nonce_mode: pub u8 → 1 field (180), 1 request-bound nonce, 0 none
 * - nonce_binding: pub [u8; 32] → 32 fields (181–212); the token's nonce is its
 *   lowercase hex in mode 1, all zero in mode 0
 * - now: pub u64 → 1 field (213), unix seconds with iat <= now < exp
 *
 * A v1 proof has 148 fields and is refused by every verify path
 * (see ./oidcPolicy).
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
  AUD_HASH_START: 148,
  AUD_HASH_END: 179,
  NONCE_MODE: 180,
  NONCE_BINDING_START: 181,
  NONCE_BINDING_END: 212,
  NOW: 213,
  /** @deprecated Use DOMAIN_STORAGE_START */
  DOMAIN_START: 18,
  /** @deprecated Use DOMAIN_LEN */
  DOMAIN_END: 82,
} as const;
