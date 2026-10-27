/**
 * The OIDC v2 policy: an `oidc_domain_attestation` proof's audience, nonce
 * mode, nonce binding and `now` must be ours and current before any verify
 * function calls it valid (core's checkOidcPolicy, fix list item 2).
 *
 * Covers the matrix written before the code: input count (v1 148 named), each
 * allowed audience in each mode, foreign and cross-provider audiences, the
 * mode/binding rule, the request binding with its scope and requestId
 * validation (empty, whitespace, oversize, UTF-8, hostile text, non-UUID,
 * uppercase UUID, null/undefined fields), `now` at and past each skew bound
 * and u64 overflow, malformed fields, and that every verify path runs the
 * policy before any key fetch, contract call or Barretenberg load. The SDK's
 * relay-request memory has its own block at the end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import {
  checkOidcPolicy,
  checkProofIssuer,
  clearOidcKeyCache,
  deriveOidcNonceBinding,
  oidcAudienceHash,
  verifyProofOnChain,
  OIDC_ALLOWED_AUDIENCES,
  OIDC_NOW_MAX_AGE_SECONDS,
  OIDC_NOW_MAX_FUTURE_SECONDS,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as L,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import type { ProofResponse } from '../types';
import {
  bindingFor,
  makeRsaKey,
  oidcPublicInputs,
  oidcV1PublicInputs,
  serveJwks,
  GOOGLE_DEVICE_CLIENT,
  GOOGLE_JWKS_URL,
  GOOGLE_WEB_CLIENT,
  MICROSOFT_CLIENT,
  MICROSOFT_JWKS_URL,
  MS_TEMPLATE_ISSUER,
  REQUEST_ID,
  SCOPE,
} from './helpers/oidcFixtures';

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

const CLOCK = 1_800_000_000;
const google = makeRsaKey();
const microsoft = makeRsaKey(2048, { issuer: MS_TEMPLATE_ISSUER });
const N = google.n;
const REQUEST = { scope: SCOPE, requestId: REQUEST_ID };
const field = (v: bigint | number) => '0x' + BigInt(v).toString(16).padStart(64, '0');

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(CLOCK * 1000);
  clearOidcKeyCache();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const appGoogle = (extra = {}) => oidcPublicInputs(N, 0, { aud: GOOGLE_WEB_CLIENT, nonceMode: 1, request: REQUEST, ...extra });
const deviceGoogle = (extra = {}) => oidcPublicInputs(N, 0, { aud: GOOGLE_DEVICE_CLIENT, nonceMode: 0, ...extra });

describe('the allowed audiences', () => {
  it('lists exactly our three clients, each in the modes decided on 2026-10-27', () => {
    const rows = Object.entries(OIDC_ALLOWED_AUDIENCES).flatMap(([p, list]) => list.map(a => [p, a.clientId, [...a.nonceModes]]));
    expect(rows).toEqual([
      ['0', GOOGLE_WEB_CLIENT, [1]],
      ['0', GOOGLE_DEVICE_CLIENT, [0]],
      ['1', MICROSOFT_CLIENT, [0, 1]],
    ]);
  });

  it('hashes the aud string with keccak256 (the circuit\'s aud_hash)', () => {
    expect(oidcAudienceHash(GOOGLE_WEB_CLIENT)).toBe(ethers.keccak256(ethers.toUtf8Bytes(GOOGLE_WEB_CLIENT)).slice(2));
  });
});

describe('accepted', () => {
  it.each([
    ['Google web client, mode 1, bound to the request', () => appGoogle(), REQUEST],
    ['Google web client, mode 1, no request supplied', () => appGoogle(), undefined],
    ['Google device client, mode 0', () => deviceGoogle(), undefined],
    ['Google device client, mode 0, with the request (scope matches)', () => deviceGoogle({ request: REQUEST }), REQUEST],
    ['Microsoft client, mode 1 (app)', () => oidcPublicInputs(N, 1, { nonceMode: 1, request: REQUEST }), REQUEST],
    ['Microsoft client, mode 0 (device flow)', () => oidcPublicInputs(N, 1, { nonceMode: 0 }), undefined],
  ])('%s', (_name, inputs, request) => {
    expect(checkOidcPolicy(inputs(), { request })).toEqual({ ok: true });
  });
});

describe('public input count', () => {
  it('refuses a v1 proof (148 inputs) by name', () => {
    const r = checkOidcPolicy(oidcV1PublicInputs(N, 0));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/v1 oidc_domain_attestation proof \(148 public inputs\).*no longer accepted/) });
  });

  it.each([0, 1, 147, 149, 213, 215, 428])('refuses %i inputs', count => {
    const base = deviceGoogle();
    const resized = count <= 214 ? base.slice(0, count) : [...base, ...Array(count - 214).fill(field(0))];
    expect(checkOidcPolicy(resized)).toEqual({ ok: false, error: expect.stringMatching(/has 214 public inputs; got/) });
  });

  it.each([null, undefined, 'x', {}])('refuses a non-array (%s)', value => {
    expect(checkOidcPolicy(value as never).ok).toBe(false);
  });
});

describe('audience', () => {
  it('refuses a token issued to some other Google client', () => {
    const r = checkOidcPolicy(deviceGoogle({ aud: '123-other.apps.googleusercontent.com' }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/not a ZKProofport client for provider 0/) });
  });

  it('refuses our Microsoft client id presented under provider 0 (Google)', () => {
    expect(checkOidcPolicy(deviceGoogle({ aud: MICROSOFT_CLIENT })).ok).toBe(false);
  });

  it('refuses our Google device client presented under provider 1 (Microsoft)', () => {
    expect(checkOidcPolicy(oidcPublicInputs(N, 1, { aud: GOOGLE_DEVICE_CLIENT })).ok).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['uppercase', GOOGLE_DEVICE_CLIENT.toUpperCase()],
    ['trailing space', GOOGLE_DEVICE_CLIENT + ' '],
    ['wildcard', '%'],
    ['script tag', '<script>alert(1)</script>'],
    ['Korean and emoji', '구글🔑'],
  ])('refuses a near-miss or hostile aud (%s)', (_n, aud) => {
    expect(checkOidcPolicy(deviceGoogle({ aud })).ok).toBe(false);
  });

  it('refuses when one aud_hash byte is flipped', () => {
    const inputs = deviceGoogle();
    inputs[L.AUD_HASH_END] = field((BigInt(inputs[L.AUD_HASH_END]) ^ 1n));
    expect(checkOidcPolicy(inputs).ok).toBe(false);
  });

  it.each([['256', field(256)], ['not a number', 'zz'], ['negative', '-1']])('refuses an aud_hash byte that is %s', (_n, v) => {
    const inputs = deviceGoogle();
    inputs[L.AUD_HASH_START] = v;
    expect(checkOidcPolicy(inputs)).toEqual({ ok: false, error: expect.stringMatching(/Public input 148 \(aud_hash byte 0\)/) });
  });
});

describe('nonce mode against audience', () => {
  it('refuses the Google web client in mode 0 (an app token must be nonce-bound)', () => {
    const r = checkOidcPolicy(oidcPublicInputs(N, 0, { aud: GOOGLE_WEB_CLIENT, nonceMode: 0 }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonce_mode 0 is not accepted for Google web client/) });
  });

  it('refuses the Google device client in mode 1', () => {
    const r = checkOidcPolicy(oidcPublicInputs(N, 0, { aud: GOOGLE_DEVICE_CLIENT, nonceMode: 1, request: REQUEST }), { request: REQUEST });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonce_mode 1 is not accepted for Google device client/) });
  });

  it.each([2, 255, 256])('refuses nonce_mode %i', mode => {
    const r = checkOidcPolicy(deviceGoogle({ nonceMode: mode }));
    expect(r.ok).toBe(false);
  });

  it('names nonce_mode 2 as unknown', () => {
    expect(checkOidcPolicy(deviceGoogle({ nonceMode: 2 }))).toEqual({ ok: false, error: expect.stringMatching(/Unknown OIDC nonce_mode 2/) });
  });

  it.each([0, 31])('mode 0 refuses a binding with byte %i nonzero', at => {
    const binding = '00'.repeat(at) + '01' + '00'.repeat(31 - at);
    expect(checkOidcPolicy(deviceGoogle({ binding }))).toEqual({ ok: false, error: 'nonce_mode is 0 but nonce_binding is not all zero.' });
  });
});

describe('request binding (mode 1)', () => {
  it('derives the nonce the app derives', () => {
    expect(deriveOidcNonceBinding(SCOPE, REQUEST_ID)).toBe(bindingFor(SCOPE, REQUEST_ID));
  });

  it('refuses a proof bound to another requestId of the same scope (replay across requests)', () => {
    const other = { scope: SCOPE, requestId: '11111111-2222-4333-8444-555555555555' };
    const r = checkOidcPolicy(appGoogle({ request: other }), { request: REQUEST });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonce is bound to .* not to request/) });
  });

  it('refuses a proof whose scope is not the requested scope', () => {
    const r = checkOidcPolicy(appGoogle({ request: { scope: 'other.example', requestId: REQUEST_ID } }), { request: REQUEST });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/is not keccak256 of the requested scope/) });
  });

  it('refuses an all-zero binding in mode 1 when the request is known', () => {
    expect(checkOidcPolicy(appGoogle({ binding: '00'.repeat(32) }), { request: REQUEST }).ok).toBe(false);
  });

  it.each([
    ['Korean and emoji', '오픈스토아 🚀 커뮤니티'],
    ['hostile text', '%_\\ <script>\'; DROP TABLE x; --\u0000\t\n'],
    ['exactly 4096 bytes', 'a'.repeat(4096)],
  ])('binds a scope with %s', (_n, scope) => {
    const request = { scope, requestId: REQUEST_ID };
    expect(checkOidcPolicy(appGoogle({ request }), { request })).toEqual({ ok: true });
  });

  it.each([
    ['empty scope', { scope: '', requestId: REQUEST_ID }, /scope is empty/],
    ['whitespace-only scope', { scope: ' \t\n', requestId: REQUEST_ID }, /scope is empty/],
    ['4097-byte scope', { scope: 'a'.repeat(4097), requestId: REQUEST_ID }, /4097 bytes; the limit is 4096/],
    ['multi-byte scope over the cap', { scope: '가'.repeat(1366), requestId: REQUEST_ID }, /4098 bytes/],
    ['null scope', { scope: null, requestId: REQUEST_ID }, /scope must be a string, got null/],
    ['undefined scope', { scope: undefined, requestId: REQUEST_ID }, /scope must be a string, got undefined/],
    ['uppercase UUID', { scope: SCOPE, requestId: REQUEST_ID.toUpperCase() }, /lowercase UUID/],
    ['relay-style non-UUID', { scope: SCOPE, requestId: 'req-lh8k3f2g-a9b7c4d2' }, /lowercase UUID/],
    ['empty requestId', { scope: SCOPE, requestId: '' }, /lowercase UUID/],
    ['null requestId', { scope: SCOPE, requestId: null }, /lowercase UUID/],
    ['UUID with a trailing newline', { scope: SCOPE, requestId: REQUEST_ID + '\n' }, /lowercase UUID/],
    ['null request', null, /must be an object/],
  ])('refuses a request with %s', (_n, request, message) => {
    expect(checkOidcPolicy(appGoogle(), { request: request as never })).toEqual({ ok: false, error: expect.stringMatching(message) });
  });

  it('deriveOidcNonceBinding throws on a request it would refuse', () => {
    expect(() => deriveOidcNonceBinding('', REQUEST_ID)).toThrow(/scope is empty/);
    expect(() => deriveOidcNonceBinding(SCOPE, 'R1')).toThrow(/lowercase UUID/);
  });
});

describe('now', () => {
  it.each([
    ['equal to the clock', CLOCK, true],
    [`${OIDC_NOW_MAX_AGE_SECONDS}s behind (the bound)`, CLOCK - OIDC_NOW_MAX_AGE_SECONDS, true],
    [`${OIDC_NOW_MAX_AGE_SECONDS + 1}s behind`, CLOCK - OIDC_NOW_MAX_AGE_SECONDS - 1, false],
    [`${OIDC_NOW_MAX_FUTURE_SECONDS}s ahead (the bound)`, CLOCK + OIDC_NOW_MAX_FUTURE_SECONDS, true],
    [`${OIDC_NOW_MAX_FUTURE_SECONDS + 1}s ahead`, CLOCK + OIDC_NOW_MAX_FUTURE_SECONDS + 1, false],
    ['zero', 0, false],
    ['twice the clock', CLOCK * 2, false],
    ['u64 max', (1n << 64n) - 1n, false],
  ])('now %s', (_n, now, ok) => {
    expect(checkOidcPolicy(deviceGoogle({ now })).ok).toBe(ok);
  });

  it('names the direction of a refusal', () => {
    expect(checkOidcPolicy(deviceGoogle({ now: CLOCK + 3600 }))).toEqual({ ok: false, error: expect.stringMatching(/3600s ahead/) });
    expect(checkOidcPolicy(deviceGoogle({ now: CLOCK - 3600 }))).toEqual({ ok: false, error: expect.stringMatching(/3600s behind/) });
  });

  it.each([['2^64', field(1n << 64n)], ['not a number', 'now'], ['empty', '']])('refuses a now that is %s', (_n, v) => {
    const inputs = deviceGoogle();
    inputs[L.NOW] = v;
    if (v === '') {
      // BigInt('') is 0n: an empty field reads as zero and is refused as stale.
      expect(checkOidcPolicy(inputs)).toEqual({ ok: false, error: expect.stringMatching(/behind/) });
    } else {
      expect(checkOidcPolicy(inputs)).toEqual({ ok: false, error: expect.stringMatching(/Public input 213 \(now\)/) });
    }
  });
});

describe('provider', () => {
  it.each([2, 255])('refuses provider %i as unknown', p => {
    expect(checkOidcPolicy(oidcPublicInputs(N, p))).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`Unknown OIDC provider ${p}`)) });
  });
});

describe('every verify path runs the policy before anything else', () => {
  const PROOF = '0x' + 'ab'.repeat(64);
  const VK = new Uint8Array(1888);
  const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
  const foreign = () => oidcPublicInputs(N, 0, { aud: '999-foreign.apps.googleusercontent.com', request: REQUEST });
  const resp = (inputs: string[]): ProofResponse => ({ requestId: REQUEST_ID, circuit: 'oidc_domain_attestation', status: 'completed', proof: PROOF, publicInputs: inputs });

  const paths: Array<[string, (inputs: string[]) => Promise<{ valid: boolean; error?: string }>]> = [
    ['core verifyProofOnChain', i => verifyProofOnChain('oidc_domain_attestation', { proofHex: PROOF, publicInputsHex: i, numPublicInputs: 214 }, {}, { chainId: 84532 }, undefined, { request: REQUEST })],
    ['sdk.verifyOnChain', i => ProofportSDK.create('staging').verifyOnChain('oidc_domain_attestation', PROOF, i, {}, { request: REQUEST })],
    ['sdk.verifyResponseOnChain', i => ProofportSDK.create('staging').verifyResponseOnChain(resp(i), {}, { request: REQUEST })],
    ['verifyProofOffChain', i => verifyProofOffChain('oidc_domain_attestation', PROOF, i, { verificationKey: VK, request: REQUEST })],
    ['sdk.verifyResponseOffChain', i => ProofportSDK.create('staging').verifyResponseOffChain(resp(i), { verificationKey: VK, request: REQUEST })],
  ];

  it.each(paths)('%s refuses a foreign audience without fetching keys or asking a verifier', async (_n, verify) => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    Contract.mockClear();
    bbLoaded.mockClear();
    const r = await verify(foreign());
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not a ZKProofport client/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Contract).not.toHaveBeenCalled();
  });

  it.each(paths)('%s refuses a proof bound to another request', async (_n, verify) => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = appGoogle({ request: { scope: SCOPE, requestId: '11111111-2222-4333-8444-555555555555' } });
    const r = await verify(inputs);
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/not to request/) });
  });

  it.each(paths)('%s refuses a v1 proof', async (_n, verify) => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const r = await verify(oidcV1PublicInputs(N, 0));
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/v1 oidc_domain_attestation proof/) });
  });

  it.each(paths)('%s accepts a bound app proof with a published key', async (_n, verify) => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    expect(await verify(appGoogle())).toEqual({ valid: true });
  });

  it('checkProofIssuer passes the request through to the policy', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = appGoogle();
    expect(await checkProofIssuer('oidc_domain_attestation', inputs, { request: REQUEST })).toEqual({ ok: true });
    const other = { scope: SCOPE, requestId: '11111111-2222-4333-8444-555555555555' };
    expect((await checkProofIssuer('oidc_domain_attestation', inputs, { request: other })).ok).toBe(false);
  });

  it('a Microsoft device-flow proof passes policy and then the Microsoft key check', async () => {
    serveJwks({ [MICROSOFT_JWKS_URL]: [microsoft.jwk] });
    expect(await checkProofIssuer('oidc_domain_attestation', oidcPublicInputs(microsoft.n, 1, { nonceMode: 0 }))).toEqual({ ok: true });
  });
});

describe('the SDK remembers the relay requests it created', () => {
  const PROOF = '0x' + 'ab'.repeat(64);
  const resp = (inputs: string[], requestId = REQUEST_ID): ProofResponse => ({ requestId, circuit: 'oidc_domain_attestation', status: 'completed', proof: PROOF, publicInputs: inputs });

  async function sdkWithRelayRequest(requestId = REQUEST_ID, scope = SCOPE) {
    const sdk = ProofportSDK.create('staging');
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/challenge')) {
        return { ok: true, json: async () => ({ requestId, challenge: '0x' + '11'.repeat(32), expiresAt: Date.now() + 60000 }) };
      }
      if (String(url).includes('/proof/request')) {
        return { ok: true, json: async () => ({ requestId, deepLink: 'zkproofport://x', status: 'pending', pollUrl: '/p' }) };
      }
      if (String(url) === GOOGLE_JWKS_URL) {
        return { ok: true, status: 200, headers: { get: () => 'max-age=60' }, text: async () => JSON.stringify({ keys: [google.jwk] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as never;
    await sdk.createRelayRequest('oidc_domain_attestation', { scope } as never);
    return sdk;
  }

  it('checks the binding against the request it created, with nothing passed back in', async () => {
    const sdk = await sdkWithRelayRequest();
    expect(await sdk.verifyResponseOnChain(resp(appGoogle()), {})).toEqual({ valid: true });
  });

  it('refuses a response bound to another request even though the response names this requestId', async () => {
    const sdk = await sdkWithRelayRequest();
    const inputs = appGoogle({ request: { scope: SCOPE, requestId: '11111111-2222-4333-8444-555555555555' } });
    expect(await sdk.verifyResponseOnChain(resp(inputs), {})).toEqual({ valid: false, error: expect.stringMatching(/not to request/) });
  });

  it('refuses an OIDC response for a requestId it never created, naming the option to pass', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOffChain(resp(appGoogle()), { verificationKey: new Uint8Array(1888) });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/Pass \{ request: \{ scope, requestId \} \}/) });
  });

  it('refuses an explicit request whose requestId is not the response\'s', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOnChain(resp(appGoogle()), {}, { request: { scope: SCOPE, requestId: '11111111-2222-4333-8444-555555555555' } });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/is not the one this response answers/) });
  });

  it('does not ask non-OIDC responses for a request', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOnChain({ ...resp([]), circuit: 'mdl_kr_age', publicInputs: Array(66).fill(field(0)) }, {});
    expect(r.error ?? '').not.toMatch(/request/);
  });

  it(`forgets the oldest past ${ProofportSDK.MAX_REMEMBERED_RELAY_REQUESTS} remembered requests`, async () => {
    const sdk = await sdkWithRelayRequest();
    const remember = (sdk as any).rememberRelayRequest.bind(sdk);
    for (let i = 0; i < ProofportSDK.MAX_REMEMBERED_RELAY_REQUESTS; i++) {
      remember(`00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`, SCOPE);
    }
    expect((sdk as any).relayRequests.size).toBe(ProofportSDK.MAX_REMEMBERED_RELAY_REQUESTS);
    const r = await sdk.verifyResponseOnChain(resp(appGoogle()), {});
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/No request/) });
  });
});
