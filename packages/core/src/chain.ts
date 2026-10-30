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

/**
 * Coinbase KYC (v2) circuit public input layout (field offsets), 193 fields.
 * One field per byte of each `[u8; 32]`, in `fn main`'s order
 * (coinbase-attestation-v2/src/main.nr; giwa_attestation's six, then
 * `attested_at`):
 * - signal_hash: 0-31 (zero when an EIP-712 action is signed)
 * - domain_separator: 32-63 and action_hash: 64-95 (zero without an action)
 * - signer_list_merkle_root: 96-127
 * - scope: 128-159
 * - nullifier: 160-191, keccak(keccak(wallet ++ keccak("coinbase_attestation")) ++ scope)
 * - attested_at: 192, unix seconds the signed statement names
 *
 * v1's layout (128 fields: signal_hash, root, scope, nullifier) is gone; a v1
 * proof is refused by its count on every verify path.
 *
 * @example
 * ```typescript
 * const scope = publicInputs.slice(
 *   COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_START,
 *   COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_END + 1
 * );
 * ```
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
  SCOPE_START: 128,
  SCOPE_END: 159,
  NULLIFIER_START: 160,
  NULLIFIER_END: 191,
  ATTESTED_AT: 192,
} as const;

/** Coinbase KYC (v2) public input count. A 128-input proof is v1 and refused. */
export const COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT = 193;

/**
 * Coinbase Country (v2) circuit public input layout (field offsets), 215 fields.
 * One field per byte of each `[u8; 32]` and of each country code, in `fn main`'s
 * order (coinbase-country-attestation-v2/src/main.nr: Coinbase KYC v2's order
 * with v1's country fields after the signer root, then `attested_at`):
 * - signal_hash: 0-31 (zero when an EIP-712 action is signed)
 * - domain_separator: 32-63 and action_hash: 64-95 (zero without an action)
 * - signer_list_merkle_root: 96-127
 * - country_list: 128-147, ten ISO 3166-1 alpha-2 codes, two ASCII bytes each
 * - country_list_length: 148 (1 to 10; entries at or past it are ignored)
 * - is_included: 149 (1 inclusion, 0 exclusion)
 * - scope: 150-181
 * - nullifier: 182-213, keccak(keccak(wallet ++ keccak("coinbase_country_attestation")) ++ scope)
 * - attested_at: 214, unix seconds the signed statement names
 *
 * v1's layout (150 fields: signal_hash, root, country list, length, inclusion,
 * scope, nullifier) is gone; a v1 proof is refused by its count on every
 * verify path.
 *
 * @example
 * ```typescript
 * const countryList = publicInputs.slice(
 *   COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.COUNTRY_LIST_START,
 *   COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.COUNTRY_LIST_END + 1
 * );
 * ```
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
  SCOPE_START: 150,
  SCOPE_END: 181,
  NULLIFIER_START: 182,
  NULLIFIER_END: 213,
  ATTESTED_AT: 214,
} as const;

/** Coinbase Country (v2) public input count. A 150-input proof is v1 and refused. */
export const COINBASE_COUNTRY_PUBLIC_INPUT_COUNT = 215;

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
