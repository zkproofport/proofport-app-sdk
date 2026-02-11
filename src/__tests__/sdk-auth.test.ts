import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

const mockAuthResponse = {
  token: 'jwt-token-123',
  client_id: 'test-client',
  dapp_id: 'dapp-123',
  tier: 'free',
  expires_in: 3600,
};

describe('SDK Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login() sends POST with correct body', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const sdk = ProofportSDK.create('local');
    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4001/api/v1/auth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'test-client', api_key: 'test-key' }),
      }
    );
  });

  it('login() stores auth token internally', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const sdk = ProofportSDK.create('local');
    expect(sdk.isAuthenticated()).toBe(false);

    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });

    expect(sdk.isAuthenticated()).toBe(true);
  });

  it('login() throws if relayUrl not configured', async () => {
    const sdk = new ProofportSDK();

    await expect(
      sdk.login({ clientId: 'test-client', apiKey: 'test-key' })
    ).rejects.toThrow('relayUrl is required');
  });

  it('login() throws on 401', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Invalid credentials' }),
    });

    const sdk = ProofportSDK.create('local');

    await expect(
      sdk.login({ clientId: 'test-client', apiKey: 'test-key' })
    ).rejects.toThrow('Invalid credentials');
  });

  it('login() throws on network error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const sdk = ProofportSDK.create('local');

    await expect(
      sdk.login({ clientId: 'test-client', apiKey: 'test-key' })
    ).rejects.toThrow('Network error');
  });

  it('isAuthenticated() returns false before login', () => {
    const sdk = ProofportSDK.create('local');
    expect(sdk.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated() returns true after login', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const sdk = ProofportSDK.create('local');
    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });

    expect(sdk.isAuthenticated()).toBe(true);
  });

  it('isAuthenticated() returns false after token expires', async () => {
    const expiredResponse = {
      ...mockAuthResponse,
      expires_in: -1,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(expiredResponse),
    });

    const sdk = ProofportSDK.create('local');
    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });

    expect(sdk.isAuthenticated()).toBe(false);
  });

  it('getAuthToken() returns null before login, token after', async () => {
    const sdk = ProofportSDK.create('local');
    expect(sdk.getAuthToken()).toBeNull();

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });

    const token = sdk.getAuthToken();
    expect(token).not.toBeNull();
    expect(token?.token).toBe('jwt-token-123');
    expect(token?.clientId).toBe('test-client');
  });

  it('logout() clears stored token', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const sdk = ProofportSDK.create('local');
    await sdk.login({ clientId: 'test-client', apiKey: 'test-key' });
    expect(sdk.isAuthenticated()).toBe(true);

    sdk.logout();

    expect(sdk.isAuthenticated()).toBe(false);
    expect(sdk.getAuthToken()).toBeNull();
  });
});
