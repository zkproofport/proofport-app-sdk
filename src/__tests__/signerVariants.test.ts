/**
 * One circuit id, more than one package: `oidc_domain_attestation` and
 * `coinbase_attestation` are also proved by an Android-signer package with the
 * same public inputs and a different verification key. A proof's result says
 * which (`signerVariant`); a result without it is the standard package, unless
 * the proof has the other package's length.
 *
 * Matrix written before the code:
 *   table      every circuit has `standard`; only the two have `android`; the
 *              vk paths agree with CIRCUIT_VK_PATHS; every row of a
 *              multi-package circuit has a size; the generator's script map
 *              and core's table name the same scripts.
 *   lookups    unknown circuit, unknown variant ('', case, whitespace,
 *              '__proto__', 'ios'), a variant the circuit has no package for.
 *   length     19/20/21 match the measured proofs; 0, 29, 1.5, NaN throw.
 *   resolve    missing / null field with each length; each claimed variant
 *              with each length; non-string claims; non-hex and odd hex; a
 *              single-package circuit ignores length; with and without 0x.
 *   verify     on-chain (core and SDK) and off-chain refuse before any
 *              contract call, key fetch or Barretenberg load; an android
 *              claim finds no pinned verifier in this table and says so; a
 *              configured verifier refuses an android proof; off-chain fetches
 *              the android package's key; the callback URL keeps the field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_PACKAGES,
  CIRCUIT_VK_PATHS,
  PINNED_VARIANT_VERIFIERS,
  SIGNER_VARIANTS,
  VERIFIER_ABI,
  evmProofByteLength,
  getCircuitPackage,
  getPinnedVariantVerifier,
  getPinnedVerifier,
  isSignerVariant,
  resolveSignerVariant,
  signerVariantsOf,
  verifyProofOnChain,
} from '../verifier';
import { verifyProofOffChain, clearVerificationKeyCache } from '../offChainVerifier';
import { parseProofResponseUrl } from '../deeplink';
import type { ProofResponse } from '../types';
// @ts-ignore -- a plain .mjs module shared with the generator script
import { VERIFIER_BY_SCRIPT, NOT_PINNED_HERE } from '../../scripts/pinned-verifier-scripts.mjs';
import { attestationInputs } from './helpers/signerFixtures';

const bbLoaded = vi.fn();
vi.mock('@aztec/bb.js', () => {
  bbLoaded();
  return {
    Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
    UltraHonkVerifierBackend: vi.fn(function (this: any) {
      this.verifyProof = vi.fn(async () => true);
    }),
  };
});

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const proofOf = (bytes: number) => '0x' + 'ab'.repeat(bytes);
const STANDARD_OIDC = 10304;
const ANDROID = 10688;
const STANDARD_KYC = 9920;

beforeEach(() => {
  Contract.mockClear();
  bbLoaded.mockClear();
  clearVerificationKeyCache();
  global.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the package table', () => {
  it('every circuit has a standard package; only OIDC and Coinbase KYC have an android one', () => {
    for (const id of ALL_CIRCUIT_IDS) expect(signerVariantsOf(id)[0]).toBe('standard');
    expect(ALL_CIRCUIT_IDS.filter(id => signerVariantsOf(id).includes('android'))).toEqual([
      'coinbase_attestation',
      'oidc_domain_attestation',
    ]);
  });

  it('names the android packages the circuits repository builds and deploys', () => {
    expect(getCircuitPackage('oidc_domain_attestation', 'android')).toEqual({
      packageDir: 'oidc-domain-attestation-android',
      vkPath: 'oidc-domain-attestation-android/target/vk/vk',
      deployScriptName: 'OidcDomainAttestationAndroid',
      logCircuitSize: 21,
    });
    expect(getCircuitPackage('coinbase_attestation', 'android')).toEqual({
      packageDir: 'coinbase-attestation-v2-android',
      vkPath: 'coinbase-attestation-v2-android/target/vk/vk',
      deployScriptName: 'CoinbaseAttestationV2Android',
      logCircuitSize: 21,
    });
  });

  it('CIRCUIT_VK_PATHS is the standard package key path, for every circuit', () => {
    for (const id of ALL_CIRCUIT_IDS) expect(CIRCUIT_VK_PATHS[id]).toBe(getCircuitPackage(id, 'standard').vkPath);
    expect(CIRCUIT_VK_PATHS.oidc_domain_attestation).toBe('oidc-domain-attestation/target/vk/vk');
  });

  it('every package of a multi-package circuit has a size, so lengths can tell them apart', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      const variants = signerVariantsOf(id);
      if (variants.length < 2) continue;
      const lengths = variants.map(v => evmProofByteLength(getCircuitPackage(id, v).logCircuitSize!));
      expect(new Set(lengths).size, id).toBe(variants.length);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CIRCUIT_PACKAGES)).toBe(true);
    expect(Object.isFrozen(CIRCUIT_PACKAGES.oidc_domain_attestation)).toBe(true);
    expect(Object.isFrozen(CIRCUIT_PACKAGES.oidc_domain_attestation.android)).toBe(true);
  });

  it("the generator's script map and core's table name the same scripts, both directions", () => {
    const map = VERIFIER_BY_SCRIPT as Record<string, { circuit: string; variant: string }>;
    for (const id of ALL_CIRCUIT_IDS) {
      for (const variant of signerVariantsOf(id)) {
        const script = getCircuitPackage(id, variant).deployScriptName;
        if ((NOT_PINNED_HERE as Set<string>).has(script)) {
          expect(map[script], script).toBeUndefined();
          continue;
        }
        expect(map[script], `${id} ${variant}`).toEqual({ circuit: id, variant });
      }
    }
    for (const [script, { circuit, variant }] of Object.entries(map)) {
      expect(getCircuitPackage(circuit, variant).deployScriptName).toBe(script);
    }
  });

  it('the Coinbase KYC android package waits for the release that reads the v2 layout', () => {
    expect((NOT_PINNED_HERE as Set<string>).has('CoinbaseAttestationV2Android')).toBe(true);
    expect(PINNED_VARIANT_VERIFIERS.android.coinbase_attestation).toBeUndefined();
  });
});

describe('lookups end at an error naming the key', () => {
  it.each([['nope'], ['coinbase-kyc'], [''], ['__proto__']])('unknown circuit %j', circuit => {
    expect(() => signerVariantsOf(circuit)).toThrow(`Unknown circuit '${circuit}'. Known: `);
    expect(() => getCircuitPackage(circuit, 'standard')).toThrow(`Unknown circuit '${circuit}'`);
    expect(() => getPinnedVariantVerifier(circuit, 'android', 84532)).toThrow(`Unknown circuit '${circuit}'`);
  });

  it.each([['ios'], [''], ['Android'], [' android'], ['__proto__'], ['constructor']])('unknown variant %j', variant => {
    expect(() => getCircuitPackage('oidc_domain_attestation', variant)).toThrow(
      `Circuit 'oidc_domain_attestation' has no '${variant}' signer variant. Known for oidc_domain_attestation: standard, android.`,
    );
    expect(() => getPinnedVariantVerifier('oidc_domain_attestation', variant, 84532)).toThrow(/has no .* signer variant/);
  });

  it('a variant the circuit has no package for names the ones it has', () => {
    expect(() => getCircuitPackage('coinbase_country_attestation', 'android')).toThrow(
      "Circuit 'coinbase_country_attestation' has no 'android' signer variant. Known for coinbase_country_attestation: standard.",
    );
  });

  it('isSignerVariant', () => {
    expect(SIGNER_VARIANTS).toEqual(['standard', 'android']);
    expect(isSignerVariant('android')).toBe(true);
    for (const v of ['ANDROID', '', null, undefined, 1, {}]) expect(isSignerVariant(v)).toBe(false);
  });

  it('the variant-aware getter requires the variant and agrees with the standard one', () => {
    expect(getPinnedVariantVerifier('coinbase_attestation', 'standard', 84532)).toBe(getPinnedVerifier('coinbase_attestation', 84532));
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'standard', 1234)).toThrow(
      /No coinbase_attestation verifier is deployed on chain 1234/,
    );
  });

  it('an android package with nothing deployed says so, per chain', () => {
    expect(() => getPinnedVariantVerifier('oidc_domain_attestation', 'android', 84532)).toThrow(
      "No oidc_domain_attestation verifier for the 'android' signer is deployed on chain 84532. It has no verifier deployed on any chain.",
    );
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'android', 84532)).toThrow(
      "No coinbase_attestation verifier for the 'android' signer is deployed on chain 84532.",
    );
  });
});

describe('evmProofByteLength', () => {
  it('matches the measured proofs: 9920 bytes at 2^19, 10304 at 2^20; 10688 at 2^21', () => {
    expect(evmProofByteLength(19)).toBe(9920);
    expect(evmProofByteLength(20)).toBe(10304);
    expect(evmProofByteLength(21)).toBe(10688);
  });

  it.each([[0], [29], [1.5], [Number.NaN], [-1]])('refuses %s', n => {
    expect(() => evmProofByteLength(n)).toThrow(/logCircuitSize must be an integer/);
  });
});

describe('resolveSignerVariant', () => {
  it.each([
    ['missing field, standard length', undefined, STANDARD_OIDC, 'standard'],
    ['null field, standard length', null, STANDARD_OIDC, 'standard'],
    ['missing field, any other length', undefined, 64, 'standard'],
    ['standard claim, standard length', 'standard', STANDARD_OIDC, 'standard'],
    ['android claim, android length', 'android', ANDROID, 'android'],
    ['android claim, a third length', 'android', 64, 'android'],
  ])('oidc: %s', (_name, claimed, bytes, variant) => {
    expect(resolveSignerVariant('oidc_domain_attestation', claimed, proofOf(bytes))).toEqual({ variant });
  });

  it('a missing field with the android length is refused, naming both', () => {
    const r = resolveSignerVariant('oidc_domain_attestation', undefined, proofOf(ANDROID));
    expect(r).toEqual({
      error:
        "This oidc_domain_attestation proof is 10688 bytes, the length of a 'android' proof, but its result does not say which signer made it. " +
        "Refusing rather than checking it against the 'standard' verifier. Pass the result's signerVariant through unchanged.",
    });
  });

  it('an android claim with the standard length is refused', () => {
    const r = resolveSignerVariant('oidc_domain_attestation', 'android', proofOf(STANDARD_OIDC));
    expect(r).toEqual({ error: expect.stringMatching(/is 10304 bytes, the length of a 'standard' proof, but its result says signerVariant 'android'/) });
  });

  it('a standard claim with the android length is refused', () => {
    expect('error' in resolveSignerVariant('oidc_domain_attestation', 'standard', proofOf(ANDROID))).toBe(true);
  });

  it('Coinbase KYC: its standard package is 2^19, its android one 2^21', () => {
    expect(resolveSignerVariant('coinbase_attestation', undefined, proofOf(STANDARD_KYC))).toEqual({ variant: 'standard' });
    expect('error' in resolveSignerVariant('coinbase_attestation', undefined, proofOf(ANDROID))).toBe(true);
    expect('error' in resolveSignerVariant('coinbase_attestation', 'android', proofOf(STANDARD_KYC))).toBe(true);
  });

  it('reads the length with or without 0x, in either case', () => {
    expect('error' in resolveSignerVariant('oidc_domain_attestation', undefined, 'AB'.repeat(ANDROID))).toBe(true);
    expect('error' in resolveSignerVariant('oidc_domain_attestation', undefined, '0X' + 'ab'.repeat(ANDROID))).toBe(true);
  });

  it('a single-package circuit has nothing to tell apart and ignores the length', () => {
    expect(resolveSignerVariant('coinbase_country_attestation', undefined, proofOf(ANDROID))).toEqual({ variant: 'standard' });
    expect(resolveSignerVariant('giwa_attestation', 'standard', 'not hex')).toEqual({ variant: 'standard' });
  });

  it.each([['ios'], [''], ['Android'], [42], [true], [{}], [['android']]])('refuses the claim %j by name', claimed => {
    const r = resolveSignerVariant('oidc_domain_attestation', claimed, proofOf(STANDARD_OIDC));
    expect(r).toEqual({ error: `Circuit 'oidc_domain_attestation' has no ${JSON.stringify(claimed)} signer variant. Known for oidc_domain_attestation: standard, android.` });
  });

  it('refuses an android claim for a circuit without that package', () => {
    expect(resolveSignerVariant('mdl_kr_age', 'android', proofOf(64))).toEqual({
      error: `Circuit 'mdl_kr_age' has no "android" signer variant. Known for mdl_kr_age: standard.`,
    });
  });

  it.each([['0x' + 'a'.repeat(21)], ['0xzz'], ['<script>'], ['0x 1']])('refuses a proof that is not hex bytes (%j)', proof => {
    expect(resolveSignerVariant('oidc_domain_attestation', undefined, proof)).toEqual({
      error: 'The oidc_domain_attestation proof is not hex bytes, so its length cannot say which package made it.',
    });
  });

  it('an empty proof has no other package length; the verifier refuses it', () => {
    expect(resolveSignerVariant('oidc_domain_attestation', undefined, '0x')).toEqual({ variant: 'standard' });
  });

  it('names an unknown circuit', () => {
    expect(resolveSignerVariant('arc_eligibility', undefined, proofOf(64))).toEqual({ error: expect.stringContaining("Unknown circuit 'arc_eligibility'") });
  });
});

describe('every verify path applies it before anything else runs', () => {
  const kyc = attestationInputs('coinbase_attestation');
  const parsed = (bytes: number) => ({ proofHex: proofOf(bytes), publicInputsHex: kyc, numPublicInputs: 128 });
  const response = (over: Partial<ProofResponse> = {}): ProofResponse => ({
    requestId: 'r1',
    circuit: 'coinbase_attestation',
    status: 'completed',
    proof: proofOf(STANDARD_KYC),
    publicInputs: kyc,
    ...over,
  });

  it('core on-chain: a standard proof without the field verifies on the standard pinned contract', async () => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(STANDARD_KYC), {}, { chainId: 84532 });
    expect(r).toEqual({ valid: true });
    expect(String(Contract.mock.calls[0][0]).toLowerCase()).toBe(getPinnedVerifier('coinbase_attestation', 84532).address);
  });

  it('core on-chain: the android length without the field is refused, no contract called', async () => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(ANDROID), {}, { chainId: 84532 });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/does not say which signer made it/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('core on-chain: an android claim with the standard length is refused', async () => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(STANDARD_KYC), {}, { chainId: 84532 }, undefined, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/the length of a 'standard' proof/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('core on-chain: an android proof with nothing pinned names the missing deployment', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', { ...parsed(ANDROID), publicInputsHex: [] }, {}, { chainId: 84532 }, undefined, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: "No oidc_domain_attestation verifier for the 'android' signer is deployed on chain 84532. It has no verifier deployed on any chain." });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('core on-chain: a configured verifier is never asked about an android proof', async () => {
    const configured = { address: '0x1111111111111111111111111111111111111111', chainId: 84532, abi: VERIFIER_ABI };
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(ANDROID), {}, configured, undefined, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/made by the 'android' signer's package, whose verification key differs from the configured verifier's/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('core on-chain: an unknown variant is refused by name', async () => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(STANDARD_KYC), {}, { chainId: 84532 }, undefined, { signerVariant: 'ios' });
    expect(r).toEqual({ valid: false, error: expect.stringContaining(`has no "ios" signer variant`) });
  });

  it('SDK verifyResponseOnChain passes the response field through', async () => {
    const sdk = ProofportSDK.create('staging');
    expect(await sdk.verifyResponseOnChain(response(), {})).toEqual({ valid: true });
    const missing = await sdk.verifyResponseOnChain(response({ proof: proofOf(ANDROID) }), {});
    expect(missing).toEqual({ valid: false, error: expect.stringMatching(/does not say which signer made it/) });
    const claimed = await sdk.verifyResponseOnChain(response({ proof: proofOf(ANDROID), signerVariant: 'android' }), {});
    expect(claimed).toEqual({ valid: false, error: "No coinbase_attestation verifier for the 'android' signer is deployed on chain 84532. It has no verifier deployed on any chain." });
    expect(Contract).toHaveBeenCalledTimes(1);
  });

  it('SDK verifyOnChain takes the variant as an option', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyOnChain('coinbase_attestation', proofOf(STANDARD_KYC), kyc, {}, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/the length of a 'standard' proof/) });
  });

  it('off-chain: refused before the key fetch and before Barretenberg loads', async () => {
    const r = await verifyProofOffChain('coinbase_attestation', proofOf(ANDROID), kyc);
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/does not say which signer made it/) });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(bbLoaded).not.toHaveBeenCalled();
  });

  it("off-chain: an android proof is checked against the android package's key", async () => {
    // A Coinbase KYC android proof carries the v2 layout, which this core
    // refuses by count; a v1-shaped input list gets past that to the fetch.
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(1888).buffer };
    }) as unknown as typeof fetch;
    const r = await verifyProofOffChain('coinbase_attestation', proofOf(ANDROID), kyc, { signerVariant: 'android' });
    expect(r).toEqual({ valid: true });
    expect(urls).toEqual(['https://raw.githubusercontent.com/zkproofport/circuits/main/coinbase-attestation-v2-android/target/vk/vk']);
    await verifyProofOffChain('coinbase_attestation', proofOf(STANDARD_KYC), kyc);
    expect(urls[1]).toBe('https://raw.githubusercontent.com/zkproofport/circuits/main/coinbase-attestation/target/vk/vk');
  });

  it('SDK verifyResponseOffChain passes the response field through', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOffChain(response({ signerVariant: 'android' }));
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/the length of a 'standard' proof/) });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the callback URL', () => {
  const base = 'https://dapp.example/cb?requestId=r1&status=completed&circuit=oidc_domain_attestation&proof=0xab&publicInputs=0x01';

  it('keeps signerVariant', () => {
    expect(parseProofResponseUrl(`${base}&signerVariant=android`)?.signerVariant).toBe('android');
  });

  it('keeps an unknown value as sent, for verification to refuse by name', () => {
    expect(parseProofResponseUrl(`${base}&signerVariant=%3Cscript%3E`)?.signerVariant).toBe('<script>');
  });

  it('leaves it out when absent', () => {
    expect(parseProofResponseUrl(base)).not.toHaveProperty('signerVariant');
  });
});
