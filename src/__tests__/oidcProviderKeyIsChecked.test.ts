/**
 * An oidc_domain_attestation proof is only worth something if the RSA key it
 * was made with is one Google or Microsoft publishes: the key is a public input
 * the prover chooses. These cases hold core's checkOidcProviderKey to that,
 * row by row against the edge-case matrix in the change that added it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkOidcProviderKey,
  clearOidcKeyCache,
  MAX_JWKS_CACHE_MS,
  RECENT_KEY_RETENTION_MS,
  MIN_REFETCH_INTERVAL_MS,
  OIDC_PROVIDERS,
} from '../verifier';
import {
  makeRsaKey,
  oidcPublicInputs,
  modulusOf,
  serveJwks,
  jwksResponse,
  GOOGLE_JWKS_URL,
  MICROSOFT_JWKS_URL,
  MS_TEMPLATE_ISSUER,
} from './helpers/oidcFixtures';

const google = makeRsaKey();
const google2 = makeRsaKey();
const microsoft = makeRsaKey(2048, { issuer: MS_TEMPLATE_ISSUER, alg: undefined });
const forged = makeRsaKey();

beforeEach(() => {
  clearOidcKeyCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('which key is accepted', () => {
  it('accepts a modulus Google publishes, fetched from the fixed Google URL without redirects', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    expect(await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(GOOGLE_JWKS_URL, expect.objectContaining({ redirect: 'error' }));
  });

  it('accepts a Microsoft multi-tenant key from the organizations endpoint', async () => {
    const fetchMock = serveJwks({ [MICROSOFT_JWKS_URL]: [microsoft.jwk] });
    expect(await checkOidcProviderKey(oidcPublicInputs(microsoft.n, 1))).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(MICROSOFT_JWKS_URL, expect.objectContaining({ redirect: 'error' }));
  });

  it('refuses a self-generated key the provider does not publish', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const result = await checkOidcProviderKey(oidcPublicInputs(forged.n, 0));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/does not publish/);
  });

  it("refuses Google's key presented as Microsoft's: keys are per provider", async () => {
    serveJwks({ [MICROSOFT_JWKS_URL]: [microsoft.jwk], [GOOGLE_JWKS_URL]: [google.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 1))).ok).toBe(false);
  });

  it('refuses a Microsoft key scoped to one tenant (the personal-account tenant)', async () => {
    const scoped = makeRsaKey(2048, { issuer: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0' });
    serveJwks({ [MICROSOFT_JWKS_URL]: [scoped.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(scoped.n, 1))).ok).toBe(false);
  });

  it('refuses a Microsoft key with no issuer at all', async () => {
    const bare = makeRsaKey();
    serveJwks({ [MICROSOFT_JWKS_URL]: [bare.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(bare.n, 1))).ok).toBe(false);
  });

  it.each([
    ['kty is not RSA', { kty: 'EC' }],
    ['e is not AQAB', { e: 'Aw' }],
    ['alg is RS512', { alg: 'RS512' }],
    ['use is enc', { use: 'enc' }],
    ['n is padded base64', { n: undefined }],
    ['n carries a non-base64url character', { n: undefined }],
    ['n is not a string', { n: 12345 }],
  ])('refuses a published key whose %s', async (label, override) => {
    const jwk: Record<string, unknown> = { ...google.jwk, ...override };
    if (label === 'n is padded base64') jwk.n = google.n + '=';
    if (label === 'n carries a non-base64url character') jwk.n = google.n.slice(0, -1) + '+';
    serveJwks({ [GOOGLE_JWKS_URL]: [jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(false);
  });

  it('accepts a key that omits alg and use (both optional in a JWK)', async () => {
    const { alg, use, ...rest } = google.jwk;
    serveJwks({ [GOOGLE_JWKS_URL]: [rest] });
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(true);
  });

  it.each([1024, 4096])('refuses a published %i-bit key: the circuit is RSA-2048', async bits => {
    const other = makeRsaKey(bits);
    serveJwks({ [GOOGLE_JWKS_URL]: [other.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(other.n, 0))).ok).toBe(false);
  });

  it('refuses a modulus that differs from a published one in its top limb only', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = oidcPublicInputs(google.n, 0);
    inputs[17] = '0x' + (BigInt(inputs[17]) ^ 1n).toString(16).padStart(64, '0');
    expect((await checkOidcProviderKey(inputs)).ok).toBe(false);
  });

  it('ignores junk entries in the key list and still finds the real key', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [null, 7, 'x', { kty: 'RSA' }, google.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(true);
  });
});

describe('malformed public inputs', () => {
  it.each([0, 1, 147, 148, 149, 213, 215, 428])('refuses %i public inputs (the v2 circuit has 214)', async count => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = oidcPublicInputs(google.n, 0);
    const resized = count <= 214 ? inputs.slice(0, count) : [...inputs, ...Array(count - 214).fill('0x00')];
    expect((await checkOidcProviderKey(resized)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a limb wider than 120 bits', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = oidcPublicInputs(google.n, 0);
    inputs[3] = '0x' + (1n << 120n).toString(16);
    const result = await checkOidcProviderKey(inputs);
    expect(!result.ok && result.error).toMatch(/120 bits/);
  });

  it.each([
    ['not hex', 'zz'],
    ['empty', ''],
    ['script tag', '<script>alert(1)</script>'],
    ['emoji', '0x😀'],
    ['wildcard', '%_\\'],
  ])('refuses a limb that is %s', async (_label, value) => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const inputs = oidcPublicInputs(google.n, 0);
    inputs[0] = value;
    expect((await checkOidcProviderKey(inputs)).ok).toBe(false);
  });

  it('refuses an all-zero modulus without fetching anything', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(0n, 0))).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([2n, 255n, 1n << 200n])('throws naming provider %s, which no table row holds', async provider => {
    const fetchMock = serveJwks({});
    await expect(checkOidcProviderKey(oidcPublicInputs(google.n, provider))).rejects.toThrow(
      new RegExp(`Unknown OIDC provider ${provider}\\. Known: 0 \\(Google\\), 1 \\(Microsoft\\)`),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a provider input that is not a number', async () => {
    const inputs = oidcPublicInputs(google.n, 0);
    inputs[147] = 'google';
    expect((await checkOidcProviderKey(inputs)).ok).toBe(false);
  });

  it('knows exactly two providers, each at a fixed URL', () => {
    expect(Object.fromEntries(Object.entries(OIDC_PROVIDERS).map(([k, p]) => [k, p.jwksUrl]))).toEqual({
      '0': GOOGLE_JWKS_URL,
      '1': MICROSOFT_JWKS_URL,
    });
  });
});

describe('a key set that cannot be had fails the check, never passes it', () => {
  const inputs = () => oidcPublicInputs(google.n, 0);

  it('network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const result = await checkOidcProviderKey(inputs());
    expect(!result.ok && result.error).toMatch(/Could not fetch Google's signing keys.*ECONNREFUSED/);
  });

  it('HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue(jwksResponse([], null, 500)) as never;
    const result = await checkOidcProviderKey(inputs());
    expect(!result.ok && result.error).toMatch(/HTTP 500/);
  });

  it('a redirect (fetch with redirect: "error" rejects it)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch: redirect mode is set to error')) as never;
    expect((await checkOidcProviderKey(inputs())).ok).toBe(false);
  });

  it('timeout', async () => {
    global.fetch = vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as never;
    const result = await checkOidcProviderKey(inputs(), { timeoutMs: 20 });
    expect(!result.ok && result.error).toMatch(/timed out after 20ms/);
  });

  it.each([
    ['not JSON', '<html>moved</html>', /not JSON/],
    ['no keys array', '{"keys":{}}', /no "keys" array/],
    ['too large', JSON.stringify({ keys: [], pad: 'x'.repeat(300 * 1024) }), /a key set is a few kilobytes/],
  ])('a body that is %s', async (_label, body, message) => {
    global.fetch = vi.fn().mockResolvedValue(jwksResponse([], null, 200, body)) as never;
    const result = await checkOidcProviderKey(inputs());
    expect(!result.ok && result.error).toMatch(message);
  });

  it('an expired cache whose refetch fails is not used', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=60');
    expect((await checkOidcProviderKey(inputs())).ok).toBe(true);
    // Past max-age, well inside the retention window: the remembered key must
    // not paper over a provider that cannot be reached.
    vi.setSystemTime(Date.now() + 61_000);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect((await checkOidcProviderKey(inputs())).ok).toBe(false);
  });
});

describe('caching', () => {
  const inputs = () => oidcPublicInputs(google.n, 0);

  it('reuses the key set within max-age and refetches after it', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'public, max-age=600, must-revalidate');
    await checkOidcProviderKey(inputs());
    await checkOidcProviderKey(inputs());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 600_000);
    await checkOidcProviderKey(inputs());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([['no-store'], ['no-cache, max-age=600'], [null], ['max-age=abc'], ['max-age=0']])(
    'does not reuse a response with Cache-Control %s',
    async header => {
      const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, header as string | null);
      await checkOidcProviderKey(inputs());
      await checkOidcProviderKey(inputs());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('caps max-age at 24 hours', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=31536000');
    await checkOidcProviderKey(inputs());
    vi.setSystemTime(Date.now() + MAX_JWKS_CACHE_MS);
    await checkOidcProviderKey(inputs());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches each provider separately', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk], [MICROSOFT_JWKS_URL]: [microsoft.jwk] });
    await checkOidcProviderKey(inputs());
    expect((await checkOidcProviderKey(oidcPublicInputs(microsoft.n, 1))).ok).toBe(true);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([GOOGLE_JWKS_URL, MICROSOFT_JWKS_URL]);
  });
});

describe('rotation', () => {
  it('still accepts a key rotated out of the set within the retention window', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=60');
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(true);
    vi.setSystemTime(Date.now() + 120_000);
    fetchMock.mockResolvedValue(jwksResponse([google2.jwk], 'max-age=60') as never);
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses that key once the retention window has passed', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=60');
    await checkOidcProviderKey(oidcPublicInputs(google.n, 0));
    fetchMock.mockResolvedValue(jwksResponse([google2.jwk], 'max-age=60') as never);
    vi.setSystemTime(Date.now() + RECENT_KEY_RETENTION_MS + 1);
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(false);
  });

  it('refuses a key withdrawn before this process ever saw it (the documented limit)', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google2.jwk] });
    expect((await checkOidcProviderKey(oidcPublicInputs(google.n, 0))).ok).toBe(false);
  });

  it('picks up a key published after the set was cached, with one refetch', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=86400');
    await checkOidcProviderKey(oidcPublicInputs(google.n, 0));
    fetchMock.mockResolvedValue(jwksResponse([google.jwk, google2.jwk], 'max-age=86400') as never);
    vi.setSystemTime(Date.now() + MIN_REFETCH_INTERVAL_MS);
    expect((await checkOidcProviderKey(oidcPublicInputs(google2.n, 0))).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refetch for every unknown key: a flood of forged proofs is not a flood of requests', async () => {
    const fetchMock = serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] }, 'max-age=86400');
    await checkOidcProviderKey(oidcPublicInputs(google.n, 0));
    for (let i = 0; i < 20; i++) {
      expect((await checkOidcProviderKey(oidcPublicInputs(forged.n, 0))).ok).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers many concurrent checks correctly', async () => {
    serveJwks({ [GOOGLE_JWKS_URL]: [google.jwk] });
    const results = await Promise.all([
      ...Array(10).fill(0).map(() => checkOidcProviderKey(oidcPublicInputs(google.n, 0))),
      ...Array(10).fill(0).map(() => checkOidcProviderKey(oidcPublicInputs(forged.n, 0))),
    ]);
    expect(results.map(r => r.ok)).toEqual([...Array(10).fill(true), ...Array(10).fill(false)]);
  });
});

it('modulusOf and the limb layout agree (fixture self-check)', () => {
  const inputs = oidcPublicInputs(google.n, 0);
  let m = 0n;
  for (let i = 17; i >= 0; i--) m = (m << 120n) | BigInt(inputs[i]);
  expect(m).toBe(modulusOf(google.n));
});
