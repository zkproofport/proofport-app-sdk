import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { validateReturnScheme, detectReturnScheme, MAX_RETURN_SCHEME_LENGTH } from '../deeplink';

/**
 * `returnScheme` — the optional "which app should ZKProofport switch back to"
 * field. Row numbers refer to the edge-case matrix planned before implementation.
 */

const mockChallengeResponse = {
  requestId: 'relay-req-123',
  challenge: '0xchallenge123456789abcdef',
  expiresAt: Date.now() + 120000,
};

const mockRelayResponse = {
  requestId: 'relay-req-123',
  deepLink: 'zkproofport://proof-request?data=abc',
  status: 'pending',
  pollUrl: '/api/v1/proof/relay-req-123',
};

const mockSigner = {
  signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
  getAddress: vi.fn().mockResolvedValue('0xmockaddress'),
};

function createSDKWithSigner() {
  const sdk = ProofportSDK.create('local');
  sdk.setSigner(mockSigner);
  return sdk;
}

function mockRelayOk() {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => mockChallengeResponse })
    .mockResolvedValueOnce({ ok: true, json: async () => mockRelayResponse });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Body of the POST /api/v1/proof/request call. */
function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/proof/request'));
  return JSON.parse((call![1] as RequestInit).body as string);
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------
describe('validateReturnScheme', () => {
  it('accepts a bare custom scheme', () => {
    expect(validateReturnScheme('mydapp://')).toBeNull();
  });

  /**
   * The https-origin form is gone. Opening one launches a NEW browser tab on a
   * freshly loaded page instead of returning the user to the tab they started
   * from — the round trip the field exists to complete is exactly what it
   * destroyed. These are the regression guard.
   */
  it.each([
    'https://myapp.com',
    'https://myapp.com:8443',
    'https://demo.zkproofport.app',
    'HTTPS://MyApp.COM',
    'https://localhost',
  ])('rejects the https origin %s', (value) => {
    expect(validateReturnScheme(value)).not.toBeNull();
  });

  it('explains the scheme-only rule when handed a URL-shaped value', () => {
    expect(validateReturnScheme('https://myapp.com')).toMatch(/bare custom scheme/);
  });

  // The back door the shape rule alone leaves open: with no host these are
  // shaped exactly like a bare custom scheme, so only the denied list stops them.
  it.each(['https://', 'http://', 'HTTPS://', 'HtTp://'])(
    'rejects the host-less browser scheme %s as denied',
    (value) => {
      expect(validateReturnScheme(value)).toMatch(/not allowed/);
    },
  );

  it('accepts googlechrome://, which the SDK sends for Chrome on iOS', () => {
    expect(validateReturnScheme('googlechrome://')).toBeNull();
  });

  // Row 11: null and undefined checked separately
  it('rejects undefined and null distinctly', () => {
    expect(validateReturnScheme(undefined)).toMatch(/must be a string/);
    expect(validateReturnScheme(null)).toMatch(/must be a string/);
  });

  // Row 9 / 10
  it('rejects empty and whitespace-only values', () => {
    expect(validateReturnScheme('')).toMatch(/empty/);
    expect(validateReturnScheme('   ')).toMatch(/whitespace/);
    expect(validateReturnScheme('\t')).toMatch(/whitespace/);
  });

  // Rows 2-5, 13
  it('honours the length boundary', () => {
    const atCap = 'a'.repeat(MAX_RETURN_SCHEME_LENGTH - 3) + '://';
    const overCap = 'a'.repeat(MAX_RETURN_SCHEME_LENGTH - 2) + '://';
    expect(atCap.length).toBe(MAX_RETURN_SCHEME_LENGTH);
    expect(validateReturnScheme(atCap)).toBeNull();
    expect(validateReturnScheme(overCap)).toMatch(/at most/);
    expect(validateReturnScheme('a://')).toBeNull();
  });

  it('rejects a 100k-character value without running the regex on it', () => {
    const started = Date.now();
    expect(validateReturnScheme('a'.repeat(100_000) + '://')).toMatch(/at most/);
    expect(Date.now() - started).toBeLessThan(100);
  });

  // Row 6
  it.each([
    'javascript://',
    'data://',
    'file://',
    'http://',
    'intent://',
    'tel://',
    'sms://',
    'mailto://',
    'JavaScript://',
  ])('rejects the denied scheme %s', (value) => {
    expect(validateReturnScheme(value)).not.toBeNull();
  });

  // Row 7
  it.each([
    'mydapp://x',
    'mydapp://a?b=1',
    'mydapp://a#b',
    'https://evil.example.com/pay?amount=1000',
    'https://evil.example.com/',
    'https://user:pass@evil.example.com',
  ])('rejects the URL-shaped value %s', (value) => {
    expect(validateReturnScheme(value)).not.toBeNull();
  });

  // Rows 8, 12, 19
  it.each([
    'mydapp://\n',
    'my dapp://',
    '<script>://',
    '앱://',
    '🚀://',
    'https://한글.com',
    'notaurl',
    'mydapp:',
    '://',
  ])('rejects the malformed value %j', (value) => {
    expect(validateReturnScheme(value)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createRelayRequest pass-through
// ---------------------------------------------------------------------------
describe('createRelayRequest — returnScheme', () => {
  beforeEach(() => {
    mockSigner.signMessage.mockClear();
  });

  // Row 16 (contract): removing the pass-through line breaks this test.
  it('sends returnScheme in the relay request body', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
      dappName: 'My DApp',
      returnScheme: 'mydapp://',
    });

    expect(requestBody(fetchMock).returnScheme).toBe('mydapp://');
  });

  it('refuses an https origin before any network call', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await expect(
      sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
        returnScheme: 'https://myapp.com',
      }),
    ).rejects.toThrow(/returnScheme/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends googlechrome:// unchanged when named explicitly', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
      returnScheme: 'googlechrome://',
    });

    expect(requestBody(fetchMock).returnScheme).toBe('googlechrome://');
  });

  // Row 1: omitted field
  it('omits returnScheme entirely when not supplied, and still creates the request', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    const relay = await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' });

    expect('returnScheme' in requestBody(fetchMock)).toBe(false);
    expect(relay.requestId).toBe('relay-req-123');
  });

  // Rows 9, 10: empty / whitespace never reaches the wire
  it.each(['', '   '])('rejects %j before any network call', async (value) => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await expect(
      sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, { returnScheme: value })
    ).rejects.toThrow(/returnScheme/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Rows 6, 7, 8, 19
  it.each([
    'javascript://',
    'https://evil.example.com/pay?amount=1000',
    'mydapp://transfer?to=0xattacker',
    'notaurl',
    'a'.repeat(200) + '://',
  ])('rejects the hostile value %j before any network call', async (value) => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await expect(
      sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, { returnScheme: value })
    ).rejects.toThrow(/returnScheme/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not consume a challenge when the value is rejected', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await expect(
      sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, { returnScheme: 'file://' })
    ).rejects.toThrow();

    expect(mockSigner.signMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// detectReturnScheme — what the SDK sends when the integrator named nothing
// ---------------------------------------------------------------------------
/**
 * Real user agents. The rule is deliberately narrow: a POSITIVE `CriOS` token
 * on an iOS device produces `googlechrome://`, and every other browser produces
 * nothing. Inferring "Safari" by elimination would eject Brave and Arc users
 * into a browser they were not using, which is worse than doing nothing.
 */
const UA = {
  chromeIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  chromeIPad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  safariIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // Brave for iOS ships NO distinguishing token — this is byte-identical in
  // shape to Safari, which is exactly why elimination is not safe.
  braveIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefoxIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15',
  edgeIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/125.0.2535.60 Mobile/15E148 Safari/604.1',
  operaIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPT/4.7.0 Mobile/15E148',
  kakaoTalkIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5',
  naverIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.9.2)',
  instagramIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.72 Mobile Safari/537.36',
  chromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.76 Safari/537.36',
  safariDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  edgeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51',
};

describe('detectReturnScheme', () => {
  it('returns googlechrome:// for Chrome on iPhone', () => {
    expect(detectReturnScheme(UA.chromeIOS)).toBe('googlechrome://');
  });

  it('returns googlechrome:// for Chrome on iPad', () => {
    expect(detectReturnScheme(UA.chromeIPad)).toBe('googlechrome://');
  });

  /**
   * Verified in mozilla-mobile/firefox-ios: `firefox://` has an empty host, so
   * `DeeplinkInput.Host(rawValue: "")` is nil, `RouteBuilder.makeRoute(url:)`
   * falls to `else { return nil }`, and `SceneDelegate.handleOpenURL` returns
   * from its `guard let route` without doing anything. Foreground, no navigation.
   */
  it('returns firefox:// for Firefox on iOS', () => {
    expect(detectReturnScheme(UA.firefoxIOS)).toBe('firefox://');
  });

  it('produces only schemes the validator accepts', () => {
    for (const ua of [UA.chromeIOS, UA.chromeIPad, UA.firefoxIOS]) {
      const scheme = detectReturnScheme(ua)!;
      expect(scheme).not.toBeUndefined();
      expect(validateReturnScheme(scheme)).toBeNull();
    }
  });

  it('never returns a scheme for a browser whose behaviour is unverified', () => {
    // Edge and Opera are closed source. If someone adds them without evidence,
    // this fails and they have to justify it.
    expect(detectReturnScheme(UA.edgeIOS)).toBeUndefined();
    expect(detectReturnScheme(UA.operaIOS)).toBeUndefined();
  });

  // The load-bearing negatives: every one of these must send NOTHING.
  it.each([
    ['Safari on iOS', UA.safariIOS],
    ['Brave on iOS (indistinguishable from Safari)', UA.braveIOS],
    ['Edge on iOS (closed source, bare scheme unverified)', UA.edgeIOS],
    ['Opera on iOS (closed source, bare scheme unverified)', UA.operaIOS],
    ['the KakaoTalk in-app webview', UA.kakaoTalkIOS],
    ['the Naver in-app webview', UA.naverIOS],
    ['the Instagram in-app webview', UA.instagramIOS],
  ])('sends nothing for %s', (_label, ua) => {
    expect(detectReturnScheme(ua)).toBeUndefined();
  });

  // Android resumes the browser via moveTaskToBack in the app — no field needed.
  it('sends nothing on Android, where the app backgrounds itself instead', () => {
    expect(detectReturnScheme(UA.chromeAndroid)).toBeUndefined();
  });

  // Desktop is the QR flow: the proof happens on a different device entirely.
  it.each([
    ['desktop Chrome', UA.chromeDesktop],
    ['desktop Safari', UA.safariDesktop],
    ['desktop Firefox', UA.firefoxDesktop],
    ['desktop Edge', UA.edgeDesktop],
  ])('sends nothing on %s', (_label, ua) => {
    expect(detectReturnScheme(ua)).toBeUndefined();
  });

  it('never confuses desktop Firefox with Firefox for iOS', () => {
    // `Firefox/` is desktop and Android; `FxiOS/` is iOS only.
    expect(UA.firefoxDesktop).toContain('Firefox/');
    expect(UA.firefoxDesktop).not.toContain('FxiOS');
    expect(detectReturnScheme(UA.firefoxDesktop)).toBeUndefined();
  });

  it('never confuses desktop Chrome with Chrome for iOS', () => {
    // `Chrome/` is desktop and Android; `CriOS/` is iOS only. Keying on the
    // wrong one would fire the scheme on every Chrome on earth.
    expect(UA.chromeDesktop).toContain('Chrome/');
    expect(UA.chromeDesktop).not.toContain('CriOS');
    expect(detectReturnScheme(UA.chromeDesktop)).toBeUndefined();
  });

  // Empty / absent / hostile inputs — each shape separately.
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a lone token', 'CriOS'],
    ['CriOS without a device token', 'Mozilla/5.0 CriOS/125.0.0.0'],
    ['an iOS device without CriOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'],
    ['a UTF-8 string', '아이폰 크롬 🚀'],
    ['a lookalike token', 'Mozilla/5.0 (iPhone) NotCriOSReally'],
  ])('sends nothing for %s', (_label, ua) => {
    expect(detectReturnScheme(ua)).toBeUndefined();
  });

  it('sends nothing for a very large user agent without hanging', () => {
    const started = Date.now();
    expect(detectReturnScheme('a'.repeat(200_000))).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('returns a value the validator accepts, so the relay cannot 400 on it', () => {
    expect(validateReturnScheme(detectReturnScheme(UA.chromeIOS))).toBeNull();
    expect(validateReturnScheme(detectReturnScheme(UA.firefoxIOS))).toBeNull();
  });

  describe('without a browser', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends nothing when there is no navigator at all (Node / SSR)', () => {
      vi.stubGlobal('navigator', undefined);
      expect(detectReturnScheme()).toBeUndefined();
    });

    it('sends nothing when navigator carries no user agent', () => {
      vi.stubGlobal('navigator', {});
      expect(detectReturnScheme()).toBeUndefined();
    });

    it('reads navigator.userAgent when no override is passed', () => {
      vi.stubGlobal('navigator', { userAgent: UA.chromeIOS });
      expect(detectReturnScheme()).toBe('googlechrome://');
    });
  });
});

// ---------------------------------------------------------------------------
// createRelayRequest — the automatic fill
// ---------------------------------------------------------------------------
describe('createRelayRequest — automatic returnScheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills in googlechrome:// by itself on Chrome for iOS', async () => {
    vi.stubGlobal('navigator', { userAgent: UA.chromeIOS });
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' });

    expect(requestBody(fetchMock).returnScheme).toBe('googlechrome://');
  });

  it.each([
    ['Safari on iOS', UA.safariIOS],
    ['an in-app webview', UA.kakaoTalkIOS],
    ['Android', UA.chromeAndroid],
    ['desktop Chrome', UA.chromeDesktop],
  ])('omits the field entirely on %s', async (_label, ua) => {
    vi.stubGlobal('navigator', { userAgent: ua });
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    const relay = await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' });

    expect('returnScheme' in requestBody(fetchMock)).toBe(false);
    expect(relay.requestId).toBe('relay-req-123');
  });

  // Contract: an explicit value is the integrator's decision and always wins.
  it('never overrides an explicit value with the detected one', async () => {
    vi.stubGlobal('navigator', { userAgent: UA.chromeIOS });
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
      returnScheme: 'mydapp://',
    });

    expect(requestBody(fetchMock).returnScheme).toBe('mydapp://');
  });

  // ...and an explicit BAD value is still rejected rather than quietly replaced.
  it('rejects an explicit bad value instead of falling back to detection', async () => {
    vi.stubGlobal('navigator', { userAgent: UA.chromeIOS });
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await expect(
      sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
        returnScheme: 'https://myapp.com',
      }),
    ).rejects.toThrow(/returnScheme/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
