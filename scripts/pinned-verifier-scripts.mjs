/**
 * Which circuits deploy script pins which verifier, shared by
 * generate-pinned-verifiers.mjs and the test that holds it to core's
 * CIRCUIT_PACKAGES (src/__tests__/signerVariants.test.ts).
 *
 * Every deploy script that creates a HonkVerifier must be named in exactly one
 * of the three tables below; one that is not stops the generator, so a new
 * circuit cannot be deployed and silently left out.
 */

/** Deploy script name -> the circuit id and signer variant its verifier judges. */
export const VERIFIER_BY_SCRIPT = Object.freeze({
  CoinbaseAttestationV2: { circuit: 'coinbase_attestation', variant: 'standard' },
  CoinbaseAttestationV2Android: { circuit: 'coinbase_attestation', variant: 'android' },
  CoinbaseAttestationV2AndroidFactory: { circuit: 'coinbase_attestation', variant: 'android_factory' },
  CoinbaseCountryAttestationV2: { circuit: 'coinbase_country_attestation', variant: 'standard' },
  CoinbaseCountryAttestationV2Android: { circuit: 'coinbase_country_attestation', variant: 'android' },
  CoinbaseCountryAttestationV2AndroidFactory: { circuit: 'coinbase_country_attestation', variant: 'android_factory' },
  OidcDomainAttestation: { circuit: 'oidc_domain_attestation', variant: 'standard' },
  OidcDomainAttestationAndroid: { circuit: 'oidc_domain_attestation', variant: 'android' },
  OidcDomainAttestationAndroidFactory: { circuit: 'oidc_domain_attestation', variant: 'android_factory' },
  GiwaAttestation: { circuit: 'giwa_attestation', variant: 'standard' },
  DojangPlayground: { circuit: 'dojang_playground', variant: 'standard' },
  HumanPassportScore: { circuit: 'human_passport_score', variant: 'standard' },
});

/** Deployed by these scripts, and not proof verifiers. */
export const NOT_VERIFIERS = new Set(['NullifierRegistry', 'ZKProofPortNullifierRegistry', 'TranscriptLib']);

/**
 * Verifiers this core version deliberately does not pin, each with its reason.
 * Named one by one so a new deploy script still stops the generator.
 *   CoinbaseAppAttestPoc   the Coinbase KYC v2 prototype (circuits 33344e2); no
 *                          shipped circuit uses it.
 *   CoinbaseAttestation    Coinbase KYC v1 (128 public inputs). core judges
 *                          coinbase_attestation by the v2 layout (193), which
 *                          refuses every v1 proof by count, so pinning v1's
 *                          contracts would only name verifiers no accepted
 *                          proof can reach.
 *   CoinbaseCountryAttestation  Coinbase Country v1 (150 public inputs); core
 *                          judges coinbase_country_attestation by the v2
 *                          layout (215), so the same reason.
 */
export const NOT_PINNED_HERE = new Set([
  'CoinbaseAppAttestPoc',
  'CoinbaseAttestation',
  'CoinbaseCountryAttestation',
]);
