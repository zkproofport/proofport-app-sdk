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
import { checkOidcPolicy, type OidcPolicyOptions } from './oidcPolicy';
import { SIGNER_ROOT_LAYOUTS, signerRootCheck } from './signerRoots';
import {
  checkCoinbaseAttestationProof,
  checkCoinbaseCountryProof,
  checkDojangPlaygroundProof,
  checkGiwaAttestationProof,
  type CountryCondition,
} from './coinbasePolicy';
import { checkHumanPassportProof } from './humanPassportPolicy';
import { SIGNAL_HASH_LAYOUTS, checkSignalHash } from './signalHash';
import { checkOprfProof } from './oprfPolicy';
import { OPRF_PUBLIC_INPUT_LAYOUTS } from './oprfLayouts';
import type { OidcRequestContext } from './oidcPolicy';

/**
 * What a verify function passes down: the JWKS fetch timeout, the request the
 * proof answers (`oidc_domain_attestation` checks its nonce against it, see
 * ./oidcPolicy; every circuit with a signal_hash checks that, see ./signalHash),
 * and the country list and direction a Coinbase Country request asked for
 * (only `coinbase_country_attestation` reads it; see ./coinbasePolicy), and
 * the score threshold a Human Passport request asked for, in points
 * (only `human_passport_score` reads it; see ./humanPassportPolicy), and the
 * environment a wallet credential proof's OPRF key must belong to
 * (./oprfPolicy, ./oprfKeys).
 */
export interface ProofCheckOptions extends OidcKeyCheckOptions, OidcPolicyOptions {
  countryCondition?: CountryCondition;
  minScore?: number;
  /**
   * Which environment's OPRF key a wallet credential proof must carry the
   * hash of: 'production', 'staging' or 'local' (OPRF_KEY_HASHES). Required
   * for every circuit with an OPRF nullifier; production has no key yet and
   * refuses.
   */
  oprfEnvironment?: string;
  /**
   * The request the proof answers. `oprfDomain` is the OPRF domain string the
   * request named; a wallet credential proof's domain is compared with it.
   */
  request?: ProofRequestContext;
}

/** The request a proof answers: its scope and id, and for a wallet credential, the OPRF domain. */
export interface ProofRequestContext extends OidcRequestContext {
  oprfDomain?: string;
}

export type IssuerCheck = (publicInputs: readonly string[], options: ProofCheckOptions) => Promise<IssuerCheckResult>;

/**
 * The OIDC check: the token's audience, nonce and time first (offline, and a
 * refusal there costs no request to the provider), then the RSA key.
 */
export async function checkOidcProof(
  publicInputs: readonly string[],
  options: ProofCheckOptions = {},
): Promise<IssuerCheckResult> {
  const policy = checkOidcPolicy(publicInputs, { request: options.request });
  if (!policy.ok) return policy;
  return checkOidcProviderKey(publicInputs, { timeoutMs: options.timeoutMs });
}

/**
 * `null` means the circuit has no issuer anchor among its public inputs, so
 * there is nothing for a verifier to compare -- said per circuit below, so
 * nobody reads `null` as a check someone forgot.
 */
export const CIRCUIT_ISSUER_CHECKS = {
  // signer_list_merkle_root is chosen by the prover (./signerRoots), and
  // attested_at by the statement's signer (./coinbasePolicy).
  coinbase_attestation: checkCoinbaseAttestationProof,
  // The same two, at Country v2's offsets, and the requested country list and
  // direction when the caller knows the request.
  coinbase_country_attestation: checkCoinbaseCountryProof,
  // pubkey_modulus_limbs is chosen by the prover (./oidcProviderKeys), and the
  // audience, nonce and time it exposes need judging (./oidcPolicy).
  oidc_domain_attestation: checkOidcProof,
  // signer_list_merkle_root and attested_at, as for Coinbase KYC v2 (./coinbasePolicy).
  giwa_attestation: checkGiwaAttestationProof,
  // No issuer anchor: the Playground faucet address and GIWA Sepolia's chain
  // id are constants compiled into the circuit (dojang-playground-v2/src/main.nr),
  // so the verification key already pins them. What is judged is attested_at,
  // the device statement's time (./coinbasePolicy).
  dojang_playground: checkDojangPlaygroundProof,
  // The issuer root, the scorer and `now` are the prover's choice; the
  // threshold too, compared when the caller knows the request
  // (./humanPassportPolicy).
  human_passport_score: (publicInputs, options) => checkHumanPassportProof(publicInputs, { minScore: options.minScore }),
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
  options: ProofCheckOptions = {},
): Promise<IssuerCheckResult> {
  if (!isCircuitId(circuit)) {
    return { ok: false, error: `Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.` };
  }
  // The request binding first: offline, and a proof made for another request
  // is refused before any key fetch. Run only when the caller says which
  // request the proof answers (./signalHash).
  if (options.request !== undefined && SIGNAL_HASH_LAYOUTS[circuit] !== null) {
    const bound = checkSignalHash(circuit, publicInputs, options.request);
    if (!bound.ok) return bound;
  }
  // The OPRF key hash always; domain and scope when the request is known.
  if (OPRF_PUBLIC_INPUT_LAYOUTS[circuit] !== null) {
    const oprf = checkOprfProof(circuit, publicInputs, {
      oprfEnvironment: options.oprfEnvironment,
      request: options.request,
    });
    if (!oprf.ok) return oprf;
  }
  const check: IssuerCheck | null = CIRCUIT_ISSUER_CHECKS[circuit];
  if (check === null) return { ok: true };
  try {
    return await check(publicInputs, options);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
