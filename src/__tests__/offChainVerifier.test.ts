/**
 * Off-chain verification, against a REAL proof produced by the pinned bb.
 *
 * WHY A REAL PROOF AND NOT A FIXTURE. The thing that can go wrong here is not
 * logic — it is that the WebAssembly Barretenberg and the verification key
 * disagree about their formats. Both are opaque byte blobs: a mismatch does not
 * throw, it returns `false`, and a mock returning `true` would sail past it
 * while the shipped code rejected every valid proof.
 *
 * So this reads what `bb prove -t evm` actually wrote for coinbase_attestation
 * (circuits/scripts/build.sh writes it; the proof directory is not committed,
 * so these cases run where the circuits have been built and skip elsewhere):
 *
 *   proof             9920 bytes, without the public inputs
 *   public_inputs     4096 bytes = 128 field elements of 32 bytes
 *   vk                1888 bytes -- the size bb 4.2.0-aztecnr-rc.2 emits; the
 *                     2025 nightly emitted 1816, which is how a stale build
 *                     shows up
 *
 * That split is also exactly what the mobile app sends through the relay, so
 * these bytes exercise the same shape a caller passes in.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { verifyProofOffChain } from '../offChainVerifier';

/** vitest runs with the SDK package root as cwd; the circuits repo is a sibling. */
const CIRCUIT_DIR = join(process.cwd(), '..', 'circuits', 'coinbase-attestation', 'target');
const PROOF_FILE = join(CIRCUIT_DIR, 'proof', 'proof');
const PUBLIC_INPUTS_FILE = join(CIRCUIT_DIR, 'proof', 'public_inputs');
const VK_FILE = join(CIRCUIT_DIR, 'vk', 'vk');

const haveArtifacts =
  existsSync(PROOF_FILE) && existsSync(PUBLIC_INPUTS_FILE) && existsSync(VK_FILE);

const toHex = (b: Uint8Array) =>
  '0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

/** The public_inputs file is field elements back to back, 32 bytes each. */
function splitPublicInputs(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) out.push(toHex(bytes.subarray(i, i + 32)));
  return out;
}

describe.skipIf(!haveArtifacts)('off-chain verification against a real proof', () => {
  let proofHex: string;
  let publicInputs: string[];
  let vk: Uint8Array;

  beforeAll(() => {
    proofHex = toHex(new Uint8Array(readFileSync(PROOF_FILE)));
    publicInputs = splitPublicInputs(new Uint8Array(readFileSync(PUBLIC_INPUTS_FILE)));
    vk = new Uint8Array(readFileSync(VK_FILE));
  });

  it('the artifacts are the shape the pinned bb produces', () => {
    // Not ceremony. If the verification key is not 1888 bytes, the circuits were
    // built with a different bb and every case below would fail for a reason
    // that has nothing to do with this file.
    expect(vk.length).toBe(1888);
    expect(publicInputs.length).toBe(128);
    expect(proofHex.length).toBeGreaterThan(1000);
  });

  it('accepts a valid proof', async () => {
    const result = await verifyProofOffChain('coinbase_attestation', proofHex, publicInputs, {
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
    // points at the front (500, say) makes bb 4.x refuse the point outright
    // ("val.on_curve()"), which is the next case.
    const bytes = new Uint8Array(readFileSync(PROOF_FILE));
    bytes[4000] = bytes[4000] ^ 0x01;

    const result = await verifyProofOffChain('coinbase_attestation', toHex(bytes), publicInputs, {
      verificationKey: vk,
    });
    // `error` must be absent: a rejection has to come from the verifier saying
    // no, not from the check failing to run. Without this the case passed while
    // Barretenberg was trapping on every input, valid ones included.
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(false);
  }, 120_000);

  it('rejects a proof whose curve point was corrupted, and says why', async () => {
    // bb 4.x does not answer false here: it rejects the point before verifying
    // and throws "Assertion failed: (val.on_curve())". The caller must still
    // get valid: false, with the reason, never an exception.
    const bytes = new Uint8Array(readFileSync(PROOF_FILE));
    bytes[500] = bytes[500] ^ 0x01;

    const result = await verifyProofOffChain('coinbase_attestation', toHex(bytes), publicInputs, {
      verificationKey: vk,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/on_curve/);
  }, 120_000);

  it('rejects a proof whose public inputs were altered', async () => {
    // The public inputs are what the proof is ABOUT — an age threshold, a
    // scope, a nullifier. Accepting a proof against different ones would let a
    // caller claim a proof said something it never said.
    const tampered = [...publicInputs];
    tampered[0] = '0x' + '11'.repeat(32);

    const result = await verifyProofOffChain('coinbase_attestation', proofHex, tampered, {
      verificationKey: vk,
    });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(false);
  }, 120_000);

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
      verificationKey: new Uint8Array(readFileSync(otherVk)),
    });
    expect(result.valid).toBe(false);
  }, 120_000);
});

describe('off-chain verification input handling', () => {
  it('reports an empty proof rather than asking Barretenberg about it', async () => {
    const result = await verifyProofOffChain('mdl_kr_age', '0x', []);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('reports malformed hex clearly', async () => {
    const result = await verifyProofOffChain('mdl_kr_age', '0xzzzz', ['0x01']);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hex/i);
  });

  it('reports an oversized public input instead of silently truncating', async () => {
    // A value longer than a field element cannot be what the circuit committed
    // to. Cutting it to fit would verify something other than what was passed.
    const result = await verifyProofOffChain('mdl_kr_age', '0x1234', ['0x' + 'aa'.repeat(33)], {
      verificationKey: new Uint8Array(1816),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most 32/);
  });
});

/**
 * The same check across every circuit that has a real proof committed.
 *
 * The cases above prove the mechanism on one circuit. This proves the mechanism
 * is not specific to it — same verification key format, same proof shape, same
 * entry point — which is the question "does off-chain verification cover every
 * circuit" actually asks.
 *
 * Proofs are not committed; these are the circuits whose build writes one
 * (build.sh with a Prover.toml). The Korea Mobile ID circuits prove through
 * their own acceptance hook, so a proof left on disk there may come from an
 * older toolchain -- they are left out rather than tested against the wrong
 * key. OIDC has no committed witness. Those go through the identical code
 * path but are NOT exercised end to end here.
 */
const CIRCUITS_WITH_COMMITTED_PROOFS = [
  {circuit: 'coinbase_attestation' as const, dir: ['coinbase-attestation']},
  {circuit: 'coinbase_country_attestation' as const, dir: ['coinbase-country-attestation']},
  {circuit: 'giwa_attestation' as const, dir: ['giwa-attestation']},
  {circuit: 'dojang_playground' as const, dir: ['dojang-playground']},
];

describe.each(CIRCUITS_WITH_COMMITTED_PROOFS)(
  'off-chain verification for $circuit',
  ({circuit, dir}) => {
    const target = join(process.cwd(), '..', 'circuits', ...dir, 'target');
    const proofFile = join(target, 'proof', 'proof');
    const inputsFile = join(target, 'proof', 'public_inputs');
    const keyFile = join(target, 'vk', 'vk');
    const present = existsSync(proofFile) && existsSync(inputsFile) && existsSync(keyFile);

    it.skipIf(!present)('accepts its own proof', async () => {
      const result = await verifyProofOffChain(
        circuit,
        toHex(new Uint8Array(readFileSync(proofFile))),
        splitPublicInputs(new Uint8Array(readFileSync(inputsFile))),
        {verificationKey: new Uint8Array(readFileSync(keyFile))},
      );
      expect(result.error).toBeUndefined();
      expect(result.valid).toBe(true);
    }, 120_000);

    it.skipIf(!present)('rejects another circuit\'s proof against its key', async () => {
      // Each key must reject a proof it did not sign. Without this, a verifier
      // that ignored the key would pass every case above.
      const other = CIRCUITS_WITH_COMMITTED_PROOFS.find(c => c.circuit !== circuit)!;
      const otherProof = join(process.cwd(), '..', 'circuits', ...other.dir, 'target', 'proof');
      if (!existsSync(join(otherProof, 'proof'))) return;

      const result = await verifyProofOffChain(
        circuit,
        toHex(new Uint8Array(readFileSync(join(otherProof, 'proof')))),
        splitPublicInputs(new Uint8Array(readFileSync(join(otherProof, 'public_inputs')))),
        {verificationKey: new Uint8Array(readFileSync(keyFile))},
      );
      expect(result.valid).toBe(false);
    }, 120_000);
  },
);
