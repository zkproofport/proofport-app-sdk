/**
 * Checks a proof needs beyond the circuit itself, run by every verify function
 * this package and the SDK export -- on-chain and off-chain alike -- so that a
 * dApp calling any of them gets the same answer without knowing these exist.
 *
 * One table, keyed by circuit id and exhaustive over it: a circuit added to
 * `CIRCUIT_IDS` is a compile error here until somebody decides what, if
 * anything, its public inputs need checked against the outside world.
 */
import { ALL_CIRCUIT_IDS, isCircuitId, type CircuitId } from './circuits';
import { checkOidcProviderKey, type IssuerCheckResult, type OidcKeyCheckOptions } from './oidcProviderKeys';

export type IssuerCheck = (publicInputs: readonly string[], options: OidcKeyCheckOptions) => Promise<IssuerCheckResult>;

/**
 * `null` means this package runs no issuer check for that circuit today. For
 * the Coinbase circuits and GIWA that is a known gap, not a statement that none
 * is needed: their signer-list Merkle root is a public input the verifier must
 * compare with the published signer set (OpenStoa does, in
 * `src/lib/proof-issuer.ts`). It is recorded here so nobody reads `null` as
 * "safe".
 */
export const CIRCUIT_ISSUER_CHECKS = {
  coinbase_attestation: null,
  coinbase_country_attestation: null,
  // pubkey_modulus_limbs is chosen by the prover; see ./oidcProviderKeys.
  oidc_domain_attestation: checkOidcProviderKey,
  giwa_attestation: null,
  // Self-issued by design: no issuer list exists to compare with.
  dojang_playground: null,
  mdl_kr_ownership: null,
  mdl_kr_age: null,
  mdl_kr_region: null,
} satisfies Record<CircuitId, IssuerCheck | null>;

/**
 * Run a circuit's issuer check. Never throws: an unknown circuit, an unknown
 * provider or a failed fetch all come back as `{ ok: false, error }`, because
 * every one of them arrives from the proof's sender and a verify function must
 * answer "not valid", not crash the caller.
 */
export async function checkProofIssuer(
  circuit: string,
  publicInputs: readonly string[],
  options: OidcKeyCheckOptions = {},
): Promise<IssuerCheckResult> {
  if (!isCircuitId(circuit)) {
    return { ok: false, error: `Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.` };
  }
  const check: IssuerCheck | null = CIRCUIT_ISSUER_CHECKS[circuit];
  if (check === null) return { ok: true };
  try {
    return await check(publicInputs, options);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
