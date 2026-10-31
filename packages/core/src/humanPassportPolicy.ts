/**
 * What a `human_passport_score` proof needs judged beyond its verifier contract.
 *
 * The circuit proves the score statement against public inputs the PROVER
 * chooses: the issuer-list root, the scorer, the threshold and the clock. A
 * proof over a tree of the prover's own issuer key, a scorer nobody asked for,
 * a threshold of 0.0001 or `now = 0` (every attestation ever issued is
 * unexpired at 0) verifies on chain. So every verify path compares:
 *
 * - the root at 96-127 with HUMAN_PASSPORT_ISSUER_ROOT (./circuits);
 * - `scorer_id` (193) with the scorers Human Passport's chains name
 *   (HUMAN_PASSPORT_SCORER_IDS: 335, and Shape's 7922);
 * - `now` (194) with this verifier's clock, the same window as Coinbase's
 *   `attested_at` and OIDC's `now`, so a stored proof re-verified later is
 *   refused (the attestation may have expired since);
 * - `min_score` (192) with the threshold the request asked for, when the
 *   verifying caller knows it (`minScore`, in points: 20 = 20.0).
 */
import { HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT, HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT } from './chain';
import { HUMAN_PASSPORT_ISSUER_ROOT, HUMAN_PASSPORT_SCORER_IDS, humanPassportScoreUnits } from './circuits';
import type { IssuerCheckResult } from './oidcProviderKeys';
import { signerRootCheck } from './signerRoots';

/** How far `now` may lag the verifier's clock (on-device 2^21 proving, relay delivery, polling). */
export const HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS = 15 * 60;

/** How far `now` may run ahead of the verifier's clock (a phone clock set fast). */
export const HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS = 5 * 60;

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;

const rootCheck = signerRootCheck({
  rootStart: HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT.MERKLE_ROOT_START,
  publicInputCount: HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
  set: { signers: [], root: HUMAN_PASSPORT_ISSUER_ROOT, sources: ['@zkproofport-app/core humanPassport.ts'] },
  issuer: 'Human Passport',
});

function readScalar(publicInputs: readonly string[], index: number, name: string, max: bigint): bigint | { error: string } {
  let value: bigint;
  try {
    value = BigInt(publicInputs[index]);
  } catch {
    return { error: `Public input ${index} (${name}) is not a number.` };
  }
  if (value < 0n || value > max) return { error: `Public input ${index} (${name}) is out of range: ${value}.` };
  return value;
}

/**
 * What a `human_passport_score` proof is anchored to, without its clock: the
 * count, Human Passport's issuer root, one of its scorers and a non-zero threshold.
 * For a verifier re-checking a stored proof against its contract after the
 * `now` window has passed; a fresh answer goes through checkHumanPassportProof.
 */
export async function checkHumanPassportAnchors(publicInputs: readonly string[]): Promise<IssuerCheckResult> {
  const L = HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT;
  const root = await rootCheck(publicInputs);
  if (!root.ok) return root;

  const scorer = readScalar(publicInputs, L.SCORER_ID, 'scorer_id', U64_MAX);
  if (typeof scorer !== 'bigint') return { ok: false, error: scorer.error };
  if (!HUMAN_PASSPORT_SCORER_IDS.some(id => BigInt(id) === scorer)) {
    return {
      ok: false,
      error: `The proof's scorer_id is ${scorer}; only Human Passport's scorers ${HUMAN_PASSPORT_SCORER_IDS.join(', ')} are accepted.`,
    };
  }

  const minScore = readScalar(publicInputs, L.MIN_SCORE, 'min_score', U32_MAX);
  if (typeof minScore !== 'bigint') return { ok: false, error: minScore.error };
  if (minScore === 0n) {
    return { ok: false, error: 'The proof\'s min_score is 0, which proves no threshold at all.' };
  }
  return { ok: true };
}

/**
 * Check a `human_passport_score` proof's count, issuer root, scorer and `now`,
 * and its threshold when `options.minScore` is given. Never throws for
 * anything the proof's sender controls.
 */
export async function checkHumanPassportProof(
  publicInputs: readonly string[],
  options: { minScore?: number } = {},
): Promise<IssuerCheckResult> {
  const L = HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT;
  const anchors = await checkHumanPassportAnchors(publicInputs);
  if (!anchors.ok) return anchors;
  const minScore = BigInt(publicInputs[L.MIN_SCORE]);

  const now = readScalar(publicInputs, L.NOW, 'now', U64_MAX);
  if (typeof now !== 'bigint') return { ok: false, error: now.error };
  const clock = BigInt(Math.floor(Date.now() / 1000));
  if (now > clock + BigInt(HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's now (${now}) is ${now - clock}s ahead of this verifier's clock (${clock}); at most ${HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS}s is accepted.`,
    };
  }
  if (now < clock - BigInt(HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's now (${now}) is ${clock - now}s behind this verifier's clock (${clock}); at most ${HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS}s is accepted.`,
    };
  }

  if (options.minScore !== undefined) {
    let wanted: number;
    try {
      wanted = humanPassportScoreUnits(options.minScore);
    } catch (error) {
      return { ok: false, error: `The requested threshold cannot be compared: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (minScore !== BigInt(wanted)) {
      return {
        ok: false,
        error: `The proof's threshold is ${Number(minScore) / 1e4} (min_score ${minScore}), but the request asked for ${options.minScore} (${wanted}).`,
      };
    }
  }
  return { ok: true };
}
