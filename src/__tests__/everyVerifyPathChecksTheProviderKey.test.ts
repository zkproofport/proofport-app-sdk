/**
 * Every function a dApp can call to verify a proof runs the OIDC provider-key
 * check itself. Removing the call from any one of them fails its case here:
 * each case gives a proof made with a key no provider publishes, mocks the
 * contract (and bb.js) to say "valid", and requires the answer "not valid"
 * without the contract or Barretenberg ever being asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import { verifyProofOnChain, clearOidcKeyCache } from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import type { ProofResponse } from '../types';
import { makeRsaKey, oidcPublicInputs, serveJwks, GOOGLE_JWKS_URL } from './helpers/oidcFixtures';

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
const published = makeRsaKey();
const forged = makeRsaKey();
const PROOF = '0x' + 'ab'.repeat(64);
const VK = new Uint8Array(1888);

const response = (n: string): ProofResponse => ({
  requestId: 'r1',
  circuit: 'oidc_domain_attestation',
  status: 'completed',
  proof: PROOF,
  publicInputs: oidcPublicInputs(n, 0),
});

const paths: Array<[string, (n: string) => Promise<{ valid: boolean; error?: string }>, 'chain' | 'bb']> = [
  ['core verifyProofOnChain', n =>
    verifyProofOnChain('oidc_domain_attestation', { proofHex: PROOF, publicInputsHex: oidcPublicInputs(n, 0), numPublicInputs: 148 }, {}, { chainId: 84532 }), 'chain'],
  ['sdk.verifyOnChain', n => ProofportSDK.create('staging').verifyOnChain('oidc_domain_attestation', PROOF, oidcPublicInputs(n, 0), {}), 'chain'],
  ['sdk.verifyResponseOnChain', n => ProofportSDK.create('staging').verifyResponseOnChain(response(n), {}), 'chain'],
  ['verifyProofOffChain', n => verifyProofOffChain('oidc_domain_attestation', PROOF, oidcPublicInputs(n, 0), { verificationKey: VK }), 'bb'],
  ['sdk.verifyResponseOffChain', n => ProofportSDK.create('staging').verifyResponseOffChain(response(n), { verificationKey: VK }), 'bb'],
];

beforeEach(() => {
  clearOidcKeyCache();
  Contract.mockClear();
  serveJwks({ [GOOGLE_JWKS_URL]: [published.jwk] });
});

describe.each(paths)('%s', (_name, verify, backend) => {
  it('refuses a key Google does not publish, before asking the verifier', async () => {
    const result = await verify(forged.n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not publish/);
    if (backend === 'chain') expect(Contract).not.toHaveBeenCalled();
  });

  it('accepts a key Google publishes, and then the verifier decides', async () => {
    const result = await verify(published.n);
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(true);
    if (backend === 'chain') expect(Contract).toHaveBeenCalledTimes(1);
  });

  it('fails when the key set cannot be fetched', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as never;
    const result = await verify(published.n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Could not fetch Google's signing keys/);
  });

  it('an unknown provider value is a named error result, not a crash', async () => {
    const result = await (async () => {
      const inputs = oidcPublicInputs(published.n, 7);
      if (backend === 'chain') {
        return verifyProofOnChain('oidc_domain_attestation', { proofHex: PROOF, publicInputsHex: inputs, numPublicInputs: 148 }, {}, { chainId: 84532 });
      }
      return verifyProofOffChain('oidc_domain_attestation', PROOF, inputs, { verificationKey: VK });
    })();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unknown OIDC provider 7/);
  });
});

it('non-OIDC circuits fetch no key set', async () => {
  const fetchMock = serveJwks({});
  const result = await ProofportSDK.create('staging').verifyOnChain('coinbase_attestation', PROOF, ['0x01'], {});
  expect(result.valid).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
