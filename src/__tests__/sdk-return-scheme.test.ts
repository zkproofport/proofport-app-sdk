import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { validateReturnScheme, MAX_RETURN_SCHEME_LENGTH } from '../deeplink';

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

  it('accepts an https origin, with and without a port', () => {
    expect(validateReturnScheme('https://myapp.com')).toBeNull();
    expect(validateReturnScheme('https://myapp.com:8443')).toBeNull();
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

  it('sends an https origin unchanged', async () => {
    const fetchMock = mockRelayOk();
    const sdk = createSDKWithSigner();

    await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
      returnScheme: 'https://myapp.com',
    });

    expect(requestBody(fetchMock).returnScheme).toBe('https://myapp.com');
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
