import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { ethers } from 'ethers';

function createMockPublicInputs(count: number, fillByte = '0x01'): string[] {
  return Array.from({ length: count }, () => fillByte);
}

describe('ProofportSDK Nullifier Methods', () => {
  describe('extractNullifier', () => {
    it('returns hex string for coinbase_attestation with sufficient inputs', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(128, '0x42');

      const nullifier = sdk.extractNullifier(publicInputs, 'coinbase_attestation');

      expect(nullifier).toBeDefined();
      expect(typeof nullifier).toBe('string');
      expect(nullifier?.startsWith('0x')).toBe(true);
      expect(nullifier?.length).toBe(66); // 0x + 64 hex chars (32 bytes)
    });

    it('returns null for insufficient inputs', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(100);

      const nullifier = sdk.extractNullifier(publicInputs, 'coinbase_attestation');

      expect(nullifier).toBeNull();
    });

    it('extracts nullifier from indices 118-149 for coinbase_country_attestation', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(150, '0xaa');

      const nullifier = sdk.extractNullifier(publicInputs, 'coinbase_country_attestation');

      expect(nullifier).toBeDefined();
      expect(typeof nullifier).toBe('string');
      expect(nullifier?.startsWith('0x')).toBe(true);
      expect(nullifier?.length).toBe(66);
    });

    it('returns null for coinbase_country_attestation with insufficient inputs', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(140);

      const nullifier = sdk.extractNullifier(publicInputs, 'coinbase_country_attestation');

      expect(nullifier).toBeNull();
    });
  });

  describe('extractScope', () => {
    it('returns hex string for coinbase_attestation with sufficient inputs', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(128, '0x33');

      const scope = sdk.extractScope(publicInputs, 'coinbase_attestation');

      expect(scope).toBeDefined();
      expect(typeof scope).toBe('string');
      expect(scope?.startsWith('0x')).toBe(true);
      expect(scope?.length).toBe(66);
    });

    it('returns null for insufficient inputs', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(50);

      const scope = sdk.extractScope(publicInputs, 'coinbase_attestation');

      expect(scope).toBeNull();
    });

    it('extracts scope from indices 86-117 for coinbase_country_attestation', () => {
      const sdk = new ProofportSDK();
      const publicInputs = createMockPublicInputs(150, '0xbb');

      const scope = sdk.extractScope(publicInputs, 'coinbase_country_attestation');

      expect(scope).toBeDefined();
      expect(typeof scope).toBe('string');
      expect(scope?.startsWith('0x')).toBe(true);
      expect(scope?.length).toBe(66);
    });
  });

  describe('checkNullifier', () => {
    it('queries registry contract and returns boolean', async () => {
      const sdk = new ProofportSDK({
        nullifierRegistry: {
          address: '0xRegistryAddress1234567890abcdef12345678',
          chainId: 84532,
        },
      });

      (ethers.Contract as any).mockImplementation(function (this: any) {
        this.isNullifierRegistered = vi.fn().mockResolvedValue(true);
      });

      const isRegistered = await sdk.checkNullifier('0xnullifier123');

      expect(isRegistered).toBe(true);
    });

    it('throws if nullifierRegistry not configured', async () => {
      const sdk = new ProofportSDK();

      await expect(
        sdk.checkNullifier('0xnullifier123')
      ).rejects.toThrow('nullifierRegistry is required');
    });
  });

  describe('getNullifierDetails', () => {
    it('returns record for registered nullifier', async () => {
      const sdk = new ProofportSDK({
        nullifierRegistry: {
          address: '0xRegistryAddress1234567890abcdef12345678',
          chainId: 84532,
        },
      });

      (ethers.Contract as any).mockImplementation(function (this: any) {
        this.getNullifierInfo = vi.fn().mockResolvedValue([
          1707234567n,
          '0xscope',
          '0xcircuit',
        ]);
      });

      const details = await sdk.getNullifierDetails('0xnullifier123');

      expect(details).toEqual({
        registeredAt: 1707234567,
        scope: '0xscope',
        circuitId: '0xcircuit',
      });
    });

    it('throws if nullifierRegistry not configured', async () => {
      const sdk = new ProofportSDK();

      await expect(
        sdk.getNullifierDetails('0xnullifier123')
      ).rejects.toThrow('nullifierRegistry is required');
    });
  });
});
