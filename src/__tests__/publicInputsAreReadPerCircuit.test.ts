/**
 * Reading a proof's scope and nullifier requires knowing which circuit made it.
 *
 * These two functions used to be an `if / else if / else` chain whose final
 * `else` handed Coinbase's byte offsets to every unrecognised circuit — and to
 * every call that named no circuit at all, which is what OpenStoa's AI login
 * route does. The values that came back were the right shape, the right
 * length, and the wrong bytes.
 *
 * For `arc_eligibility` it is not a near miss. Its public inputs are
 * signal_hash, domain_separator, action_hash, signer_list_merkle_root, scope,
 * nullifier — so under Coinbase's offsets the nullifier slot holds the MERKLE
 * ROOT, a value identical for every user of the circuit. Anything counting
 * distinct people would have counted one.
 */
import { describe, it, expect } from 'vitest';
import {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
} from '../verifier';
import { ALL_CIRCUIT_IDS } from '../circuits';

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
  it('reads Arc at its own offsets, not Coinbase’s', () => {
    // Arc: scope at [128..159], nullifier at [160..191].
    const fields = fieldsWith({
      ...block(96, 0xee), // signer_list_merkle_root — what the old else returned
      ...block(128, 0xaa),
      ...block(160, 0xbb),
    });
    expect(extractScopeFromPublicInputs(fields, 'arc_eligibility')).toBe('0x' + 'aa'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'arc_eligibility')).toBe('0x' + 'bb'.repeat(32));
    // The old behaviour, spelled out so its return value is visibly wrong.
    expect(extractNullifierFromPublicInputs(fields, 'coinbase_attestation')).toBe('0x' + 'ee'.repeat(32));
  });

  it('reads Coinbase and OIDC at their own offsets', () => {
    const coinbase = fieldsWith({ ...block(64, 0x11), ...block(96, 0x22) });
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

  it('has offsets for every circuit the SDK knows', () => {
    const fields = fieldsWith({});
    for (const id of ALL_CIRCUIT_IDS) {
      expect(() => extractScopeFromPublicInputs(fields, id)).not.toThrow();
      expect(() => extractNullifierFromPublicInputs(fields, id)).not.toThrow();
    }
  });

  it('reads Coinbase at signal_hash, merkle root, scope, nullifier', () => {
    const fields = fieldsWith({ ...block(64, 0x55), ...block(96, 0x66) });
    expect(extractScopeFromPublicInputs(fields, 'coinbase_attestation')).toBe('0x' + '55'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'coinbase_attestation')).toBe('0x' + '66'.repeat(32));
  });

  it('reads GIWA two fields further along, because it gained the EIP-712 pair', () => {
    // GIWA and Coinbase shared a layout until GIWA gained an optional signed
    // action. Its `fn main` now reads signal_hash, domain_separator,
    // action_hash, merkle root, scope, nullifier -- Arc's order -- so scope
    // and nullifier sit at 128 and 160 rather than Coinbase's 64 and 96.
    //
    // This assertion IS the check on that move. The test it replaces pinned
    // the two circuits to one layout so that changing either would be a
    // visible decision, and this is the decision.
    const fields = fieldsWith({ ...block(128, 0x77), ...block(160, 0x88) });
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + '77'.repeat(32));
    expect(extractNullifierFromPublicInputs(fields, 'giwa_attestation')).toBe('0x' + '88'.repeat(32));
  });

  it('reads GIWA and Arc at the same offsets, which they now share', () => {
    const fields = fieldsWith({ ...block(128, 0x77), ...block(160, 0x88) });
    for (const id of ['giwa_attestation', 'arc_eligibility'] as const) {
      expect(extractScopeFromPublicInputs(fields, id)).toBe('0x' + '77'.repeat(32));
      expect(extractNullifierFromPublicInputs(fields, id)).toBe('0x' + '88'.repeat(32));
    }
  });

  it('does not read GIWA at Coinbase offsets any more', () => {
    // The failure that matters: reading a GIWA proof with the old offsets
    // returns the merkle ROOT where the nullifier should be -- a value
    // identical for every user, which duplicate detection would read as one
    // person. Same class of bug as the Arc layout mix-up.
    const fields = fieldsWith({ ...block(64, 0x55), ...block(128, 0x77), ...block(160, 0x88) });
    expect(extractScopeFromPublicInputs(fields, 'giwa_attestation')).not.toBe('0x' + '55'.repeat(32));
  });
});
