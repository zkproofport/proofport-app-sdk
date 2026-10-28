/**
 * Target resolution once an android verifier is pinned. The generated table
 * has no android rows until those verifiers are deployed, so this loads core
 * from source with one injected row: an android proof is judged by the android
 * contract, a standard proof by the standard one, and a response naming the
 * other is refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { makeRsaKey, oidcPublicInputs, serveJwks, GOOGLE_JWKS_URL } from './helpers/oidcFixtures';

const ANDROID_84532 = '0x00000000000000000000000000000000000a0d01';
const FACTORY_84532 = '0x00000000000000000000000000000000000fac01';

vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
  const actual = await importOriginal<typeof import('../../packages/core/src/pinnedVerifiers.generated')>();
  return {
    ...actual,
    PINNED_VARIANT_VERIFIERS: {
      android: {
        oidc_domain_attestation: {
          84532: { address: ANDROID_84532, deployedAt: '2026-10-29T00:00:00.000Z', circuitsCommit: 'test', record: 'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json' },
        },
      },
      android_factory: {
        oidc_domain_attestation: {
          84532: { address: FACTORY_84532, deployedAt: '2026-10-29T00:00:00.000Z', circuitsCommit: 'test', record: 'broadcast/DeployOidcDomainAttestationAndroidFactory.s.sol/84532/run-latest.json' },
        },
      },
    },
  };
});

const { verifyProofOnChain, getPinnedVariantVerifier, getPinnedVerifier } = await import('../../packages/core/src/index');
const { clearOidcKeyCache } = await import('../../packages/core/src/oidcProviderKeys');

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const CLOCK = 1_800_000_000;
const google = makeRsaKey();
const inputs = () => oidcPublicInputs(google.n, 0);
const parsed = (bytes: number) => ({ proofHex: '0x' + 'ab'.repeat(bytes), publicInputsHex: inputs(), numPublicInputs: 214 });
const called = () => Contract.mock.calls.map(c => String(c[0]).toLowerCase());

beforeEach(() => {
  Contract.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(CLOCK * 1000);
  clearOidcKeyCache();
  serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('with an android row pinned', () => {
  it('the variant-aware getter finds it; the standard getter does not change', () => {
    expect(getPinnedVariantVerifier('oidc_domain_attestation', 'android', 84532).address).toBe(ANDROID_84532);
    expect(getPinnedVerifier('oidc_domain_attestation', 84532).address).not.toBe(ANDROID_84532);
    expect(() => getPinnedVariantVerifier('oidc_domain_attestation', 'android', 11155111)).toThrow(
      "No oidc_domain_attestation verifier for the 'android' signer is deployed on chain 11155111. Chains with one: 84532.",
    );
  });

  it('an android proof is judged by the android contract', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 }, undefined, { signerVariant: 'android' });
    expect(r).toEqual({ valid: true });
    expect(called()).toEqual([ANDROID_84532]);
  });

  it('an android_factory proof of the same length is judged by the factory contract', async () => {
    expect(getPinnedVariantVerifier('oidc_domain_attestation', 'android_factory', 84532).address).toBe(FACTORY_84532);
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 }, undefined, { signerVariant: 'android_factory' });
    expect(r).toEqual({ valid: true });
    expect(called()).toEqual([FACTORY_84532]);
  });

  it('a response naming the android contract for an android_factory proof is refused', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 }, { verifierAddress: ANDROID_84532 }, { signerVariant: 'android_factory' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/Refusing rather than trusting the response/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('an unknown variant still ends at an error naming it', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 }, undefined, { signerVariant: 'android_factory_v2' });
    expect(r).toEqual({ valid: false, error: expect.stringContaining('has no "android_factory_v2" signer variant. Known for oidc_domain_attestation: standard, android, android_factory.') });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a standard proof without the field is judged by the standard contract', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10304), {}, { chainId: 84532 });
    expect(r).toEqual({ valid: true });
    expect(called()).toEqual([getPinnedVerifier('oidc_domain_attestation', 84532).address]);
  });

  it('a response naming the standard contract for an android proof is refused', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 }, {
      verifierAddress: getPinnedVerifier('oidc_domain_attestation', 84532).address,
    }, { signerVariant: 'android' });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/Refusing rather than trusting the response/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a response naming the android contract for a proof without the field is refused', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10304), {}, { chainId: 84532 }, { verifierAddress: ANDROID_84532 });
    expect(r.valid).toBe(false);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('the android length without the field still never reaches either contract', async () => {
    const r = await verifyProofOnChain('oidc_domain_attestation', parsed(10688), {}, { chainId: 84532 });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/does not say which signer made it/) });
    expect(Contract).not.toHaveBeenCalled();
  });
});
