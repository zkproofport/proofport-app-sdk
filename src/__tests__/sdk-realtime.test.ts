import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

const mockAuthResponse = {
  token: 'jwt-token-123',
  client_id: 'test-client',
  dapp_id: 'dapp-123',
  tier: 'free',
  expires_in: 3600,
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

describe('SDK Real-Time Socket.IO Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribe() throws if not authenticated', async () => {
    const sdk = ProofportSDK.create('local');

    await expect(
      sdk.subscribe('request-123', {})
    ).rejects.toThrow('Not authenticated. Call login() first.');
  });

  it('subscribe() connects to correct namespace with auth token', async () => {
    const sdk = await createAuthenticatedSDK();
    const { io } = await import('socket.io-client');

    await sdk.subscribe('request-123', {});

    expect(io).toHaveBeenCalledWith('http://localhost:4001/proof', {
      path: '/socket.io',
      auth: { token: 'jwt-token-123' },
      transports: ['websocket', 'polling'],
    });
  });

  it('subscribe() emits proof:subscribe on connect', async () => {
    const sdk = await createAuthenticatedSDK();
    const { __mockSocket: mockSocket } = await import('socket.io-client') as any;

    await sdk.subscribe('request-456', {});

    const connectCall = (mockSocket.on as any).mock.calls.find(
      (call: any[]) => call[0] === 'connect'
    );
    expect(connectCall).toBeDefined();

    connectCall[1]();

    expect(mockSocket.emit).toHaveBeenCalledWith('proof:subscribe', {
      requestId: 'request-456',
    });
  });

  it('subscribe() returns unsubscribe function that disconnects', async () => {
    const sdk = await createAuthenticatedSDK();
    const { __mockSocket: mockSocket } = await import('socket.io-client') as any;

    const unsubscribe = await sdk.subscribe('request-789', {});

    unsubscribe();

    expect(mockSocket.off).toHaveBeenCalledWith('proof:status');
    expect(mockSocket.off).toHaveBeenCalledWith('proof:result');
    expect(mockSocket.off).toHaveBeenCalledWith('proof:error');
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('disconnect() closes socket connection', async () => {
    const sdk = await createAuthenticatedSDK();
    const { __mockSocket: mockSocket } = await import('socket.io-client') as any;

    await sdk.subscribe('request-disconnect', {});

    sdk.disconnect();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('disconnect() is no-op when no socket exists', () => {
    const sdk = ProofportSDK.create('local');
    expect(() => sdk.disconnect()).not.toThrow();
  });
});
