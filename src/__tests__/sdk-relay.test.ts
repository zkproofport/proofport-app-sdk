import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

const mockChallengeResponse = {
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

describe('SDK Relay Methods', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    mockSigner.signMessage.mockClear();
    mockSigner.getAddress.mockClear();
    mockSigner.signMessage.mockResolvedValue('0xmocksignature');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createRelayRequest', () => {
    it('throws if signer not set', async () => {
      const sdk = ProofportSDK.create('local');

      await expect(
        sdk.createRelayRequest('coinbase_attestation', {
          scope: '0xdef',
        })
      ).rejects.toThrow('Signer not set. Call setSigner() first.');
    });

    it('gets challenge, signs it, and sends request with challenge+signature', async () => {
      const sdk = createSDKWithSigner();

      // Mock getChallenge
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockChallengeResponse),
      });

      // Mock proof request
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const inputs = { scope: '0xdef' };

      await sdk.createRelayRequest('coinbase_attestation', inputs);

      // Verify signer was called with the challenge
      expect(mockSigner.signMessage).toHaveBeenCalledWith(mockChallengeResponse.challenge);

      // Verify the proof request body
      const proofRequestCall = (global.fetch as any).mock.calls[1];
      expect(proofRequestCall[0]).toBe('http://localhost:4001/api/v1/proof/request');
      const body = JSON.parse(proofRequestCall[1].body);
      expect(body.challenge).toBe(mockChallengeResponse.challenge);
      expect(body.signature).toBe('0xmocksignature');
      expect(body.circuitId).toBe('coinbase_attestation');
      expect(body.inputs).toEqual(inputs);

      // No Authorization header
      expect(proofRequestCall[1].headers).toEqual({
        'Content-Type': 'application/json',
      });
    });

    it('returns RelayProofRequest', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockChallengeResponse),
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const result = await sdk.createRelayRequest('coinbase_attestation', {
        scope: '0xdef',
      });

      expect(result).toEqual(mockRelayResponse);
    });

    it('includes optional fields (dappName, message, nonce)', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockChallengeResponse),
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const inputs = { scope: '0xdef' };

      await sdk.createRelayRequest('coinbase_attestation', inputs, {
        dappName: 'Test dApp',
        message: 'Please verify',
        nonce: '12345',
        dappIcon: 'https://example.com/icon.png',
      });

      const callBody = JSON.parse(
        (global.fetch as any).mock.calls[1][1].body
      );

      expect(callBody).toMatchObject({
        circuitId: 'coinbase_attestation',
        inputs,
        dappName: 'Test dApp',
        message: 'Please verify',
        nonce: '12345',
        dappIcon: 'https://example.com/icon.png',
        challenge: mockChallengeResponse.challenge,
        signature: '0xmocksignature',
      });
    });

    describe('copies the scope onto the envelope for the relay to count', () => {
      async function sentBody(inputs: Record<string, unknown>) {
        const sdk = createSDKWithSigner();
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockChallengeResponse),
        });
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRelayResponse),
        });
        await sdk.createRelayRequest('coinbase_attestation', inputs as any);
        return JSON.parse((global.fetch as any).mock.calls[1][1].body);
      }

      it.each([
        ['a domain', 'myapp.com'],
        ['one character', 'a'],
        ['whitespace only, left for the relay to judge', '   '],
        ['Korean and emoji', '도장🔏 앱'],
        ['newlines, tabs and markup', 'a\n\tb<script>%_\\'],
        ['longer than the relay counts', 'x'.repeat(5000)],
      ])('%s: sent unchanged, and inputs keep it too', async (_name, scope) => {
        const body = await sentBody({ scope });
        expect(body.scope).toBe(scope);
        expect(body.inputs.scope).toBe(scope);
      });

      it.each([
        ['missing', {}],
        ['empty', { scope: '' }],
        ['null', { scope: null }],
        ['a number', { scope: 42 }],
        ['an object', { scope: { host: 'myapp.com' } }],
      ])('%s: no envelope scope is sent', async (_name, inputs) => {
        const body = await sentBody(inputs);
        expect('scope' in body).toBe(false);
        expect(body.inputs).toEqual(inputs);
      });

      it('does not change the caller\'s inputs object', async () => {
        const inputs = { scope: 'myapp.com' };
        await sentBody(inputs);
        expect(inputs).toEqual({ scope: 'myapp.com' });
      });
    });

    it('throws on relay error', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockChallengeResponse),
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Relay unavailable' }),
      });

      await expect(
        sdk.createRelayRequest('coinbase_attestation', { scope: '0xdef' })
      ).rejects.toThrow('Relay unavailable');
    });
  });

  describe('pollResult', () => {
    it('sends GET without auth header', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'relay-req-123',
            status: 'pending',
          }),
      });

      await sdk.pollResult('relay-req-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4001/api/v1/proof/relay-req-123'
      );
    });

    it('returns pending status', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'relay-req-123',
            status: 'pending',
          }),
      });

      const result = await sdk.pollResult('relay-req-123');
      expect(result).toEqual({ requestId: 'relay-req-123', status: 'pending' });
    });

    it('returns completed with proof data', async () => {
      const sdk = createSDKWithSigner();

      const completedResponse = {
        requestId: 'relay-req-123',
        status: 'completed',
        proof: '0xproof123',
        publicInputs: ['0x1', '0x2'],
        verifier: '0xverifier',
        circuit: 'coinbase_attestation',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(completedResponse),
      });

      const result = await sdk.pollResult('relay-req-123');
      expect(result).toEqual(completedResponse);
    });

    it('throws on 404', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(sdk.pollResult('relay-req-123')).rejects.toThrow(
        'Request not found or expired'
      );
    });
  });

  describe('waitForResult', () => {
    it('polls until completed', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ requestId: 'relay-req-123', status: 'pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ requestId: 'relay-req-123', status: 'pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              requestId: 'relay-req-123',
              status: 'completed',
              proof: '0xproof',
            }),
        });

      const result = await sdk.waitForResult('relay-req-123', {
        intervalMs: 10,
        timeoutMs: 1000,
      });

      expect(result.status).toBe('completed');
      expect(result.proof).toBe('0xproof');
    });

    it('calls onStatusChange callback', async () => {
      const sdk = createSDKWithSigner();

      const statusChanges: any[] = [];

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ requestId: 'relay-req-123', status: 'pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              requestId: 'relay-req-123',
              status: 'processing',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              requestId: 'relay-req-123',
              status: 'completed',
              proof: '0xproof',
            }),
        });

      await sdk.waitForResult('relay-req-123', {
        intervalMs: 10,
        timeoutMs: 1000,
        onStatusChange: (result) => {
          statusChanges.push(result.status);
        },
      });

      expect(statusChanges).toEqual(['pending', 'processing', 'completed']);
    });

    it('throws on timeout', async () => {
      const sdk = createSDKWithSigner();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ requestId: 'relay-req-123', status: 'pending' }),
      });

      await expect(
        sdk.waitForResult('relay-req-123', {
          intervalMs: 50,
          timeoutMs: 100,
        })
      ).rejects.toThrow('Polling timed out after 100ms');
    });
  });
});
