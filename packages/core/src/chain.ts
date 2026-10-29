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
