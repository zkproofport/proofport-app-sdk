/**
 * Reading a proof's scope and nullifier requires knowing which circuit made it.
 *
 * These two functions used to be an `if / else if / else` chain whose final
 * `else` handed Coinbase's byte offsets to every unrecognised circuit — and to
 * every call that named no circuit at all, which is what OpenStoa's AI login
 * route does. The values that came back were the right shape, the right
 * length, and the wrong bytes.
 *
 * For `giwa_attestation` it is not a near miss. Its public inputs are
 * signal_hash, domain_separator, action_hash, signer_list_merkle_root, scope,
 * nullifier — so under Coinbase's offsets the nullifier slot holds the MERKLE
 * ROOT, a value identical for every user of the circuit. Anything counting
 * distinct people would have counted one.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
} from '../verifier';
import { ALL_CIRCUIT_IDS } from '../circuits';
import dojangProof from './fixtures/dojangPlaygroundPublicInputs.json';

/** Public inputs as the prover emits them: one field element per byte. */
function fieldsWith(marks: Record<number, number>, length = 256): string[] {
  const out = new Array<string>(length).fill('0x' + '00'.repeat(32));
  for (const [index, byte] of Object.entries(marks)) {
    out[Number(index)] = '0x' + '00'.repeat(31) + byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** A run of 32 fields all holding the same byte, starting at `start`. */
function block(start: number, byte: number): Record<number, number> {
  return Object.fromEntries(Array.from({ length: 32 }, (_, i) => [start + i, byte]));
}

describe('public inputs are read per circuit', () => {
  it('reads GIWA at its own offsets, not Coinbase’s', () => {
    // GIWA: scope at [128..159], nullifier at [160..191].
    const fields = fieldsWith({
      ...block(96, 0xee), // signer_list_merkle_root — what the old else returned
      ...block(128, 0xaa),
      ...block(160, 0xbb),
    });
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + 'aa'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + 'bb'.repeat(32));
    // v1 Coinbase's nullifier offset (96) holds GIWA's root: never read there.
    expect(extractNullifierFromPublicInputs(fields, 'giwa_attestation')).not.toBe('0x' + 'ee'.repeat(32));
  });

  it('reads Coinbase and OIDC at their own offsets', () => {
    const coinbase = fieldsWith({ ...block(128, 0x11), ...block(160, 0x22) });
    expect(extractScopeFromPublicInputs(coinbase, 'coinbase_attestation')).toBe('0x' + '11'.repeat(32));
    expect(extractNullifierFromPublicInputs(coinbase, 'coinbase_attestation')).toBe('0x' + '22'.repeat(32));

    const oidc = fieldsWith({ ...block(83, 0x33), ...block(115, 0x44) });
    expect(extractScopeFromPublicInputs(oidc, 'oidc_domain_attestation')).toBe('0x' + '33'.repeat(32));
    expect(extractNullifierFromPublicInputs(oidc, 'oidc_domain_attestation')).toBe('0x' + '44'.repeat(32));
  });

  it('refuses a call that names no circuit', () => {
    const fields = fieldsWith({});
    expect(() => extractScopeFromPublicInputs(fields)).toThrow(/circuit id is required/i);
    expect(() => extractNullifierFromPublicInputs(fields)).toThrow(/circuit id is required/i);
  });

  it('refuses a circuit it has never heard of', () => {
    const fields = fieldsWith({});
    expect(() => extractScopeFromPublicInputs(fields, 'coinbase-kyc')).toThrow(/Unknown circuit/);
    expect(() => extractNullifierFromPublicInputs(fields, 'solana_thing')).toThrow(/Unknown circuit/);
  });

  // Arc was removed from the SDK on 2026-10-13. Reading an Arc proof must be
  // refused, naming the id and the known ones -- not answered with the GIWA
  // offsets it used to share.
  it('refuses arc_eligibility, which the SDK no longer knows', () => {
    const fields = fieldsWith({ ...block(128, 0x77), ...block(160, 0x88) });
    for (const read of [extractScopeFromPublicInputs, extractNullifierFromPublicInputs]) {
      expect(() => read(fields, 'arc_eligibility')).toThrow(
        /Unknown circuit 'arc_eligibility'\. Expected one of: .*giwa_attestation/,
      );
    }
  });

  it('has offsets for every circuit the SDK knows', () => {
    const fields = fieldsWith({});
    for (const id of ALL_CIRCUIT_IDS) {
      expect(() => extractScopeFromPublicInputs(fields, id)).not.toThrow();
      expect(() => extractNullifierFromPublicInputs(fields, id)).not.toThrow();
    }
  });

  it('reads Coinbase KYC v2 after signal_hash, the EIP-712 pair and the merkle root', () => {
    // v2: signal_hash 0-31, domain_separator 32-63, action_hash 64-95, root
    // 96-127, scope 128-159, nullifier 160-191, attested_at 192. v1's scope
    // (64) is now action_hash and its nullifier (96) the merkle root.
    const fields = fieldsWith({ ...block(64, 0x44), ...block(96, 0xee), ...block(128, 0x55), ...block(160, 0x66) }, 193);
    expect(extractScopeFromPublicInputs(fields, 'coinbase_attestation')).toBe('0x' + '55'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'coinbase_attestation')).toBe('0x' + '66'.repeat(32));
    // A v1 proof (128 fields) has no bytes at v2's offsets: null, not v1's values.
    const v1 = fieldsWith({ ...block(64, 0x55), ...block(96, 0x66) }, 128);
    expect(extractScopeFromPublicInputs(v1, 'coinbase_attestation')).toBeNull();
    expect(extractNullifierFromPublicInputs(v1, 'coinbase_attestation')).toBeNull();
  });

  it('reads GIWA two fields further along, because it gained the EIP-712 pair', () => {
    // GIWA and Coinbase shared a layout until GIWA gained an optional signed
    // action. Its `fn main` now reads signal_hash, domain_separator,
    // action_hash, merkle root, scope, nullifier -- so scope
    // and nullifier sit at 128 and 160 rather than Coinbase's 64 and 96.
    //
    // This assertion IS the check on that move. The test it replaces pinned
    // the two circuits to one layout so that changing either would be a
    // visible decision, and this is the decision.
    const fields = fieldsWith({ ...block(128, 0x77), ...block(160, 0x88) });
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + '77'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + '88'.repeat(32));
  });

  it('does not read GIWA at Coinbase offsets any more', () => {
    // The failure that matters: reading a GIWA proof with the old offsets
    // returns the merkle ROOT where the nullifier should be -- a value
    // identical for every user, which duplicate detection would read as one
    // person.
    const fields = fieldsWith({ ...block(64, 0x55), ...block(128, 0x77), ...block(160, 0x88) });
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).not.toBe('0x' + '55'.repeat(32));
  });

  it('reads Dojang Playground off a real proof, not a hand-placed fixture', async () => {
    // setup.ts mocks ethers; the hashes here must be the real ones.
    const { concat, getBytes, keccak256, toUtf8Bytes } = await vi.importActual<typeof import('ethers')>('ethers');
    // The public inputs of a proof that verifies on the GIWA Sepolia verifier.
    // Scope and nullifier are recomputed here the way the circuit derives them,
    // so a wrong offset reads bytes that cannot match by accident.
    const fields = dojangProof.publicInputs;
    expect(fields).toHaveLength(160);
    const scope = keccak256(toUtf8Bytes('dojang-playground-scope'));
    const tag = keccak256(toUtf8Bytes('dojang_playground'));
    const secret = keccak256(concat([getBytes('0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c'), getBytes(tag)]));
    const nullifier = keccak256(concat([getBytes(secret), getBytes(scope)]));
    expect(extractScopeFromPublicInputs(fields, 'dojang_playground')).toBe(scope);
    expect(extractNullifierFromPublicInputs(fields, 'dojang_playground')).toBe(nullifier);
    // GIWA's offsets on the same proof run off its end: there is no merkle
    // root in this circuit, so everything sits 32 fields earlier.
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).not.toBe(scope);
  });
});
