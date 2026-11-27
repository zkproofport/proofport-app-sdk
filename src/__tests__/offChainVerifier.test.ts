/**
 * Off-chain verification, against a REAL proof produced by the pinned bb.
 *
 * WHY A REAL PROOF AND NOT A FIXTURE. The thing that can go wrong here is not
 * logic — it is that the WebAssembly Barretenberg and the verification key
 * disagree about their formats. Both are opaque byte blobs: a mismatch does not
 * throw, it returns `false`, and a mock returning `true` would sail past it
 * while the shipped code rejected every valid proof.
 *
 * So this reads what `bb prove -t evm` actually wrote for Coinbase KYC v2,
 * committed as fixtures/coinbaseKycV2SyntheticAnchors.json: the circuit's own
 * source built with a synthetic Apple root and server key (no fixture can hold
 * an Apple-signed credential for our App ID), so it verifies against the vk
 * in the same file and against no deployed verifier:
 *
 *   proof             10304 bytes (2^20), without the public inputs
 *   public_inputs     133 field elements of 32 bytes
 *   vk                1888 bytes -- the size bb 6.0.0 emits, as did
 *                     4.2.0-aztecnr-rc.2; the 2025 nightly emitted 1816, so
 *                     the size alone does not tell bb 4.2 from bb 6 (the
 *                     fixture's `source` names the bb, and
 *                     scripts/export-proof-fixtures.mjs refuses a proof the
 *                     bundled bb.js does not accept)
 *
 * That split is also exactly what the mobile app sends through the relay, so
 * these bytes exercise the same shape a caller passes in. The proof's
 * attested_at is fixed, so each case sets the clock just after it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { verifyProofOffChain } from '../offChainVerifier';
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT,
  GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT,
} from '../verifier';
import { OPRF_TEST_ENVIRONMENT } from './helpers/oprfKeys';
import { dojangInputs as dojangInputsAt } from './helpers/signerFixtures';

// The real proofs' OPRF answers come from the circuits' per-circuit test keys;
// staging stands in for them here (helpers/oprfKeys.ts).
vi.mock('../../packages/core/src/oprfKeyHashes', async importOriginal => {
  const { withFixtureOprfKeys } = await import('./helpers/oprfKeys');
  return withFixtureOprfKeys(await importOriginal());
});
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'coinbaseKycV2SyntheticAnchors.json'), 'utf8'),
) as { proof: string; publicInputs: string[]; vk: string };
const fromHex = (h: string) => new Uint8Array(Buffer.from(h.slice(2), 'hex'));
const ATTESTED_AT_MS = Number(BigInt(FIXTURE.publicInputs[COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT])) * 1000;

const toHex = (b: Uint8Array) =>
  '0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');


describe('off-chain verification against a real proof', () => {
  let proofHex: string;
  let publicInputs: string[];
  let vk: Uint8Array;

  beforeAll(() => {
    proofHex = FIXTURE.proof;
    publicInputs = [...FIXTURE.publicInputs];
    vk = fromHex(FIXTURE.vk);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ATTESTED_AT_MS + 60_000);
  });
  afterEach(() => vi.useRealTimers());

  it('the artifacts are the shape the pinned bb produces', () => {
    // Not ceremony. If the verification key is not 1888 bytes, the circuits were
    // built with a different bb and every case below would fail for a reason
    // that has nothing to do with this file.
    expect(vk.length).toBe(1888);
    expect(publicInputs.length).toBe(133);
    expect((proofHex.length - 2) / 2).toBe(10304);
  });

  it('accepts a valid proof', async () => {
    const result = await verifyProofOffChain('coinbase_attestation', proofHex, publicInputs, {
      ...ENV,
      verificationKey: vk,
    });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(true);
  }, 120_000);

  it('rejects a proof with one byte changed', async () => {
    // The case that makes the one above mean something. A verifier that
    // returned true unconditionally would pass every other test in this file.
    //
    // Byte 4000 sits in the sumcheck scalars. A byte inside one of the curve
    // points at the front (500, say) makes Barretenberg refuse the point
    // outright, which is the next case.
    const bytes = fromHex(FIXTURE.proof);
    bytes[4000] = bytes[4000] ^ 0x01;

    const result = await verifyProofOffChain('coinbase_attestation', toHex(bytes), publicInputs, {
      ...ENV,
      verificationKey: vk,
    });
    // `error` must be absent: a rejection has to come from the verifier saying
    // no, not from the check failing to run. Without this the case passed while
    // Barretenberg was trapping on every input, valid ones included.
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(false);
  }, 120_000);

  it('rejects a proof whose curve point was corrupted, and says why', async () => {
    // Barretenberg does not answer false here: it rejects the point before
    // verifying and throws -- "Deserialized point is not on the curve" in bb 6
    // ("Assertion failed: (val.on_curve())" in bb 4.x). The caller must still
    // get valid: false, with the reason, never an exception.
    const bytes = fromHex(FIXTURE.proof);
    bytes[500] = bytes[500] ^ 0x01;

    const result = await verifyProofOffChain('coinbase_attestation', toHex(bytes), publicInputs, {
      ...ENV,
      verificationKey: vk,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not on the curve/);
  }, 120_000);

  it('rejects a proof whose public inputs were altered', async () => {
    // The public inputs are what the proof is ABOUT — an age threshold, a
    // scope, a nullifier. Accepting a proof against different ones would let a
    // caller claim a proof said something it never said.
    const tampered = [...publicInputs];
    tampered[0] = '0x' + '11'.repeat(32);

    const result = await verifyProofOffChain('coinbase_attestation', proofHex, tampered, {
      ...ENV,
      verificationKey: vk,
    });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(false);
  }, 120_000);

  it.each([
    [68, /Coinbase KYC v1 proof \(68 public inputs\)/],
    [128, /Coinbase KYC v1 proof made before the OPRF nullifier \(128 public inputs\)/],
    [193, /Coinbase KYC v2 proof made before the OPRF nullifier .*\(193 public inputs\)/],
  ])('refuses an earlier Coinbase KYC shape (%i public inputs) by name', async (n, message) => {
    const old = Array.from({ length: n }, () => '0x' + '00'.repeat(32));
    const result = await verifyProofOffChain('coinbase_attestation', proofHex, old, { ...ENV, verificationKey: vk });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(message);
  });

  it('refuses the same proof once its attested_at is older than 15 minutes', async () => {
    vi.setSystemTime(ATTESTED_AT_MS + 15 * 60_000 + 1_000);
    const result = await verifyProofOffChain('coinbase_attestation', proofHex, publicInputs, { ...ENV, verificationKey: vk });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/attested_at .* behind this verifier's clock/);
  });

  it('refuses it when attested_at is more than 5 minutes ahead of the clock', async () => {
    vi.setSystemTime(ATTESTED_AT_MS - 5 * 60_000 - 1_000);
    const result = await verifyProofOffChain('coinbase_attestation', proofHex, publicInputs, { ...ENV, verificationKey: vk });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/ahead of this verifier's clock/);
  });

  // NOT COVERED HERE: the browser Buffer gap.
  //
  // bb.js's browser build converts field elements through `Buffer.alloc` and
  // `writeBigUInt64BE`; its node build does not reach that code during a
  // verification, so the failure the demo page hit — "r.writeBigUInt64BE is not
  // a function" — cannot be reproduced from Node at all. A case that crippled
  // the global Buffer was written and then deleted: removing the fix it was
  // meant to guard left it green, which is worse than having no case.
  //
  // The fix (`ensureBufferForBarretenberg`) is verified in a real browser
  // against the deployed demo, and that is the only place it can be.

  it('never says valid when checked against a different circuit key', async () => {
    // Deliberately NOT requiring a clean `false` here, unlike the cases above.
    // A key from another circuit is a caller mistake, not a verdict about this
    // proof, and Barretenberg kills the instance rather than answering — so the
    // honest requirement is the one that matters: it must never come back true.
    //
    // Spelling that out because the tempting assertion (`error` undefined, like
    // its neighbours) fails for a reason that is not a defect, and "fixing" it
    // would mean swallowing the trap and reporting a confident false.
    const otherVk = join(process.cwd(), '..', 'circuits', 'coinbase-country-attestation', 'target', 'vk', 'vk');
    if (!existsSync(otherVk)) return;

    const result = await verifyProofOffChain('coinbase_attestation', proofHex, publicInputs, {
      ...ENV,
      verificationKey: new Uint8Array(readFileSync(otherVk)),
    });
    expect(result.valid).toBe(false);
  }, 120_000);
});

// Run on dojang_playground: it has no signer root, so with its OPRF four and a
// current attested_at filled in (the only checks it has before the proof)
// these reach the input handling instead of stopping at an issuer check first.
const dojangInputs = (): string[] => dojangInputsAt();

describe('off-chain verification input handling', () => {
  it('reports an empty proof rather than asking Barretenberg about it', async () => {
    const result = await verifyProofOffChain('dojang_playground', '0x', dojangInputs(), ENV);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('reports malformed hex clearly', async () => {
    const result = await verifyProofOffChain('dojang_playground', '0xzzzz', dojangInputs(), ENV);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hex/i);
  });

  it('reports an oversized public input instead of silently truncating', async () => {
    // A value longer than a field element cannot be what the circuit committed
    // to. Cutting it to fit would verify something other than what was passed.
    const inputs = dojangInputs();
    inputs[0] = '0x' + 'aa'.repeat(33);
    const result = await verifyProofOffChain('dojang_playground', '0x1234', inputs, {
      ...ENV,
      verificationKey: new Uint8Array(1816),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most 32/);
  });
});

/**
 * The same check across the other circuits that have a real proof committed.
 *
 * The cases above prove the mechanism on one circuit. This proves the mechanism
 * is not specific to it -- same verification key format, same proof shape, same
 * entry point -- which is the question "does off-chain verification cover every
 * circuit" actually asks.
 *
 * GIWA KYC v2 and the Dojang Playground v2 (2026-11-27): their committed
 * fixtures are the synthetic-anchors twins (test Apple / server keys sign the
 * device status statement), written by scripts/export-proof-fixtures.mjs, so
 * each verifies against the vk in its own file and against no deployed
 * verifier. Coinbase Country v2 is covered from its committed fixture in
 * coinbaseCountryV2IsJudged.test.ts; OIDC has no committed witness and goes
 * through the identical code path without being exercised end to end here.
 */
const CIRCUITS_WITH_COMMITTED_PROOFS = [
  { circuit: 'giwa_attestation' as const, file: 'giwaKycV2SyntheticAnchors.json', attestedAt: GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT },
  { circuit: 'dojang_playground' as const, file: 'dojangPlaygroundPublicInputs.json', attestedAt: DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT },
];
const committed = (file: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', file), 'utf8')) as { proof: string; publicInputs: string[]; vk: string };

describe.each(CIRCUITS_WITH_COMMITTED_PROOFS)('off-chain verification for $circuit', ({ circuit, file, attestedAt }) => {
  const own = committed(file);
  const at = Number(BigInt(own.publicInputs[attestedAt])) * 1000;
  afterEach(() => vi.useRealTimers());
  const at_ = (ms: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ms);
  };

  it('accepts its own proof', async () => {
    at_(at + 60_000);
    const result = await verifyProofOffChain(circuit, own.proof, own.publicInputs, { ...ENV, verificationKey: fromHex(own.vk) });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(true);
  }, 120_000);

  it('refuses the same proof re-verified after the 900 s window, before asking Barretenberg', async () => {
    at_(at + 901_000);
    const result = await verifyProofOffChain(circuit, own.proof, own.publicInputs, { ...ENV, verificationKey: fromHex(own.vk) });
    expect(result).toEqual({ valid: false, error: expect.stringMatching(/attested_at .* is 901s behind this verifier's clock/) });
  });

  it('rejects another circuit\'s proof against its key', async () => {
    // Each key must reject a proof it did not sign. Without this, a verifier
    // that ignored the key would pass every case above.
    const other = committed(CIRCUITS_WITH_COMMITTED_PROOFS.find(c => c.circuit !== circuit)!.file);
    at_(at + 60_000);
    // This circuit's own public inputs, so the checks before the proof pass
    // and the key is what decides.
    const result = await verifyProofOffChain(circuit, other.proof, own.publicInputs, { ...ENV, verificationKey: fromHex(own.vk) });
    expect(result.valid).toBe(false);
    const againstOtherKey = await verifyProofOffChain(circuit, own.proof, own.publicInputs, { ...ENV, verificationKey: fromHex(other.vk) });
    expect(againstOtherKey.valid).toBe(false);
  }, 120_000);
});
