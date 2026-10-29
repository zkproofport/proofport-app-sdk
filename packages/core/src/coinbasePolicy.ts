/**
 * What a Coinbase KYC (v2) proof needs judged beyond its verifier contract.
 *
 * The circuit proves that a statement naming this wallet, an unrevoked Coinbase
 * KYC attestation and `attested_at` (public input 192) was signed by an iPhone
 * App Attest key, an Android-attested key or the proving server's key. It has no
 * clock: `attested_at` is whatever time the signer wrote, and a proof keeps
 * verifying forever. "Not revoked" only means "not revoked at attested_at", so a
 * verifier must hold attested_at to its own clock
 * (circuits coinbase-attestation-v2/README.md, "Public inputs").
 *
 * Also here: the signer-list root (./signerRoots), because the circuit still
 * proves the attestation transaction against a root the prover supplies.
 */
import { COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT } from './chain';
import type { IssuerCheckResult } from './oidcProviderKeys';
import { SIGNER_ROOT_LAYOUTS, signerRootCheck } from './signerRoots';

/** Public inputs of Coinbase KYC v1, which no verify path accepts any more. */
export const COINBASE_ATTESTATION_V1_PUBLIC_INPUT_COUNT = 128;

/**
 * How far `attested_at` may lag the verifier's clock. The same window as an
 * OIDC proof's `now`: on-device proving (2^20, or 2^21 for the Android
 * packages), relay delivery and a dApp that polls. A stored proof re-verified
 * later than this is refused.
 */
export const COINBASE_ATTESTED_AT_MAX_AGE_SECONDS = 15 * 60;

/** How far `attested_at` may run ahead of the verifier's clock (a phone clock set fast). */
export const COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS = 5 * 60;

const U64_MAX = (1n << 64n) - 1n;
const rootCheck = signerRootCheck(SIGNER_ROOT_LAYOUTS.coinbase_attestation);

/**
 * Check a `coinbase_attestation` proof's public input count, signer-list root
 * and `attested_at`. Never throws for anything the proof's sender controls.
 */
export async function checkCoinbaseAttestationProof(publicInputs: readonly string[]): Promise<IssuerCheckResult> {
  if (!Array.isArray(publicInputs)) {
    return { ok: false, error: `Expected ${COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT} public inputs; got ${typeof publicInputs}.` };
  }
  if (publicInputs.length === COINBASE_ATTESTATION_V1_PUBLIC_INPUT_COUNT) {
    return {
      ok: false,
      error:
        `This is a Coinbase KYC v1 proof (${COINBASE_ATTESTATION_V1_PUBLIC_INPUT_COUNT} public inputs). ` +
        `Only Coinbase KYC v2 proofs (${COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT} public inputs) are accepted; ` +
        'generate the proof again with a current ZKProofport app or prover.',
    };
  }
  const root = await rootCheck(publicInputs);
  if (!root.ok) return root;

  const index = COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT;
  let attestedAt: bigint;
  try {
    attestedAt = BigInt(publicInputs[index]);
  } catch {
    return { ok: false, error: `Public input ${index} (attested_at) is not a number.` };
  }
  if (attestedAt < 0n || attestedAt > U64_MAX) {
    return { ok: false, error: `Public input ${index} (attested_at) is out of range: ${attestedAt}.` };
  }
  const clock = BigInt(Math.floor(Date.now() / 1000));
  if (attestedAt > clock + BigInt(COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's attested_at (${attestedAt}) is ${attestedAt - clock}s ahead of this verifier's clock (${clock}); at most ${COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS}s is accepted.`,
    };
  }
  if (attestedAt < clock - BigInt(COINBASE_ATTESTED_AT_MAX_AGE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's attested_at (${attestedAt}) is ${clock - attestedAt}s behind this verifier's clock (${clock}); at most ${COINBASE_ATTESTED_AT_MAX_AGE_SECONDS}s is accepted.`,
    };
  }
  return { ok: true };
}
