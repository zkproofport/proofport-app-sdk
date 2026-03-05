import { describe, it, expect } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

describe('ProofportSDK Factory and Static Methods', () => {
  describe('ProofportSDK.create()', () => {
    it('should create SDK instance with production relay URL when no args provided', () => {
      const sdk = ProofportSDK.create();
      expect(sdk).toBeInstanceOf(ProofportSDK);
    });

    it('should create SDK instance with staging relay URL when "staging" provided', () => {
      const sdk = ProofportSDK.create('staging');
      expect(sdk).toBeInstanceOf(ProofportSDK);
    });

    it('should create SDK instance with local relay URL when "local" provided', () => {
      const sdk = ProofportSDK.create('local');
      expect(sdk).toBeInstanceOf(ProofportSDK);
    });

    it('should create SDK instance with custom config object', () => {
      const sdk = ProofportSDK.create({ relayUrl: 'https://custom-relay.example.com' });
      expect(sdk).toBeInstanceOf(ProofportSDK);
    });

    it('should throw error for invalid environment string', () => {
      expect(() => ProofportSDK.create('invalid' as any)).toThrow('Unknown environment: invalid');
    });
  });

  describe('ProofportSDK.isMobile()', () => {
    it('should return false in node environment where navigator is undefined', () => {
      expect(ProofportSDK.isMobile()).toBe(false);
    });
  });
});
