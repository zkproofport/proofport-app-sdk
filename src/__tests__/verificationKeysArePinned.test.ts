/**
 * The off-chain verifier's keys are pinned: which bb wrote them, the circuits
 * commit they are fetched at, and each key's sha256 all come from core's
 * generated table (scripts/generate-pinned-verifiers.mjs), never from a moving
 * branch.
 *
 * Matrix:
 *   versions    bundled bb.js (package.json) = BB_JS_VERSION = the bb that
 *               wrote the keys; a table from another bb refuses before any
 *               fetch or Barretenberg load
 *   table       every (circuit, variant) package has a record, its path is
 *               the package's vkPath, its sha256 is 64 lowercase hex, and it
 *               matches the key in the circuits checkout when one is present
 *   unpublished keys read from an uncommitted working tree (ref null) refuse
 *               with the key's sha256 and the way out (options.verificationKey),
 *               no fetch, no load; a provided key still verifies
 *   provided    a caller's key skips the table entirely
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { ALL_CIRCUIT_IDS, getCircuitPackage, signerVariantsOf } from '../circuits';

const bbLoaded = vi.fn();
vi.mock('@aztec-foundation/bb.js', () => {
  bbLoaded();
  return {
    Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
    UltraHonkVerifierBackend: vi.fn(function (this: { verifyProof: unknown }) {
      this.verifyProof = vi.fn(async () => true);
    }),
  };
});

const { state } = vi.hoisted(() => ({ state: { ref: null as string | null, bb: '' } }));
vi.mock('@zkproofport-app/core', async importOriginal => {
  const real = await importOriginal<typeof import('@zkproofport-app/core')>();
  state.bb = real.VERIFICATION_KEY_BB_VERSION;
  return {
    ...real,
    get VERIFICATION_KEYS_REF() {
      return state.ref;
    },
    get VERIFICATION_KEY_BB_VERSION() {
      return state.bb;
    },
  };
});

const core = await vi.importActual<typeof import('@zkproofport-app/core')>('@zkproofport-app/core');
const { verifyProofOffChain, BB_JS_VERSION, clearVerificationKeyCache } = await import('../offChainVerifier');

// dojang_playground has no issuer anchor, so these reach the key handling
// once its OPRF key hash passes (the real proof's, under the circuits' test
// key: helpers/oprfKeys.ts). 2^19 since the OPRF nullifier: 9,920-byte proofs.
vi.mock('../../packages/core/src/oprfKeyHashes', async importOriginal => {
  const { withFixtureOprfKeys } = await import('./helpers/oprfKeys');
  return withFixtureOprfKeys(await importOriginal());
});
const ENV = { oprfEnvironment: 'staging' };
const PROOF = '0x' + 'ab'.repeat(9920);
const INPUTS = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'dojangPlaygroundPublicInputs.json'), 'utf8')).publicInputs as string[];

beforeEach(() => {
  state.ref = null;
  state.bb = core.VERIFICATION_KEY_BB_VERSION;
  bbLoaded.mockClear();
  clearVerificationKeyCache();
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('versions', () => {
  it('the bundled bb.js is exactly BB_JS_VERSION, and so is the bb that wrote the keys', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.dependencies['@aztec-foundation/bb.js']).toBe(BB_JS_VERSION);
    expect(pkg.dependencies['@aztec/bb.js']).toBeUndefined();
    expect(core.VERIFICATION_KEY_BB_VERSION).toBe(BB_JS_VERSION);
  });

  it('a table written by another bb refuses before any fetch or load', async () => {
    state.ref = 'a'.repeat(40);
    state.bb = '4.2.0-aztecnr-rc.2';
    const r = await verifyProofOffChain('dojang_playground', PROOF, INPUTS, ENV);
    expect(r).toEqual({
      valid: false,
      error: `current: the dojang_playground key was written by bb 4.2.0-aztecnr-rc.2; this SDK verifies with bb.js ${BB_JS_VERSION}`,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(bbLoaded).not.toHaveBeenCalled();
  });
});

describe('the key table', () => {
  const packages = ALL_CIRCUIT_IDS.flatMap(circuit => signerVariantsOf(circuit).map(variant => [circuit, variant] as const));

  it.each(packages)('%s %s has a record naming its vkPath', (circuit, variant) => {
    const record = core.getVerificationKeyRecord(circuit, variant);
    expect(record.path).toBe(getCircuitPackage(circuit, variant).vkPath);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(packages)('%s %s matches the key in the circuits checkout, when there is one', (circuit, variant) => {
    const file = join(__dirname, '..', '..', '..', 'circuits', getCircuitPackage(circuit, variant).vkPath);
    if (!existsSync(file)) return;
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(core.getVerificationKeyRecord(circuit, variant).sha256);
  });

  it('an unknown circuit or variant is refused by name', () => {
    expect(() => core.getVerificationKeyRecord('not_a_circuit', 'standard')).toThrow(/not_a_circuit/);
    expect(() => core.getVerificationKeyRecord('dojang_playground', 'android')).toThrow(/dojang_playground/);
  });
});

describe('keys not yet published at a circuits commit', () => {
  it('refuse without a fetch or a load, naming the key and the way out', async () => {
    const r = await verifyProofOffChain('dojang_playground', PROOF, INPUTS, ENV);
    const sha = core.getVerificationKeyRecord('dojang_playground', 'standard').sha256;
    expect(r).toEqual({
      valid: false,
      error: `current: the dojang_playground 'standard' key (sha256 ${sha}) is not published at any circuits commit yet; pass it as options.verificationKey`,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(bbLoaded).not.toHaveBeenCalled();
  });

  it('a key the caller passes still verifies', async () => {
    const r = await verifyProofOffChain('dojang_playground', PROOF, INPUTS, { ...ENV, verificationKey: new Uint8Array(1888) });
    expect(r).toEqual({ valid: true, verifiedBy: { label: 'provided' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
