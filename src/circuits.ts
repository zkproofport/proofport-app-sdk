/**
 * Canonical ZKProofport circuit identifiers.
 *
 * This module is the single source of truth for circuit IDs. Every other layer
 * — the mobile app, the demo, the relay, server-side provers — reads its list
 * from here instead of keeping a private copy that silently drifts.
 *
 * It has **no imports and no dependencies**, so it can be pulled in on its own:
 *
 * ```typescript
 * import { CIRCUIT_IDS, isCircuitId } from '@zkproofport-app/sdk/circuits';
 * ```
 *
 * The same names are also re-exported from the package root
 * (`@zkproofport-app/sdk`) for callers that already import the SDK.
 *
 * ## Identifiers are canonical and case-sensitive
 *
 * Each ID is the circuit's `name` in its `Nargo.toml`, verbatim. The format is
 * lowercase with underscores. Hyphenated spellings (`coinbase-kyc`,
 * `mdl-kr-age`) are directory or UI route names in other repositories — they
 * are **not** circuit IDs, and passing one produces a nullifier mismatch or a
 * failed on-chain lookup rather than a clear error.
 */

/**
 * Whether a circuit is officially supported today or still on the roadmap.
 *
 * - `supported` — generally available. Safe to build a product on.
 * - `planned` — the identifier is reserved and the circuit exists, but it is
 *   not officially supported yet. Availability, inputs and public-input layout
 *   may change without a major version bump.
 */
export type CircuitSupportStatus = 'supported' | 'planned';

/**
 * Canonical circuit identifiers, keyed by a stable constant name.
 *
 * Prefer these constants over string literals so a rename is a compile error
 * rather than a runtime surprise.
 *
 * @example
 * ```typescript
 * import { CIRCUIT_IDS } from '@zkproofport-app/sdk/circuits';
 *
 * const relay = await sdk.createRelayRequest(CIRCUIT_IDS.COINBASE_ATTESTATION, {
 *   scope: 'myapp.com',
 * });
 * ```
 */
export const CIRCUIT_IDS = Object.freeze({
  /** Coinbase KYC attestation. Officially supported. */
  COINBASE_ATTESTATION: 'coinbase_attestation',
  /** Coinbase country attestation (inclusion / exclusion). Officially supported. */
  COINBASE_COUNTRY_ATTESTATION: 'coinbase_country_attestation',
  /** OIDC email-domain attestation. Officially supported. */
  OIDC_DOMAIN_ATTESTATION: 'oidc_domain_attestation',
  /** GIWA attestation. Planned — not officially supported yet. */
  GIWA_ATTESTATION: 'giwa_attestation',
  /** Korea Mobile ID ownership. Planned — not officially supported yet. */
  MDL_KR_OWNERSHIP: 'mdl_kr_ownership',
  /** Korea Mobile ID age threshold. Planned — not officially supported yet. */
  MDL_KR_AGE: 'mdl_kr_age',
  /** Korea Mobile ID si/do region. Planned — not officially supported yet. */
  MDL_KR_REGION: 'mdl_kr_region',
} as const);

/**
 * Union of every canonical circuit identifier.
 *
 * `CircuitType` (exported from the package root) is an alias of this type — the
 * two names refer to the same union, and this module is where it is defined.
 */
export type CircuitId = (typeof CIRCUIT_IDS)[keyof typeof CIRCUIT_IDS];

/**
 * Support status for every circuit.
 *
 * The record is exhaustive over {@link CircuitId}: adding an identifier without
 * giving it a status is a compile error, so this list cannot drift from
 * {@link CIRCUIT_IDS}.
 *
 * @example
 * ```typescript
 * import { CIRCUIT_SUPPORT_STATUS } from '@zkproofport-app/sdk/circuits';
 *
 * CIRCUIT_SUPPORT_STATUS.coinbase_attestation; // 'supported'
 * CIRCUIT_SUPPORT_STATUS.mdl_kr_age;           // 'planned'
 * ```
 */
export const CIRCUIT_SUPPORT_STATUS: Readonly<Record<CircuitId, CircuitSupportStatus>> =
  Object.freeze({
    coinbase_attestation: 'supported',
    coinbase_country_attestation: 'supported',
    oidc_domain_attestation: 'supported',
    giwa_attestation: 'planned',
    mdl_kr_ownership: 'planned',
    mdl_kr_age: 'planned',
    mdl_kr_region: 'planned',
  } as const);

/**
 * Where each circuit's verification key lives inside the `zkproofport/circuits`
 * repository, relative to its root.
 *
 * Off-chain verification needs the verification key and nothing else — no
 * circuit bytecode, no witness. The key is public by nature: it is what anyone
 * checking a proof must already have, and the Solidity verifiers deployed
 * on-chain embed the same key.
 *
 * Exhaustive over {@link CircuitId} on purpose. A new circuit whose key path is
 * not listed here fails to compile rather than failing at verification time,
 * where the only symptom would be a proof that cannot be checked.
 */
export const CIRCUIT_VK_PATHS: Readonly<Record<CircuitId, string>> = Object.freeze({
  coinbase_attestation: 'coinbase-attestation/target/vk',
  coinbase_country_attestation: 'coinbase-country-attestation/target/vk',
  oidc_domain_attestation: 'oidc-domain-attestation/target/vk',
  giwa_attestation: 'giwa-attestation/target/vk',
  mdl_kr_ownership: 'mdl/kr-ownership/target/vk',
  mdl_kr_age: 'mdl/kr-age/target/vk',
  mdl_kr_region: 'mdl/kr-region/target/vk',
} as const);

/**
 * Every canonical circuit identifier, in declaration order.
 *
 * Includes circuits that are still `planned`. Use {@link SUPPORTED_CIRCUIT_IDS}
 * when you only want the ones that are officially supported today.
 */
export const ALL_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  Object.values(CIRCUIT_IDS) as CircuitId[]
);

/**
 * Circuits that are officially supported today: the two Coinbase circuits and
 * OIDC domain attestation.
 *
 * Derived from {@link CIRCUIT_SUPPORT_STATUS}, so it cannot fall out of sync.
 */
export const SUPPORTED_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter((id) => CIRCUIT_SUPPORT_STATUS[id] === 'supported')
);

/**
 * Circuits whose identifiers are reserved but which are not officially
 * supported yet: GIWA attestation and the three Korea Mobile ID circuits.
 *
 * Derived from {@link CIRCUIT_SUPPORT_STATUS}, so it cannot fall out of sync.
 */
export const PLANNED_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter((id) => CIRCUIT_SUPPORT_STATUS[id] === 'planned')
);

/**
 * Narrows an unknown value to a canonical circuit identifier.
 *
 * Returns `false` for hyphenated route names such as `'coinbase-kyc'`, which
 * are not circuit IDs.
 *
 * @example
 * ```typescript
 * isCircuitId('coinbase_attestation'); // true
 * isCircuitId('coinbase-kyc');         // false
 * ```
 */
export function isCircuitId(value: unknown): value is CircuitId {
  return typeof value === 'string' && (ALL_CIRCUIT_IDS as readonly string[]).includes(value);
}

/**
 * Narrows an unknown value to a circuit identifier that is officially supported
 * today. Planned circuits return `false`.
 *
 * @example
 * ```typescript
 * isSupportedCircuitId('oidc_domain_attestation'); // true
 * isSupportedCircuitId('mdl_kr_age');              // false — planned
 * ```
 */
export function isSupportedCircuitId(value: unknown): value is CircuitId {
  return isCircuitId(value) && CIRCUIT_SUPPORT_STATUS[value] === 'supported';
}

/**
 * Returns the support status of a circuit.
 *
 * @param circuit - A canonical circuit identifier.
 * @throws Error when the value is not a canonical circuit identifier.
 *
 * @example
 * ```typescript
 * getCircuitSupportStatus('giwa_attestation'); // 'planned'
 * ```
 */
export function getCircuitSupportStatus(circuit: CircuitId): CircuitSupportStatus {
  if (!isCircuitId(circuit)) {
    throw new Error(
      `Unknown circuit '${String(circuit)}'. Expected one of: ${ALL_CIRCUIT_IDS.join(', ')}`
    );
  }
  return CIRCUIT_SUPPORT_STATUS[circuit];
}
