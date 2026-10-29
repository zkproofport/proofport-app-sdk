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
  CoinbaseAttestation: { circuit: 'coinbase_attestation', variant: 'standard' },
  CoinbaseCountryAttestation: { circuit: 'coinbase_country_attestation', variant: 'standard' },
  OidcDomainAttestation: { circuit: 'oidc_domain_attestation', variant: 'standard' },
  OidcDomainAttestationAndroid: { circuit: 'oidc_domain_attestation', variant: 'android' },
  OidcDomainAttestationAndroidFactory: { circuit: 'oidc_domain_attestation', variant: 'android_factory' },
  GiwaAttestation: { circuit: 'giwa_attestation', variant: 'standard' },
  DojangPlayground: { circuit: 'dojang_playground', variant: 'standard' },
});

/** Deployed by these scripts, and not proof verifiers. */
export const NOT_VERIFIERS = new Set(['NullifierRegistry', 'ZKProofPortNullifierRegistry', 'TranscriptLib']);

/**
 * Verifiers this core version deliberately does not pin, each with its reason.
 * Named one by one so a new deploy script still stops the generator.
 *   CoinbaseAppAttestPoc          the Coinbase KYC v2 prototype (circuits
 *                                 33344e2); no shipped circuit uses it.
 *   CoinbaseAttestationV2         Coinbase KYC v2 has its own public-input
 *                                 layout; core pins it in the core v2 release
 *                                 (circuits-dev.md fix list item 9), not as a
 *                                 v1 coinbase_attestation row.
 *   CoinbaseAttestationV2Android  the Android signer's package of the same
 *                                 Coinbase KYC v2 layout; pinned with
 *                                 CoinbaseAttestationV2 in that release. This
 *                                 core reads coinbase_attestation as v1 (128
 *                                 public inputs), which refuses every v2 proof.
 *   CoinbaseAttestationV2AndroidFactory  the factory-provisioned Android
 *                                 signer's package of the same layout; same
 *                                 reason.
 *   MdlKrOwnership, MdlKrAge,     circuits that are not part of ZKProofport;
 *   MdlKrRegion                   core has no circuit id for them, so their
 *                                 testnet records are skipped by name.
 */
export const NOT_PINNED_HERE = new Set([
  'CoinbaseAppAttestPoc',
  'CoinbaseAttestationV2',
  'CoinbaseAttestationV2Android',
  'CoinbaseAttestationV2AndroidFactory',
  'MdlKrOwnership',
  'MdlKrAge',
  'MdlKrRegion',
]);
