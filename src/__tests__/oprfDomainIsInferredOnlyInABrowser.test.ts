/**
 * A wallet credential request's OPRF domain: the one the dApp passes; if it
 * passes none and the SDK runs in a browser, the page's own hostname,
 * lowercased; otherwise an error naming `oprfDomain`. Never an IP, never any
 * other fallback. User decision 2026-11-20.
 *
 * The browser is emulated by stubbing `window` and `location`, with the
 * location's fields taken from WHATWG `URL` (what a browser's Location
 * exposes): jsdom is not a dependency here. So "about:blank" and "file:" are
 * the URL parser's own protocol/hostname for those addresses.
 *
 * Matrix (drawn up before the code):
 *   browser, omitted     https://myapp.com -> 'myapp.com'; http:// too;
 *                        'MyApp.COM:8443/path?q#f' -> 'myapp.com' (case, no
 *                        port, path or query); a subdomain kept; IDN as the
 *                        URL parser's punycode
 *   browser, supplied    the dApp's value wins over the page, unchanged
 *   browser, no host     about:blank, file:///x, data:, blob: -> error
 *   browser, IP          127.0.0.1, 192.168.0.10:3000, [::1] -> error
 *   not a browser        Node (no window) -> error naming oprfDomain; a
 *                        location without a window -> error
 *   circuits             every wallet credential circuit; OIDC untouched
 *                        (no oprfDomain added)
 *   doors                createProofRequest (deep link) and createRelayRequest
 *                        (sent in inputs and remembered for verification);
 *                        the caller's inputs object is not changed
 *   name rules           an inferred hostname still passes oprfNameError;
 *                        a supplied invalid value is refused (requestScope)
 *   authz/race           N/A: synchronous input handling
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { withOprfDomain } from '../requestScope';
import { OPRF_CIRCUIT_IDS } from '../verifier';

function inBrowserAt(href: string) {
  const u = new URL(href);
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { href: u.href, protocol: u.protocol, hostname: u.hostname, host: u.host });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const extra = (circuit: string): Record<string, unknown> =>
  circuit === 'coinbase_country_attestation' ? { countryList: ['US'], isIncluded: true }
    : circuit === 'human_passport_score' ? { minScore: 20 }
      : {};
const deepLink = (circuit: string, inputs: Record<string, unknown>) =>
  (ProofportSDK.create('staging') as unknown as { createProofRequest: (c: string, i: unknown) => { inputs: Record<string, unknown> } })
    .createProofRequest(circuit, { ...extra(circuit), ...inputs });

describe.each(OPRF_CIRCUIT_IDS)('%s', circuit => {
  it.each([
    ['https://myapp.com/', 'myapp.com'],
    ['http://myapp.com/', 'myapp.com'],
    ['https://MyApp.COM:8443/path?q=1#f', 'myapp.com'],
    ['https://vote.myapp.com/', 'vote.myapp.com'],
    // An IDN host is what the URL parser (as a browser) gives: its punycode form.
    ['https://도장.한국/', 'xn--hq1b009a.xn--3e0b707e'],
  ])('in a browser at %s, an omitted oprfDomain is the page hostname %s', (href, expected) => {
    inBrowserAt(href);
    expect(deepLink(circuit, { scope: 'myapp.com' }).inputs.oprfDomain).toBe(expected);
  });

  it('a location reporting an upper-case hostname is lowercased', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'MyApp.COM' });
    expect(deepLink(circuit, { scope: 'myapp.com' }).inputs.oprfDomain).toBe('myapp.com');
  });

  it('in a browser, a supplied oprfDomain wins over the page', () => {
    inBrowserAt('https://other.example/');
    expect(deepLink(circuit, { scope: 'myapp.com', oprfDomain: 'MyApp.com' }).inputs.oprfDomain).toBe('MyApp.com');
  });

  it.each([
    ['about:blank', /has no web hostname/],
    ['file:///srv/site/index.html', /has no web hostname/],
    ['data:text/html,hi', /has no web hostname/],
    ['https://127.0.0.1/', /IP address \(127\.0\.0\.1\)/],
    ['http://192.168.0.10:3000/', /IP address \(192\.168\.0\.10\)/],
    ['https://[::1]/', /IP address \(\[::1\]\)/],
  ])('in a browser at %s, an omitted oprfDomain is an error', (href, why) => {
    inBrowserAt(href);
    expect(() => deepLink(circuit, { scope: 'myapp.com' })).toThrow(why);
    expect(() => deepLink(circuit, { scope: 'myapp.com' })).toThrow(`oprfDomain is required for ${circuit}`);
  });

  it('outside a browser, an omitted oprfDomain is an error naming it', () => {
    expect(() => deepLink(circuit, { scope: 'myapp.com' })).toThrow(
      `oprfDomain is required for ${circuit}: it is inferred from the page only in a browser, and this is not one.`,
    );
  });

  it('a location without a window is not a browser', () => {
    const u = new URL('https://myapp.com/');
    vi.stubGlobal('location', { protocol: u.protocol, hostname: u.hostname });
    expect(() => deepLink(circuit, { scope: 'myapp.com' })).toThrow(/only in a browser/);
  });
});

describe('the relay path', () => {
  function relaySdk() {
    const sdk = ProofportSDK.create('staging');
    sdk.setSigner({ signMessage: async () => '0x' + '22'.repeat(65), getAddress: async () => '0x' + '33'.repeat(20) } as never);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/challenge')) {
        return { ok: true, json: async () => ({ requestId: 'r-1', challenge: '0x' + '11'.repeat(32), expiresAt: Date.now() + 60000 }) };
      }
      return { ok: true, json: async () => ({ requestId: 'r-1', deepLink: 'zkproofport://x', status: 'pending', pollUrl: '/p' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return { sdk, fetchMock };
  }

  it('in a browser, sends and remembers the inferred domain, without changing the caller\'s inputs', async () => {
    inBrowserAt('https://Dapp.Example:444/x');
    const { sdk, fetchMock } = relaySdk();
    const inputs = { scope: 'myapp.com' };
    await sdk.createRelayRequest('coinbase_attestation', inputs);
    const body = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(body.inputs.oprfDomain).toBe('dapp.example');
    expect(inputs).toEqual({ scope: 'myapp.com' });
    expect((sdk as unknown as { relayRequests: Map<string, unknown> }).relayRequests.get('r-1')).toEqual({ scope: 'myapp.com', requestId: 'r-1', oprfDomain: 'dapp.example' });
  });

  it('outside a browser, refuses before any network call', async () => {
    const { sdk, fetchMock } = relaySdk();
    await expect(sdk.createRelayRequest('giwa_attestation', { scope: 'myapp.com' } as never)).rejects.toThrow(/oprfDomain is required for giwa_attestation/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what it leaves alone', () => {
  it('OIDC gets no oprfDomain, in a browser or not', () => {
    const inputs = { scope: 'myapp.com', domain: 'example.com' };
    expect(withOprfDomain('oidc_domain_attestation', inputs)).toBe(inputs);
    inBrowserAt('https://myapp.com/');
    expect(deepLink('oidc_domain_attestation', inputs).inputs).not.toHaveProperty('oprfDomain');
  });

  it('an invalid supplied oprfDomain is refused by the name rules, not replaced by the page', () => {
    inBrowserAt('https://myapp.com/');
    expect(() => deepLink('coinbase_attestation', { scope: 'myapp.com', oprfDomain: '' })).toThrow(/oprfDomain cannot be used for coinbase_attestation: empty/);
  });
});
