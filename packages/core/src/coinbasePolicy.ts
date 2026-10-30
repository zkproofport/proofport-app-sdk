/**
 * What a Coinbase KYC (v2) or Coinbase Country (v2) proof needs judged beyond
 * its verifier contract.
 *
 * Each circuit proves that a statement naming this wallet, an unrevoked
 * Coinbase attestation (KYC, or Country for the very country in the proven
 * transaction) and `attested_at` was signed by an iPhone App Attest key, an
 * Android-attested key or the proving server's key. Neither has a clock:
 * `attested_at` is whatever time the signer wrote, and a proof keeps verifying
 * forever. "Not revoked" only means "not revoked at attested_at", so a verifier
 * must hold attested_at to its own clock (circuits
 * coinbase-attestation-v2/README.md and coinbase-country-attestation-v2/README.md,
 * "Public inputs").
 *
 * Also here: the signer-list root (./signerRoots), because both circuits still
 * prove the attestation transaction against a root the prover supplies.
 */
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT,
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
} from './chain';
import type { IssuerCheckResult } from './oidcProviderKeys';
import { SIGNER_ROOT_LAYOUTS, signerRootCheck, type SignerRootLayout } from './signerRoots';

/** Public inputs of Coinbase KYC v1, which no verify path accepts any more. */
export const COINBASE_ATTESTATION_V1_PUBLIC_INPUT_COUNT = 128;

/** Public inputs of Coinbase Country v1, which no verify path accepts any more. */
export const COINBASE_COUNTRY_ATTESTATION_V1_PUBLIC_INPUT_COUNT = 150;

/**
 * How far `attested_at` may lag the verifier's clock. The same window as an
 * OIDC proof's `now`: on-device proving (2^20, or 2^21 for the Android
 * packages), relay delivery and a dApp that polls. A stored proof re-verified
 * later than this is refused. Both Coinbase circuits use it.
 */
export const COINBASE_ATTESTED_AT_MAX_AGE_SECONDS = 15 * 60;

/** How far `attested_at` may run ahead of the verifier's clock (a phone clock set fast). */
export const COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS = 5 * 60;

const U64_MAX = (1n << 64n) - 1n;

interface CoinbaseV2Shape {
  /** Name in messages: "Coinbase KYC", "Coinbase Country". */
  label: string;
  count: number;
  v1Count: number;
  attestedAt: number;
  root: SignerRootLayout;
}

function coinbaseV2Check(shape: CoinbaseV2Shape) {
  const rootCheck = signerRootCheck(shape.root);
  return async (publicInputs: readonly string[]): Promise<IssuerCheckResult> => {
    if (!Array.isArray(publicInputs)) {
      return { ok: false, error: `Expected ${shape.count} public inputs; got ${typeof publicInputs}.` };
    }
    if (publicInputs.length === shape.v1Count) {
      return {
        ok: false,
        error:
          `This is a ${shape.label} v1 proof (${shape.v1Count} public inputs). ` +
          `Only ${shape.label} v2 proofs (${shape.count} public inputs) are accepted; ` +
          'generate the proof again with a current ZKProofport app or prover.',
      };
    }
    const root = await rootCheck(publicInputs);
    if (!root.ok) return root;

    const index = shape.attestedAt;
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
  };
}

/**
 * Check a `coinbase_attestation` proof's public input count, signer-list root
 * and `attested_at` (192). Never throws for anything the proof's sender controls.
 */
export const checkCoinbaseAttestationProof: (publicInputs: readonly string[]) => Promise<IssuerCheckResult> = coinbaseV2Check({
  label: 'Coinbase KYC',
  count: COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT,
  v1Count: COINBASE_ATTESTATION_V1_PUBLIC_INPUT_COUNT,
  attestedAt: COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,
  root: SIGNER_ROOT_LAYOUTS.coinbase_attestation,
});

/**
 * Check a `coinbase_country_attestation` proof's public input count,
 * signer-list root (96) and `attested_at` (214). Never throws for anything the
 * proof's sender controls.
 *
 * The country list and the inclusion flag are public inputs the prover chose;
 * whether they are the ones the dApp asked for is the dApp's comparison
 * (COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT), as for scope.
 */
export const checkCoinbaseCountryAttestationProof: (publicInputs: readonly string[]) => Promise<IssuerCheckResult> = coinbaseV2Check({
  label: 'Coinbase Country',
  count: COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  v1Count: COINBASE_COUNTRY_ATTESTATION_V1_PUBLIC_INPUT_COUNT,
  attestedAt: COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,
  root: SIGNER_ROOT_LAYOUTS.coinbase_country_attestation,
});

/** How many countries a Coinbase Country proof's public list holds (`country_list: [[u8; 2]; 10]`). */
export const COINBASE_COUNTRY_LIST_MAX = 10;

/**
 * Why a requested country list cannot be proved, or `undefined` when it can.
 *
 * The circuit compares two ASCII bytes per entry with the attested country,
 * which Coinbase writes as an upper-case ISO 3166-1 alpha-2 code, and refuses
 * an empty list or one longer than ten. A list that breaks any of these would
 * only fail after the person had signed and waited for a proof (or, for
 * lower case, never match), so a request carrying one is refused up front.
 */
export function countryListError(countryList: unknown): string | undefined {
  if (!Array.isArray(countryList) || countryList.length === 0) {
    return 'countryList is required and must be a non-empty array';
  }
  if (countryList.length > COINBASE_COUNTRY_LIST_MAX) {
    return `countryList has ${countryList.length} entries; a Coinbase Country proof holds at most ${COINBASE_COUNTRY_LIST_MAX}`;
  }
  for (const [i, code] of countryList.entries()) {
    if (typeof code !== 'string') return 'countryList must contain only strings';
    if (!/^[A-Z]{2}$/.test(code)) {
      return `countryList[${i}] is ${JSON.stringify(code)}; each entry must be an upper-case ISO 3166-1 alpha-2 code such as "US"`;
    }
  }
  return undefined;
}

/** The list and direction a Coinbase Country request asked for. */
export interface CountryCondition {
  /** ISO 3166-1 alpha-2 codes, upper case, 1 to 10 of them. */
  countryList: readonly string[];
  /** `true`: the person's country must be in the list; `false`: must not be. */
  isIncluded: boolean;
}

/**
 * The list and direction a `coinbase_country_attestation` proof was made
 * against, read from its public inputs (128-149), or why they cannot be read.
 * Strict: every list byte is an upper-case ASCII letter inside the length and
 * zero past it, the length is 1 to 10, the flag 0 or 1 -- what every honest
 * prover writes. The circuit ignores the bytes past the length, so a prover
 * could put anything there; refusing that costs an honest proof nothing.
 */
export function readCountryCondition(
  publicInputs: readonly string[],
): { ok: true; condition: CountryCondition } | { ok: false; error: string } {
  if (!Array.isArray(publicInputs) || publicInputs.length !== COINBASE_COUNTRY_PUBLIC_INPUT_COUNT) {
    return {
      ok: false,
      error: `Expected ${COINBASE_COUNTRY_PUBLIC_INPUT_COUNT} public inputs; got ${Array.isArray(publicInputs) ? publicInputs.length : typeof publicInputs}.`,
    };
  }
  const L = COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT;
  const at = (i: number): bigint | undefined => {
    try {
      return BigInt(publicInputs[i]);
    } catch {
      return undefined;
    }
  };
  const length = at(L.COUNTRY_LIST_LENGTH);
  if (length === undefined || length < 1n || length > BigInt(COINBASE_COUNTRY_LIST_MAX)) {
    return { ok: false, error: `Public input ${L.COUNTRY_LIST_LENGTH} (country_list_length) is not 1 to ${COINBASE_COUNTRY_LIST_MAX}: ${publicInputs[L.COUNTRY_LIST_LENGTH]}.` };
  }
  const flag = at(L.IS_INCLUDED);
  if (flag !== 0n && flag !== 1n) {
    return { ok: false, error: `Public input ${L.IS_INCLUDED} (is_included) is not 0 or 1: ${publicInputs[L.IS_INCLUDED]}.` };
  }
  const countryList: string[] = [];
  for (let slot = 0; slot < COINBASE_COUNTRY_LIST_MAX; slot++) {
    const i = L.COUNTRY_LIST_START + 2 * slot;
    const a = at(i);
    const b = at(i + 1);
    if (slot < Number(length)) {
      const letter = (v: bigint | undefined) => v !== undefined && v >= 0x41n && v <= 0x5an;
      if (!letter(a) || !letter(b)) {
        return { ok: false, error: `Public inputs ${i}-${i + 1} (country_list[${slot}]) are not an upper-case country code.` };
      }
      countryList.push(String.fromCharCode(Number(a), Number(b)));
    } else if (a !== 0n || b !== 0n) {
      return { ok: false, error: `Public inputs ${i}-${i + 1} (country_list[${slot}]) lie past country_list_length and are not zero.` };
    }
  }
  return { ok: true, condition: { countryList, isIncluded: flag === 1n } };
}

/**
 * Whether a `coinbase_country_attestation` proof was made against the list
 * and direction the request asked for.
 *
 * The wallet's signature does not cover the list (the circuit takes it as a
 * public input), so a proof against ['KR'] verifies just as well as one
 * against the ['US'] a dApp asked for. Only this comparison makes the proof
 * answer the dApp's question. The lists are compared as sets of codes: the
 * order a list was written in does not change which countries it names.
 * Never throws for anything the proof's sender controls.
 */
export function checkCountryListMatches(
  publicInputs: readonly string[],
  requested: CountryCondition,
): IssuerCheckResult {
  const want = requested as CountryCondition | null | undefined;
  if (!want || typeof want !== 'object' || typeof want.isIncluded !== 'boolean') {
    return { ok: false, error: 'The requested country condition is missing or has no isIncluded flag.' };
  }
  const listError = countryListError(want.countryList);
  if (listError) return { ok: false, error: `The requested country list cannot be compared: ${listError}.` };
  const read = readCountryCondition(publicInputs);
  if (!read.ok) return read;
  const got = read.condition;
  if (got.isIncluded !== want.isIncluded) {
    return {
      ok: false,
      error: `The proof is ${got.isIncluded ? 'an inclusion' : 'an exclusion'} check, but the request asked for ${want.isIncluded ? 'inclusion' : 'exclusion'}.`,
    };
  }
  const key = (list: readonly string[]) => [...new Set(list)].sort().join(',');
  if (key(got.countryList) !== key(want.countryList)) {
    return {
      ok: false,
      error: `The proof's country list [${got.countryList.join(', ')}] is not the requested [${want.countryList.join(', ')}].`,
    };
  }
  return { ok: true };
}

/**
 * The Coinbase Country issuer check: count, signer root and attested_at
 * always; the list and direction too when the verifying caller knows the
 * request (`countryCondition`).
 */
export async function checkCoinbaseCountryProof(
  publicInputs: readonly string[],
  options: { countryCondition?: CountryCondition } = {},
): Promise<IssuerCheckResult> {
  const base = await checkCoinbaseCountryAttestationProof(publicInputs);
  if (!base.ok) return base;
  if (options.countryCondition === undefined) return base;
  return checkCountryListMatches(publicInputs, options.countryCondition);
}
