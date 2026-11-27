/**
 * Reading a proof's scope and nullifier requires knowing which circuit made it.
 *
 * These two functions used to be an `if / else if / else` chain whose final
 * `else` handed Coinbase's byte offsets to every unrecognised circuit — and to
 * every call that named no circuit at all, which is what OpenStoa's AI login
 * route does. The values that came back were the right shape, the right
 * length, and the wrong bytes. They are a table keyed by circuit id now.
 *
 * Since the OPRF nullifier (circuits-dev.md, "OPRF nullifier in every wallet
 * credential circuit") every wallet credential circuit publishes oprf_key_hash,
 * domain, scope and nullifier as ONE Field each where it had scope and
 * nullifier as 32 bytes each. The expected offsets below are that table,
 * typed in from the document rather than read from core, so a change on
 * either side shows here. OIDC keeps its 32-byte scope and nullifier.
 */
import { describe, it, expect } from 'vitest';
import {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
  extractOprfDomainFromPublicInputs,
  extractOprfKeyHashFromPublicInputs,
  OPRF_PUBLIC_INPUT_LAYOUTS,
  readOprfPublicInputs,
  reduceOprfName,
} from '../verifier';
import { ALL_CIRCUIT_IDS } from '../circuits';
import { CIRCUIT_METADATA } from '../constants';
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT,
  GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT,
} from '../verifier';
import { oprfQuery } from '../../packages/core/src/oprf';
import { encodeToCurve, scalarMul } from '../../packages/core/src/oprf/babyjubjub';
import { poseidon2T4 } from '../../packages/core/src/oprf/poseidon2';
import { OPRF_DS_OUT } from '../../packages/core/src/oprf/client';
import dojangProof from './fixtures/dojangPlaygroundPublicInputs.json';
import vectors from './fixtures/oprf-vectors.json';

const ZERO = '0x' + '00'.repeat(32);
const f = (v: number | bigint) => '0x' + BigInt(v).toString(16).padStart(64, '0');

/** Public inputs as the prover emits them, with `marks` placed. */
function fieldsWith(marks: Record<number, string>, length: number): string[] {
  const out = new Array<string>(length).fill(ZERO);
  for (const [index, value] of Object.entries(marks)) out[Number(index)] = value;
  return out;
}

/** A run of 32 fields all holding the same byte, starting at `start`. */
function block(start: number, byte: number): Record<number, string> {
  return Object.fromEntries(Array.from({ length: 32 }, (_, i) => [start + i, f(byte)]));
}

// circuits-dev.md, "OPRF nullifier in every wallet credential circuit": count,
// then oprf_key_hash, domain, scope, nullifier. GIWA KYC and the Dojang
// Playground from "giwa_attestation / dojang_playground v2: status statement
// with expiry" (2026-11-27): attested_at appended last, 133 / 101.
const SPEC = {
  coinbase_attestation: [133, 128, 129, 130, 131],
  coinbase_country_attestation: [155, 150, 151, 152, 153],
  giwa_attestation: [133, 128, 129, 130, 131],
  dojang_playground: [101, 96, 97, 98, 99],
  human_passport_score: [135, 128, 129, 130, 131],
} as const;

// attested_at, where a circuit has one: the device statement's time, last.
const ATTESTED_AT = {
  coinbase_attestation: [COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT, 132],
  coinbase_country_attestation: [COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT.ATTESTED_AT, 154],
  giwa_attestation: [GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT, 132],
  dojang_playground: [DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT, 100],
} as const;

describe('the OPRF layout is the one the circuits document', () => {
  it.each(Object.entries(SPEC))('%s', (circuit, [count, keyHash, domain, scope, nullifier]) => {
    expect(OPRF_PUBLIC_INPUT_LAYOUTS[circuit as keyof typeof SPEC]).toMatchObject({ count, keyHash, domain, scope, nullifier });
  });

  it.each(Object.entries(ATTESTED_AT))('%s puts attested_at last, at the documented index', (circuit, [core, documented]) => {
    expect(core).toBe(documented);
    expect(core).toBe(SPEC[circuit as keyof typeof SPEC][0] - 1);
  });

  it('the SDK metadata agrees with core on every wallet circuit\'s count, and names attested_at where there is one', () => {
    for (const [circuit, [count]] of Object.entries(SPEC)) {
      const meta = CIRCUIT_METADATA[circuit as keyof typeof SPEC];
      expect(meta.publicInputsCount, circuit).toBe(count);
      expect(meta.publicInputNames.includes('attested_at'), circuit).toBe(circuit in ATTESTED_AT);
    }
  });

  it.each([
    ['giwa_attestation', 132, /^This is a GIWA KYC proof made before the device status statement .*\(132 public inputs\)/],
    ['giwa_attestation', 192, /^This is a GIWA proof made before the OPRF nullifier/],
    ['dojang_playground', 100, /^This is a Dojang Playground proof made before the device status statement .*\(100 public inputs\)/],
    ['dojang_playground', 160, /^This is a Dojang Playground proof made before the OPRF nullifier/],
  ] as const)('%s: an earlier shape of %i public inputs is refused by name', (circuit, n, message) => {
    expect(() => readOprfPublicInputs(circuit, fieldsWith({}, n))).toThrow(message);
  });

  it('every circuit is listed: OIDC has none, every other has one', () => {
    expect(OPRF_PUBLIC_INPUT_LAYOUTS.oidc_domain_attestation).toBeNull();
    expect(Object.keys(OPRF_PUBLIC_INPUT_LAYOUTS).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
    expect(Object.keys(SPEC).sort()).toEqual(ALL_CIRCUIT_IDS.filter(id => id !== 'oidc_domain_attestation').sort());
  });
});

describe('public inputs are read per circuit', () => {
  it.each(Object.entries(SPEC))('reads %s at its own offsets, as Fields', (circuit, [count, keyHash, domain, scope, nullifier]) => {
    // 96-127 is the signer root where a circuit has one (Dojang has none: its OPRF four start at 96).
    const fields = fieldsWith({ ...(keyHash === 128 || keyHash === 150 ? block(96, 0xee) : {}), [keyHash]: f(0x0a), [domain]: f(0x0d), [scope]: f(0x5c), [nullifier]: f(0x77) }, count);
    expect(extractOprfKeyHashFromPublicInputs(fields, circuit)).toBe(f(0x0a));
    expect(extractOprfDomainFromPublicInputs(fields, circuit)).toBe(f(0x0d));
    expect(extractScopeFromPublicInputs(fields, circuit)).toBe(f(0x5c));
    expect(extractNullifierFromPublicInputs(fields, circuit)).toBe(f(0x77));
    expect(readOprfPublicInputs(circuit, fields)).toEqual({ oprfKeyHash: f(0x0a), domain: f(0x0d), scope: f(0x5c), nullifier: f(0x77) });
  });

  it('GIWA: the nullifier is never read from the signer root (the failure the table replaced)', () => {
    const fields = fieldsWith({ ...block(96, 0xee), 131: f(0x77) }, 133);
    expect(extractNullifierFromPublicInputs(fields, 'giwa_attestation')).toBe(f(0x77));
  });

  it('reads OIDC at its own byte offsets', () => {
    const oidc = fieldsWith({ ...block(83, 0x33), ...block(115, 0x44) }, 214);
    expect(extractScopeFromPublicInputs(oidc, 'oidc_domain_attestation')).toBe('0x' + '33'.repeat(32));
    expect(extractNullifierFromPublicInputs(oidc, 'oidc_domain_attestation')).toBe('0x' + '44'.repeat(32));
  });

  it('OIDC has no OPRF domain or key hash: asking is an error naming it', () => {
    const oidc = fieldsWith({}, 214);
    expect(() => extractOprfDomainFromPublicInputs(oidc, 'oidc_domain_attestation')).toThrow(/oidc_domain_attestation has no OPRF nullifier/);
    expect(() => extractOprfKeyHashFromPublicInputs(oidc, 'oidc_domain_attestation')).toThrow(/oidc_domain_attestation has no OPRF nullifier/);
    expect(() => readOprfPublicInputs('oidc_domain_attestation', oidc)).toThrow(/has no OPRF nullifier/);
  });

  it('refuses a call that names no circuit', () => {
    const fields = fieldsWith({}, 133);
    expect(() => (extractScopeFromPublicInputs as (f: string[]) => unknown)(fields)).toThrow(/circuit id is required/i);
    expect(() => (extractNullifierFromPublicInputs as (f: string[]) => unknown)(fields)).toThrow(/circuit id is required/i);
    expect(() => (extractOprfDomainFromPublicInputs as (f: string[]) => unknown)(fields)).toThrow(/circuit id is required/i);
  });

  it.each([['coinbase-kyc'], ['solana_thing'], ['arc_eligibility'], [''], ['__proto__']])('refuses unknown circuit %j, naming it', id => {
    const fields = fieldsWith({}, 133);
    expect(() => extractScopeFromPublicInputs(fields, id)).toThrow(`Unknown circuit '${id}'`);
    expect(() => extractNullifierFromPublicInputs(fields, id)).toThrow(`Unknown circuit '${id}'`);
    expect(() => extractOprfKeyHashFromPublicInputs(fields, id)).toThrow(`Unknown circuit '${id}'`);
    expect(() => readOprfPublicInputs(id, fields)).toThrow(`Unknown circuit '${id}'`);
  });

  it('an earlier Coinbase KYC shape is refused by name; a short array reads as null', () => {
    const old = fieldsWith({}, 128);
    expect(extractNullifierFromPublicInputs(old.slice(0, 100), 'coinbase_attestation')).toBeNull();
    expect(() => readOprfPublicInputs('coinbase_attestation', old)).toThrow(/Coinbase KYC v1 proof made before the OPRF nullifier \(128 public inputs\)/);
    expect(() => readOprfPublicInputs('coinbase_attestation', fieldsWith({}, 193))).toThrow(/Coinbase KYC v2 proof made before the OPRF nullifier/);
    expect(() => readOprfPublicInputs('coinbase_attestation', fieldsWith({}, 134))).toThrow('A coinbase_attestation proof has 133 public inputs; got 134.');
  });

  it.each([
    ['p', '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001'],
    ['2^256 - 1', '0x' + 'ff'.repeat(32)],
  ])('refuses a Field at or above the modulus (%s), never reducing it', (_label, value) => {
    const fields = fieldsWith({ 130: value }, 133);
    expect(() => extractScopeFromPublicInputs(fields, 'coinbase_attestation')).toThrow(/not below the field modulus/);
    expect(() => readOprfPublicInputs('coinbase_attestation', fields)).toThrow(/Public input 130 \(scope\) is not below the field modulus/);
  });

  it('accepts p - 1, the largest Field', () => {
    const pMinus1 = '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000';
    expect(extractScopeFromPublicInputs(fieldsWith({ 130: pMinus1 }, 133), 'coinbase_attestation')).toBe(pMinus1);
  });

  it.each([['zz'], [''], ['-1'], ['<script>'], ['%_\\'], ['0x😀']])('refuses a non-number Field %j', value => {
    const fields = fieldsWith({ 131: value }, 133);
    expect(() => extractNullifierFromPublicInputs(fields, 'coinbase_attestation')).toThrow(/Public input 131 \(nullifier\) is not a number/);
  });
});

describe('a real Dojang Playground v2 proof (fixtures/dojangPlaygroundPublicInputs.json)', () => {
  it('carries the fixture key hash, the domain and scope reduced mod p, and the nullifier core recomputes', () => {
    // Recomputed here, with core's own client, from what the circuits fixture
    // generator used (scripts/coinbase-attestation-v2/generate-prover-toml.js,
    // SCOPE_STRING 'proofport'): the Playground wallet, keccak256 mod p of the
    // two strings, and the circuits' public test key for dojang_playground
    // (oprf.js fixtureKey). A wrong offset reads values that cannot match by accident.
    const fields = dojangProof.publicInputs;
    expect(fields).toHaveLength(101);
    const read = readOprfPublicInputs('dojang_playground', fields);
    const fixture = vectors.evaluations.find(e => e.note === 'circuits fixture key for dojang_playground (oprf.js fixtureKey)')!;
    expect(read.oprfKeyHash).toBe(fixture.keyHash);
    expect(read.domain).toBe(reduceOprfName('zkproofport.app'));
    expect(read.scope).toBe(reduceOprfName('proofport'));
    const query = oprfQuery({ address: '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c', domain: read.domain, scope: read.scope });
    const p = scalarMul(encodeToCurve(BigInt(query)), BigInt(fixture.secretKey));
    expect(f(poseidon2T4([OPRF_DS_OUT, BigInt(query), p.x, p.y])[1])).toBe(read.nullifier);
    expect(extractNullifierFromPublicInputs(fields, 'dojang_playground')).toBe(read.nullifier);
    // GIWA's offsets on the same proof run off its end.
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).toBeNull();
    // attested_at, last: the time the fixture generator signed the statement.
    expect(BigInt(fields[DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT]) > 1_700_000_000n).toBe(true);
  });
});
