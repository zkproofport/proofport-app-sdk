import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

const mockAuthResponse = {
  token: 'jwt-token-123',
  client_id: 'test-client',
  dapp_id: 'dapp-123',
  tier: 'free',
  expires_in: 3600,
};

const mockRelayResponse = {
  requestId: 'relay-req-123',
  deepLink: 'zkproofport://proof-request?data=abc',
  status: 'pending',
  pollUrl: '/api/v1/proof/relay-req-123',
};

async function createAuthenticatedSDK() {
  const sdk = ProofportSDK.create('local');
  (global.fetch as any).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(mockAuthResponse),
  });
  await sdk.login({ clientId: 'test', apiKey: 'key' });
  return sdk;
}

describe('SDK Relay Methods', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createRelayRequest', () => {
    it('throws if not authenticated', async () => {
      const sdk = ProofportSDK.create('local');

      await expect(
        sdk.createRelayRequest('coinbase_attestation', {
          verifier_id: '0x123',
          signal_hash: '0xabc',
          scope: '0xdef',
        })
      ).rejects.toThrow('Not authenticated. Call login() first.');
    });

    it('sends correct POST body with Bearer token', async () => {
      const sdk = await createAuthenticatedSDK();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const inputs = {
        verifier_id: '0x123',
        signal_hash: '0xabc',
        scope: '0xdef',
      };

      await sdk.createRelayRequest('coinbase_attestation', inputs);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4001/api/v1/proof/request',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer jwt-token-123',
          },
          body: JSON.stringify({
            circuitId: 'coinbase_attestation',
            inputs,
          }),
        })
      );
    });

    it('returns RelayProofRequest', async () => {
      const sdk = await createAuthenticatedSDK();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const result = await sdk.createRelayRequest('coinbase_attestation', {
        verifier_id: '0x123',
        signal_hash: '0xabc',
        scope: '0xdef',
      });

      expect(result).toEqual({
        requestId: 'relay-req-123',
        deepLink: 'zkproofport://proof-request?data=abc',
        status: 'pending',
        pollUrl: '/api/v1/proof/relay-req-123',
      });
    });

    it('includes optional fields (dappName, message, nonce)', async () => {
      const sdk = await createAuthenticatedSDK();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRelayResponse),
      });

      const inputs = {
        verifier_id: '0x123',
        signal_hash: '0xabc',
        scope: '0xdef',
      };

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
      });
    });

    it('throws on relay error', async () => {
      const sdk = await createAuthenticatedSDK();

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Relay unavailable' }),
      });

      await expect(
        sdk.createRelayRequest('coinbase_attestation', {
          verifier_id: '0x123',
          signal_hash: '0xabc',
          scope: '0xdef',
        })
      ).rejects.toThrow('Relay unavailable');
    });
  });

  describe('pollResult', () => {
    it('sends GET with correct URL', async () => {
      const sdk = await createAuthenticatedSDK();

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
      const sdk = await createAuthenticatedSDK();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'relay-req-123',
            status: 'pending',
          }),
      });

      const result = await sdk.pollResult('relay-req-123');

      expect(result).toEqual({
        requestId: 'relay-req-123',
        status: 'pending',
      });
    });

    it('returns completed with proof data', async () => {
      const sdk = await createAuthenticatedSDK();

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
      const sdk = await createAuthenticatedSDK();

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
      const sdk = await createAuthenticatedSDK();

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
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('calls onStatusChange callback', async () => {
      const sdk = await createAuthenticatedSDK();

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
      const sdk = await createAuthenticatedSDK();

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
