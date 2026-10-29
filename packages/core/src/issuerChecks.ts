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
import { checkCoinbaseAttestationProof } from './coinbasePolicy';

/**
 * What a verify function passes down: the JWKS fetch timeout, and the request
 * the proof answers (only `oidc_domain_attestation` reads it; see ./oidcPolicy).
 */
export interface ProofCheckOptions extends OidcKeyCheckOptions, OidcPolicyOptions {}

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
  coinbase_country_attestation: signerRootCheck(SIGNER_ROOT_LAYOUTS.coinbase_country_attestation),
  // pubkey_modulus_limbs is chosen by the prover (./oidcProviderKeys), and the
  // audience, nonce and time it exposes need judging (./oidcPolicy).
  oidc_domain_attestation: checkOidcProof,
  giwa_attestation: signerRootCheck(SIGNER_ROOT_LAYOUTS.giwa_attestation),
  // No issuer anchor: the Playground faucet address and GIWA Sepolia's chain
  // id are constants compiled into the circuit (dojang-playground/src/main.nr,
  // PLAYGROUND_FAUCET, GIWA_SEPOLIA_CHAIN_ID), so the verification key already
  // pins them, and the issuance is self-signed by design -- no issuer exists.
  dojang_playground: null,
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
  const check: IssuerCheck | null = CIRCUIT_ISSUER_CHECKS[circuit];
  if (check === null) return { ok: true };
  try {
    return await check(publicInputs, options);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
