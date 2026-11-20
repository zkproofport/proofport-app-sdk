/**
 * Where each wallet credential circuit puts its four OPRF public inputs, and
 * the readers for them. Keyed by circuit id and exhaustive: a circuit added to
 * CIRCUIT_IDS is a compile error here until its `fn main` is read and its
 * offsets written down (or `null` written, with the reason).
 */
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT,
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT as KYC,
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT as DOJANG,
  GIWA_ATTESTATION_PUBLIC_INPUT_COUNT,
  GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT as GIWA,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT as HP,
} from './chain';
import { ALL_CIRCUIT_IDS, isCircuitId, type CircuitId } from './circuits';
import { P, toHex32 } from './oprf/field';

export interface OprfPublicInputLayout {
  /** The circuit's exact public input count. */
  readonly count: number;
  readonly keyHash: number;
  readonly domain: number;
  readonly scope: number;
  readonly nullifier: number;
  /**
   * Counts of this circuit's earlier shapes, with what made them, so a proof
   * from an app that has not updated is refused by name rather than as "wrong
   * count".
   */
  readonly superseded: Readonly<Record<number, string>>;
}

const row = (
  count: number,
  l: { OPRF_KEY_HASH: number; OPRF_DOMAIN: number; SCOPE: number; NULLIFIER: number },
  superseded: Record<number, string>,
): OprfPublicInputLayout =>
  Object.freeze({
    count,
    keyHash: l.OPRF_KEY_HASH,
    domain: l.OPRF_DOMAIN,
    scope: l.SCOPE,
    nullifier: l.NULLIFIER,
    superseded: Object.freeze(superseded),
  });

const PRE_OPRF = 'proof made before the OPRF nullifier (its nullifier is derived from the wallet address)';

/** `null`: the circuit has no OPRF nullifier, with the reason beside it. */
export const OPRF_PUBLIC_INPUT_LAYOUTS = Object.freeze({
  coinbase_attestation: row(COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, KYC, {
    193: `Coinbase KYC v2 ${PRE_OPRF}`,
    128: 'Coinbase KYC v1 proof made before the OPRF nullifier',
    68: 'Coinbase KYC v1 proof',
  }),
  coinbase_country_attestation: row(COINBASE_COUNTRY_PUBLIC_INPUT_COUNT, COUNTRY, {
    215: `Coinbase Country v2 ${PRE_OPRF}`,
    150: 'Coinbase Country v1 proof made before the OPRF nullifier',
    90: 'Coinbase Country v1 proof',
  }),
  // An ID token, not a wallet credential: its nullifier is from the token's
  // subject and the circuit has no wallet address to key an OPRF query with.
  oidc_domain_attestation: null,
  giwa_attestation: row(GIWA_ATTESTATION_PUBLIC_INPUT_COUNT, GIWA, { 192: `GIWA ${PRE_OPRF}` }),
  dojang_playground: row(DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT, DOJANG, { 160: `Dojang Playground ${PRE_OPRF}` }),
  human_passport_score: row(HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT, HP, { 195: `Human Passport ${PRE_OPRF}` }),
} satisfies Record<CircuitId, OprfPublicInputLayout | null>);

/** The circuits that publish an OPRF nullifier. */
export type OprfCircuitId = {
  [K in CircuitId]: (typeof OPRF_PUBLIC_INPUT_LAYOUTS)[K] extends null ? never : K;
}[CircuitId];

export const OPRF_CIRCUIT_IDS: readonly OprfCircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter(id => OPRF_PUBLIC_INPUT_LAYOUTS[id] !== null) as OprfCircuitId[],
);

/** The layout of a circuit with an OPRF nullifier; throws naming an unknown circuit or one without. */
export function oprfLayoutOf(circuit: unknown): OprfPublicInputLayout {
  if (circuit === undefined) {
    throw new Error(`A circuit id is required to read public inputs. Pass one of: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  if (!isCircuitId(circuit)) {
    throw new Error(`Unknown circuit '${String(circuit)}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  const layout = OPRF_PUBLIC_INPUT_LAYOUTS[circuit];
  if (layout === null) {
    throw new Error(`${circuit} has no OPRF nullifier. Circuits that do: ${OPRF_CIRCUIT_IDS.join(', ')}.`);
  }
  return layout;
}

/** The four OPRF public inputs, each as 0x + 64 hex (a field element below p). */
export interface OprfPublicInputs {
  oprfKeyHash: string;
  domain: string;
  scope: string;
  nullifier: string;
}

/** One public input as a field element; throws for a non-number or a value at or above p. */
export function readFieldPublicInput(publicInputs: readonly string[], index: number, name: string): string {
  const raw = publicInputs[index];
  let v: bigint;
  try {
    if (typeof raw !== 'string' || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(raw)) throw new Error('not a number');
    v = BigInt(raw);
  } catch {
    throw new Error(`Public input ${index} (${name}) is not a number: ${JSON.stringify(raw)}.`);
  }
  if (v >= P) throw new Error(`Public input ${index} (${name}) is not below the field modulus: ${raw}.`);
  return toHex32(v);
}

/**
 * The OPRF public inputs of a `circuit` proof. Strict: the count must be the
 * circuit's (an earlier shape is named), and each value a field element.
 *
 * @throws Error naming an unknown circuit, a circuit without an OPRF
 *   nullifier, a wrong count, or a value that is not a field element.
 */
export function readOprfPublicInputs(circuit: unknown, publicInputs: readonly string[]): OprfPublicInputs {
  const layout = oprfLayoutOf(circuit);
  if (!Array.isArray(publicInputs)) throw new Error(`Expected ${layout.count} public inputs; got ${typeof publicInputs}.`);
  if (publicInputs.length !== layout.count) {
    const earlier = layout.superseded[publicInputs.length];
    if (earlier !== undefined) {
      throw new Error(
        `This is a ${earlier} (${publicInputs.length} public inputs). Only ${String(circuit)} proofs with the ` +
          `OPRF nullifier (${layout.count} public inputs) are accepted; generate the proof again with a current ZKProofport app or prover.`,
      );
    }
    throw new Error(`A ${String(circuit)} proof has ${layout.count} public inputs; got ${publicInputs.length}.`);
  }
  return {
    oprfKeyHash: readFieldPublicInput(publicInputs, layout.keyHash, 'oprf_key_hash'),
    domain: readFieldPublicInput(publicInputs, layout.domain, 'domain'),
    scope: readFieldPublicInput(publicInputs, layout.scope, 'scope'),
    nullifier: readFieldPublicInput(publicInputs, layout.nullifier, 'nullifier'),
  };
}
