/**
 * Off-chain verification, against a REAL proof produced by the pinned bb.
 *
 * WHY A REAL PROOF AND NOT A FIXTURE. The thing that can go wrong here is not
 * logic — it is that the WebAssembly Barretenberg and the verification key
 * disagree about their formats. Both are opaque byte blobs: a mismatch does not
 * throw, it returns `false`, and a mock returning `true` would sail past it
 * while the shipped code rejected every valid proof.
 *
 * So this reads what `bb prove` actually wrote into the circuits repository:
 *
 *   proof            16224 bytes, without the public inputs
 *   public_inputs     2112 bytes = 66 field elements of 32 bytes
 *   vk                1816 bytes — the size the pinned bb emits; bb 0.87.0 and
 *                     1.2.0 emit 1760, which is how a version drift shows up
 *
 * That split is also exactly what the mobile app sends through the relay, so
 * these bytes exercise the same shape a caller passes in.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { verifyProofOffChain } from '../offChainVerifier';

/** vitest runs with the SDK package root as cwd; the circuits repo is a sibling. */
const CIRCUIT_DIR = join(process.cwd(), '..', 'circuits', 'mdl', 'kr-age', 'target');
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
    // Not ceremony. If the verification key is 1760 bytes, someone rebuilt the
    // circuits with a different bb and every case below would fail for a reason
    // that has nothing to do with this file.
    expect(vk.length).toBe(1816);
    expect(publicInputs.length).toBe(66);
    expect(proofHex.length).toBeGreaterThan(1000);
  });

  it('accepts a valid proof', async () => {
    const result = await verifyProofOffChain('mdl_kr_age', proofHex, publicInputs, {
      verificationKey: vk,
    });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(true);
  }, 120_000);

  it('rejects a proof with one byte changed', async () => {
    // The case that makes the one above mean something. A verifier that
    // returned true unconditionally would pass every other test in this file.
    const bytes = new Uint8Array(readFileSync(PROOF_FILE));
    bytes[500] = bytes[500] ^ 0xff;

    const result = await verifyProofOffChain('mdl_kr_age', toHex(bytes), publicInputs, {
      verificationKey: vk,
    });
    // `error` must be absent: a rejection has to come from the verifier saying
    // no, not from the check failing to run. Without this the case passed while
    // Barretenberg was trapping on every input, valid ones included.
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(false);
  }, 120_000);

  it('rejects a proof whose public inputs were altered', async () => {
    // The public inputs are what the proof is ABOUT — an age threshold, a
    // scope, a nullifier. Accepting a proof against different ones would let a
    // caller claim a proof said something it never said.
    const tampered = [...publicInputs];
    tampered[0] = '0x' + '11'.repeat(32);

    const result = await verifyProofOffChain('mdl_kr_age', proofHex, tampered, {
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
    const otherVk = join(process.cwd(), '..', 'circuits', 'mdl', 'kr-region', 'target', 'vk', 'vk');
    if (!existsSync(otherVk)) return;

    const result = await verifyProofOffChain('mdl_kr_age', proofHex, publicInputs, {
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
