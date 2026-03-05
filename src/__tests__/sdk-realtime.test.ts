import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

function createSDK() {
  return ProofportSDK.create('local');
}

describe('SDK Real-Time Socket.IO Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribe() throws if relayUrl not configured', async () => {
    const sdk = new ProofportSDK();

    await expect(
      sdk.subscribe('request-123', {})
    ).rejects.toThrow('relayUrl is required');
  });

  it('subscribe() connects to correct namespace without auth token', async () => {
    const sdk = createSDK();
    const { io } = await import('socket.io-client');

    await sdk.subscribe('request-123', {});

    expect(io).toHaveBeenCalledWith('http://localhost:4001/proof', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });
  });

  it('subscribe() emits proof:subscribe on connect', async () => {
    const sdk = createSDK();
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
    const sdk = createSDK();
    const { __mockSocket: mockSocket } = await import('socket.io-client') as any;

    const unsubscribe = await sdk.subscribe('request-789', {});

    unsubscribe();

    expect(mockSocket.off).toHaveBeenCalledWith('proof:status');
    expect(mockSocket.off).toHaveBeenCalledWith('proof:result');
    expect(mockSocket.off).toHaveBeenCalledWith('proof:error');
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('disconnect() closes socket connection', async () => {
    const sdk = createSDK();
    const { __mockSocket: mockSocket } = await import('socket.io-client') as any;

    await sdk.subscribe('request-disconnect', {});

    sdk.disconnect();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('disconnect() is no-op when no socket exists', () => {
    const sdk = createSDK();
    expect(() => sdk.disconnect()).not.toThrow();
  });
});
