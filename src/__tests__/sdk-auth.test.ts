import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

describe('SDK Challenge-Signature Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setSigner', () => {
    it('accepts a wallet signer object', () => {
      const sdk = ProofportSDK.create('local');
      const mockSigner = {
        signMessage: vi.fn().mockResolvedValue('0xsig'),
        getAddress: vi.fn().mockResolvedValue('0xaddr'),
      };
      // Should not throw
      sdk.setSigner(mockSigner);
    });
  });

  describe('getChallenge', () => {
    it('fetches challenge from relay', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          challenge: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          expiresAt: Date.now() + 120000,
        }),
      });

      const sdk = ProofportSDK.create('local');
      const result = await sdk.getChallenge();

      expect(result.challenge).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4001/api/v1/challenge');
    });

    it('throws if relayUrl not configured', async () => {
      const sdk = new ProofportSDK();
      await expect(sdk.getChallenge()).rejects.toThrow('relayUrl is required');
    });

    it('throws on HTTP error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      const sdk = ProofportSDK.create('local');
      await expect(sdk.getChallenge()).rejects.toThrow('Server error');
    });
  });

  describe('removed auth methods', () => {
    it('does not have login method', () => {
      const sdk = ProofportSDK.create('local');
      expect((sdk as any).login).toBeUndefined();
    });

    it('does not have logout method', () => {
      const sdk = ProofportSDK.create('local');
      expect((sdk as any).logout).toBeUndefined();
    });

    it('does not have isAuthenticated method', () => {
      const sdk = ProofportSDK.create('local');
      expect((sdk as any).isAuthenticated).toBeUndefined();
    });

    it('does not have getAuthToken method', () => {
      const sdk = ProofportSDK.create('local');
      expect((sdk as any).getAuthToken).toBeUndefined();
    });

    it('does not have static authenticate method', () => {
      expect((ProofportSDK as any).authenticate).toBeUndefined();
    });

    it('does not have static isTokenValid method', () => {
      expect((ProofportSDK as any).isTokenValid).toBeUndefined();
    });
  });
});
