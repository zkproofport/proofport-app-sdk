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
 *   factory    android_factory shares android's 2^21 length: the field alone
 *              decides between them, a missing field with that length is
 *              refused, and each has its own key and pinned row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_PACKAGES,
  CIRCUIT_VK_PATHS,
  PINNED_VARIANT_VERIFIERS,
  PINNED_VERIFIERS,
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
const STANDARD_KYC = 10304;

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
  it('every circuit has a standard package; only OIDC, Coinbase KYC and Coinbase Country have the two android ones', () => {
    for (const id of ALL_CIRCUIT_IDS) expect(signerVariantsOf(id)[0]).toBe('standard');
    for (const variant of ['android', 'android_factory'] as const) {
      expect(ALL_CIRCUIT_IDS.filter(id => signerVariantsOf(id).includes(variant)), variant).toEqual([
        'coinbase_attestation',
        'coinbase_country_attestation',
        'oidc_domain_attestation',
      ]);
    }
    expect(signerVariantsOf('oidc_domain_attestation')).toEqual(['standard', 'android', 'android_factory']);
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
    expect(getCircuitPackage('coinbase_country_attestation', 'standard')).toEqual({
      packageDir: 'coinbase-country-attestation-v2',
      vkPath: 'coinbase-country-attestation-v2/target/vk/vk',
      deployScriptName: 'CoinbaseCountryAttestationV2',
      logCircuitSize: 20,
    });
    expect(getCircuitPackage('coinbase_country_attestation', 'android')).toEqual({
      packageDir: 'coinbase-country-attestation-v2-android',
      vkPath: 'coinbase-country-attestation-v2-android/target/vk/vk',
      deployScriptName: 'CoinbaseCountryAttestationV2Android',
      logCircuitSize: 21,
    });
    expect(getCircuitPackage('coinbase_country_attestation', 'android_factory')).toEqual({
      packageDir: 'coinbase-country-attestation-v2-android-factory',
      vkPath: 'coinbase-country-attestation-v2-android-factory/target/vk/vk',
      deployScriptName: 'CoinbaseCountryAttestationV2AndroidFactory',
      logCircuitSize: 21,
    });
    expect(getCircuitPackage('oidc_domain_attestation', 'android_factory')).toEqual({
      packageDir: 'oidc-domain-attestation-android-factory',
      vkPath: 'oidc-domain-attestation-android-factory/target/vk/vk',
      deployScriptName: 'OidcDomainAttestationAndroidFactory',
      logCircuitSize: 21,
    });
    expect(getCircuitPackage('coinbase_attestation', 'android_factory')).toEqual({
      packageDir: 'coinbase-attestation-v2-android-factory',
      vkPath: 'coinbase-attestation-v2-android-factory/target/vk/vk',
      deployScriptName: 'CoinbaseAttestationV2AndroidFactory',
      logCircuitSize: 21,
    });
  });

  it('CIRCUIT_VK_PATHS is the standard package key path, for every circuit', () => {
    for (const id of ALL_CIRCUIT_IDS) expect(CIRCUIT_VK_PATHS[id]).toBe(getCircuitPackage(id, 'standard').vkPath);
    expect(CIRCUIT_VK_PATHS.oidc_domain_attestation).toBe('oidc-domain-attestation/target/vk/vk');
  });

  it('every package of a multi-package circuit has a size, and the standard length is no other package\'s', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      const variants = signerVariantsOf(id);
      if (variants.length < 2) continue;
      const lengths = variants.map(v => evmProofByteLength(getCircuitPackage(id, v).logCircuitSize!));
      expect(lengths.slice(1), id).not.toContain(lengths[0]);
    }
    // Equal sizes, so only the result's field can tell these two apart.
    expect(getCircuitPackage('oidc_domain_attestation', 'android').logCircuitSize).toBe(
      getCircuitPackage('oidc_domain_attestation', 'android_factory').logCircuitSize,
    );
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

  it('Coinbase KYC v2 pins all three packages; v1 (CoinbaseAttestation) is not pinned', () => {
    expect((NOT_PINNED_HERE as Set<string>).has('CoinbaseAttestation')).toBe(true);
    expect((NOT_PINNED_HERE as Set<string>).has('CoinbaseAttestationV2')).toBe(false);
    // The mainnet contracts the circuits deployment records name (circuits
    // 1d41d85 for the standard package, da21683 for the Android ones).
    expect(getPinnedVerifier('coinbase_attestation', 8453).address).toBe('0x6fc22d3576fb70457d1529b3f70f711a3cba7a7f');
    expect(getPinnedVerifier('coinbase_attestation', 1).address).toBe('0x0e458610bd79893a0855c8f90ceded70cf7553b6');
    expect(getPinnedVerifier('coinbase_attestation', 84532).address).toBe('0x1885aa2283db21ad0fc63a2df98efe92f31908e6');
    expect(PINNED_VARIANT_VERIFIERS.android.coinbase_attestation?.[8453].address).toBe('0x836d8b0fd01bed4e34220ebcee6d63265951fbf9');
    expect(PINNED_VARIANT_VERIFIERS.android.coinbase_attestation?.[1].address).toBe('0x099bacd621d896d9b7618d8e7ec330ae7867c117');
    expect(PINNED_VARIANT_VERIFIERS.android_factory.coinbase_attestation?.[8453].address).toBe('0x87d9a66cacac95b2bc43bac8e610c59acb67c5e0');
    expect(PINNED_VARIANT_VERIFIERS.android_factory.coinbase_attestation?.[1].address).toBe('0x5798eee099da12eeb995ad6a09a8ab87c240b72b');
    // v1's contracts appear nowhere in the table.
    const all = JSON.stringify([PINNED_VERIFIERS, PINNED_VARIANT_VERIFIERS]);
    for (const v1 of ['0xf7ded73e7a7fc8fb030c35c5a88d40abe6865382', '0x42d165a48256ae184e1de4e7e6372e870e2bc883', '0xf3d5a09d2c85b28c52ef2905c1be3a852b609d0c']) {
      expect(all).not.toContain(v1);
    }
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
      `Circuit 'oidc_domain_attestation' has no '${variant}' signer variant. Known for oidc_domain_attestation: standard, android, android_factory.`,
    );
    expect(() => getPinnedVariantVerifier('oidc_domain_attestation', variant, 84532)).toThrow(/has no .* signer variant/);
  });

  it('a variant the circuit has no package for names the ones it has', () => {
    expect(() => getCircuitPackage('giwa_attestation', 'android')).toThrow(
      "Circuit 'giwa_attestation' has no 'android' signer variant. Known for giwa_attestation: standard.",
    );
  });

  it('isSignerVariant', () => {
    expect(SIGNER_VARIANTS).toEqual(['standard', 'android', 'android_factory']);
    expect(isSignerVariant('android_factory')).toBe(true);
    expect(isSignerVariant('android-factory')).toBe(false);
    expect(isSignerVariant('android')).toBe(true);
    for (const v of ['ANDROID', '', null, undefined, 1, {}]) expect(isSignerVariant(v)).toBe(false);
  });

  it('the variant-aware getter requires the variant and agrees with the standard one', () => {
    expect(getPinnedVariantVerifier('coinbase_attestation', 'standard', 84532)).toBe(getPinnedVerifier('coinbase_attestation', 84532));
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'standard', 1234)).toThrow(
      /No coinbase_attestation verifier is deployed on chain 1234/,
    );
  });

  // Coinbase KYC v2's standard package has no Ethereum Sepolia deployment.
  it('a package with no deployment on the chain asked for names the chains that have one', () => {
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'standard', 11155111)).toThrow(
      'No coinbase_attestation verifier is deployed on chain 11155111. Chains with one: 1, 8453, 84532.',
    );
  });

  it('an android package without a deployment on the chain asked for says so', () => {
    expect(() => getPinnedVariantVerifier('oidc_domain_attestation', 'android', 424242)).toThrow(
      /^No oidc_domain_attestation verifier for the 'android' signer is deployed on chain 424242\. /,
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
    ['android_factory claim, the shared 2^21 length', 'android_factory', ANDROID, 'android_factory'],
  ])('oidc: %s', (_name, claimed, bytes, variant) => {
    expect(resolveSignerVariant('oidc_domain_attestation', claimed, proofOf(bytes))).toEqual({ variant });
  });

  it('a missing field with the android length is refused, naming both', () => {
    const r = resolveSignerVariant('oidc_domain_attestation', undefined, proofOf(ANDROID));
    expect(r).toEqual({
      error:
        "This oidc_domain_attestation proof is 10688 bytes, the length of a 'android' or 'android_factory' proof, but its result does not say which signer made it. " +
        "Refusing rather than checking it against the 'standard' verifier. Pass the result's signerVariant through unchanged.",
    });
  });

  it('an android claim with the standard length is refused', () => {
    const r = resolveSignerVariant('oidc_domain_attestation', 'android', proofOf(STANDARD_OIDC));
    expect(r).toEqual({ error: expect.stringMatching(/is 10304 bytes, the length of a 'standard' proof, but its result says signerVariant 'android'/) });
  });

  it('an android_factory claim with the standard length is refused', () => {
    const r = resolveSignerVariant('oidc_domain_attestation', 'android_factory', proofOf(STANDARD_OIDC));
    expect(r).toEqual({ error: expect.stringMatching(/the length of a 'standard' proof, but its result says signerVariant 'android_factory'/) });
    expect('error' in resolveSignerVariant('coinbase_attestation', 'android_factory', proofOf(STANDARD_KYC))).toBe(true);
  });

  it('android and android_factory share a length: the claim decides, the length does not object', () => {
    expect(resolveSignerVariant('oidc_domain_attestation', 'android', proofOf(ANDROID))).toEqual({ variant: 'android' });
    expect(resolveSignerVariant('oidc_domain_attestation', 'android_factory', proofOf(ANDROID))).toEqual({ variant: 'android_factory' });
    expect('error' in resolveSignerVariant('coinbase_attestation', undefined, proofOf(ANDROID))).toBe(true);
  });

  it('a standard claim with the android length is refused', () => {
    expect('error' in resolveSignerVariant('oidc_domain_attestation', 'standard', proofOf(ANDROID))).toBe(true);
  });

  it('Coinbase KYC: its standard package is 2^20, its android one 2^21', () => {
    expect(resolveSignerVariant('coinbase_attestation', undefined, proofOf(STANDARD_KYC))).toEqual({ variant: 'standard' });
    expect('error' in resolveSignerVariant('coinbase_attestation', undefined, proofOf(ANDROID))).toBe(true);
    expect('error' in resolveSignerVariant('coinbase_attestation', 'android', proofOf(STANDARD_KYC))).toBe(true);
  });

  it('reads the length with or without 0x, in either case', () => {
    expect('error' in resolveSignerVariant('oidc_domain_attestation', undefined, 'AB'.repeat(ANDROID))).toBe(true);
    expect('error' in resolveSignerVariant('oidc_domain_attestation', undefined, '0X' + 'ab'.repeat(ANDROID))).toBe(true);
  });

  it('a single-package circuit has nothing to tell apart and ignores the length', () => {
    expect(resolveSignerVariant('dojang_playground', undefined, proofOf(ANDROID))).toEqual({ variant: 'standard' });
    expect(resolveSignerVariant('giwa_attestation', 'standard', 'not hex')).toEqual({ variant: 'standard' });
  });

  it.each([['ios'], [''], ['Android'], [42], [true], [{}], [['android']]])('refuses the claim %j by name', claimed => {
    const r = resolveSignerVariant('oidc_domain_attestation', claimed, proofOf(STANDARD_OIDC));
    expect(r).toEqual({ error: `Circuit 'oidc_domain_attestation' has no ${JSON.stringify(claimed)} signer variant. Known for oidc_domain_attestation: standard, android, android_factory.` });
  });

  it('refuses an android claim for a circuit without that package', () => {
    expect(resolveSignerVariant('giwa_attestation', 'android', proofOf(64))).toEqual({
      error: `Circuit 'giwa_attestation' has no "android" signer variant. Known for giwa_attestation: standard.`,
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
  const parsed = (bytes: number) => ({ proofHex: proofOf(bytes), publicInputsHex: kyc, numPublicInputs: 193 });
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

  it.each([['android'], ['android_factory']])('core on-chain: a %s proof verifies on its own pinned contract', async variant => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(ANDROID), {}, { chainId: 84532 }, undefined, { signerVariant: variant });
    expect(r).toEqual({ valid: true });
    expect(String(Contract.mock.calls[0][0]).toLowerCase()).toBe(getPinnedVariantVerifier('coinbase_attestation', variant, 84532).address);
  });

  it('core on-chain: a response naming the standard contract for an android proof is refused', async () => {
    const r = await verifyProofOnChain('coinbase_attestation', parsed(ANDROID), {}, { chainId: 84532 },
      { verifierAddress: getPinnedVerifier('coinbase_attestation', 84532).address }, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/Refusing rather than trusting the response/) });
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
    expect(claimed).toEqual({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(2);
    expect(String(Contract.mock.calls[1][0]).toLowerCase()).toBe(getPinnedVariantVerifier('coinbase_attestation', 'android', 84532).address);
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
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(1888).buffer };
    }) as unknown as typeof fetch;
    const r = await verifyProofOffChain('coinbase_attestation', proofOf(ANDROID), kyc, { signerVariant: 'android' });
    expect(r).toEqual({ valid: true });
    expect(urls).toEqual(['https://raw.githubusercontent.com/zkproofport/circuits/main/coinbase-attestation-v2-android/target/vk/vk']);
    await verifyProofOffChain('coinbase_attestation', proofOf(STANDARD_KYC), kyc);
    expect(urls[1]).toBe('https://raw.githubusercontent.com/zkproofport/circuits/main/coinbase-attestation-v2/target/vk/vk');
    // Same length as android; the field alone picks the factory package's key,
    // cached apart from the android one.
    await verifyProofOffChain('coinbase_attestation', proofOf(ANDROID), kyc, { signerVariant: 'android_factory' });
    expect(urls[2]).toBe('https://raw.githubusercontent.com/zkproofport/circuits/main/coinbase-attestation-v2-android-factory/target/vk/vk');
    expect(urls).toHaveLength(3);
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
    expect(parseProofResponseUrl(`${base}&signerVariant=android_factory`)?.signerVariant).toBe('android_factory');
  });

  it('keeps an unknown value as sent, for verification to refuse by name', () => {
    expect(parseProofResponseUrl(`${base}&signerVariant=%3Cscript%3E`)?.signerVariant).toBe('<script>');
  });

  it('leaves it out when absent', () => {
    expect(parseProofResponseUrl(base)).not.toHaveProperty('signerVariant');
  });
});
