/**
 * Off-chain, a transition means two verification keys: the current one (read
 * at the circuits commit core's generated table pins, and checked against the
 * sha256 recorded there) and the superseded one an old app's proof was made
 * with (read at the commit core's ACCEPTED_LEGACY_VERIFIERS pins). With a REAL
 * proof and its REAL key, so "accepted by the legacy key" is Barretenberg's
 * answer, not a mock's.
 *
 * A legacy key written by ANOTHER bb than the bundled bb.js is not tried:
 * bb.js 6.0.0 answers false for a bb 4.2 proof even against its own bb 4.2 key
 * (the last case below proves that on the real bb 4.2 fixture), so trying it
 * would turn "this SDK cannot check that proof" into "the proof is invalid".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { verifyProofOffChain, clearVerificationKeyCache, BB_JS_VERSION } from '../offChainVerifier';
import { COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT } from '../verifier';
import { OPRF_TEST_ENVIRONMENT } from './helpers/oprfKeys';

// The real proof's OPRF answer comes from the circuits' per-circuit test key;
// staging stands in for it here (helpers/oprfKeys.ts).
vi.mock('../../packages/core/src/oprfKeyHashes', async importOriginal => {
  const { withFixtureOprfKeys } = await import('./helpers/oprfKeys');
  return withFixtureOprfKeys(await importOriginal());
});
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };

const { legacy, CURRENT_REF, current } = vi.hoisted(() => ({
  legacy: [] as { vkRef: string; bbVersion: string }[],
  CURRENT_REF: 'b'.repeat(40),
  current: { sha256: '' },
}));
vi.mock('@zkproofport-app/core', async importOriginal => {
  const real = await importOriginal<typeof import('@zkproofport-app/core')>();
  return {
    ...real,
    getAcceptedLegacyVerifiers: vi.fn(() => legacy),
    VERIFICATION_KEYS_REF: CURRENT_REF,
    getVerificationKeyRecord: vi.fn(() => ({ sha256: current.sha256, path: 'coinbase-attestation-v2/target/vk/vk' })),
  };
});

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'coinbaseKycV2SyntheticAnchors.json'), 'utf8'),
) as { proof: string; publicInputs: string[]; vk: string };
const BB42 = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'coinbaseKycV2SyntheticAnchorsBb42.json'), 'utf8'),
) as { proof: string; publicInputs: string[]; vk: string };
const attestedAt = (inputs: string[]) => Number(BigInt(inputs[COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT])) * 1000;
const realKey = Buffer.from(FIXTURE.vk.slice(2), 'hex');
/** A different, well-formed key: the real one with a byte in its body changed. */
const otherKey = (() => {
  const k = Buffer.from(realKey);
  k[1000] ^= 0x01;
  return k;
})();
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const OLD_REF = 'c'.repeat(40);

/** The current key (at CURRENT_REF) is `currentKey`; the legacy key (at OLD_REF) is the proof's own. */
function serveKeys(currentKey: Buffer = otherKey, legacyKey: Buffer = realKey) {
  current.sha256 = sha256(currentKey);
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const body = url.includes(`/circuits/${OLD_REF}/`) ? legacyKey : url.includes(`/circuits/${CURRENT_REF}/`) ? currentKey : null;
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  });
  return fetchMock;
}

describe('off-chain verification during a transition, real proof', () => {
  beforeEach(() => {
    legacy.splice(0, legacy.length);
    clearVerificationKeyCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(attestedAt(FIXTURE.publicInputs) + 60_000);
  });
  afterEach(() => vi.useRealTimers());

  it('the current key is fetched at the pinned commit and accepts its own proof', async () => {
    const fetchMock = serveKeys(realKey);
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, ENV);
    expect(r).toEqual({ valid: true, verifiedBy: { label: 'current' } });
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      `https://raw.githubusercontent.com/zkproofport/circuits/${CURRENT_REF}/coinbase-attestation-v2/target/vk/vk`,
    ]);
  }, 180_000);

  it('a fetched key whose sha256 is not the pinned one is refused before Barretenberg sees it', async () => {
    serveKeys(realKey);
    current.sha256 = sha256(otherKey);
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, ENV);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(new RegExp(`has sha256 ${sha256(realKey)}; this SDK pins ${sha256(otherKey)}`));
  }, 180_000);

  it('a tampered proof is refused by the current key', async () => {
    serveKeys(realKey);
    const bytes = Buffer.from(FIXTURE.proof.slice(2), 'hex');
    bytes[4000] ^= 0x01;
    const r = await verifyProofOffChain('coinbase_attestation', '0x' + bytes.toString('hex'), FIXTURE.publicInputs, ENV);
    expect(r).toEqual({ valid: false });
  }, 180_000);

  it('an old-build proof fails on the current key and is accepted by the pinned legacy key', async () => {
    legacy.push({ vkRef: OLD_REF, bbVersion: BB_JS_VERSION });
    const fetchMock = serveKeys();
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, ENV);
    expect(r.valid, r.error).toBe(true);
    expect(r.verifiedBy).toEqual({ label: 'legacy', vkRef: OLD_REF });
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls[0]).toMatch(new RegExp(`/circuits/${CURRENT_REF}/coinbase-attestation-v2/target/vk/vk$`));
    expect(urls[1]).toMatch(new RegExp(`/circuits/${OLD_REF}/coinbase-attestation-v2/target/vk/vk$`));
  }, 180_000);

  it('retired: with the legacy entry gone, the same proof is refused', async () => {
    serveKeys();
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, ENV);
    expect(r.valid).toBe(false);
  }, 180_000);

  it('a legacy key written by another bb is not tried, and the refusal says why', async () => {
    legacy.push({ vkRef: OLD_REF, bbVersion: '4.2.0-aztecnr-rc.2' });
    const fetchMock = serveKeys();
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, ENV);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(
      new RegExp(`legacy @${OLD_REF}: its key was written by bb 4\\.2\\.0-aztecnr-rc\\.2; this SDK verifies off-chain with bb\\.js ${BB_JS_VERSION.replace(/\./g, '\\.')} only\\. Verify this proof on-chain`),
    );
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContainEqual(expect.stringContaining(OLD_REF));
  }, 180_000);

  it('a key the caller passes is the only one tried', async () => {
    legacy.push({ vkRef: OLD_REF, bbVersion: BB_JS_VERSION });
    const fetchMock = serveKeys();
    const r = await verifyProofOffChain('coinbase_attestation', FIXTURE.proof, FIXTURE.publicInputs, {
      ...ENV,
      verificationKey: new Uint8Array(realKey),
    });
    expect(r).toEqual({ valid: true, verifiedBy: { label: 'provided' } });
    expect(fetchMock).not.toHaveBeenCalled();
  }, 180_000);

  it('why: the bundled bb.js answers false for a real bb 4.2 proof checked against its own bb 4.2 key', async () => {
    // Asked of bb.js directly: the bb 4.2 fixture predates the OPRF nullifier
    // (193 public inputs), so every verify path now refuses it by count before
    // Barretenberg is reached. The question here is Barretenberg's answer.
    expect(BB42.publicInputs.length).toBe(193);
    const bb = await vi.importActual<typeof import('@aztec-foundation/bb.js')>('@aztec-foundation/bb.js');
    const api = await bb.Barretenberg.new({ threads: 1 });
    try {
      const ok = await new bb.UltraHonkVerifierBackend(api).verifyProof(
        {
          proof: new Uint8Array(Buffer.from(BB42.proof.slice(2), 'hex')),
          publicInputs: BB42.publicInputs,
          verificationKey: new Uint8Array(Buffer.from(BB42.vk.slice(2), 'hex')),
        },
        { verifierTarget: 'evm' },
      );
      expect(ok).toBe(false);
    } finally {
      await api.destroy();
    }
  }, 180_000);
});
