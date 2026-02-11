import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import type { ProofResponse } from '../types';

describe('SDK Verification', () => {
  let sdk: ProofportSDK;
  const mockProvider = { getNetwork: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    sdk = new ProofportSDK({
      verifiers: {
        coinbase_attestation: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          chainId: 84532,
          abi: ['function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)'],
        },
      },
    });
  });

  it('verifyOnChain() calls contract and returns { valid: true }', async () => {
    const proof = '0x' + 'a'.repeat(128);
    const publicInputs = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'];

    const result = await sdk.verifyOnChain('coinbase_attestation', proof, publicInputs, mockProvider);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('verifyOnChain() returns { valid: false, error } when no verifier configured', async () => {
    const sdkWithoutVerifier = new ProofportSDK({});
    const proof = '0x' + 'a'.repeat(128);
    const publicInputs = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'];

    const result = await sdkWithoutVerifier.verifyOnChain('coinbase_attestation', proof, publicInputs, mockProvider);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('No verifier address provided');
  });

  it('verifyOnChain() returns { valid: false } when contract.verify throws', async () => {
    const { ethers } = await import('ethers');
    (ethers.Contract as any).mockImplementationOnce(function (this: any) {
      this.verify = vi.fn().mockRejectedValue(new Error('Revert'));
    });

    const proof = '0x' + 'a'.repeat(128);
    const publicInputs = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'];

    const result = await sdk.verifyOnChain('coinbase_attestation', proof, publicInputs, mockProvider);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('verifyResponseOnChain() extracts proof from ProofResponse and verifies', async () => {
    const response: ProofResponse = {
      status: 'completed',
      requestId: 'req-123',
      circuit: 'coinbase_attestation',
      proof: '0x' + 'b'.repeat(128),
      publicInputs: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
    };

    const result = await sdk.verifyResponseOnChain(response, mockProvider);

    expect(result.valid).toBe(true);
  });

  it('verifyResponseOnChain() returns error for non-completed status', async () => {
    const response: ProofResponse = {
      status: 'pending',
      requestId: 'req-123',
      circuit: 'coinbase_attestation',
    };

    const result = await sdk.verifyResponseOnChain(response, mockProvider);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid or incomplete response');
  });

  it('verifyResponseOnChain() returns error for missing proof', async () => {
    const response: ProofResponse = {
      status: 'completed',
      requestId: 'req-123',
      circuit: 'coinbase_attestation',
      publicInputs: ['0x1234'],
    };

    const result = await sdk.verifyResponseOnChain(response, mockProvider);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid or incomplete response');
  });

  it('verifyResponseOnChain() returns error for missing publicInputs', async () => {
    const response: ProofResponse = {
      status: 'completed',
      requestId: 'req-123',
      circuit: 'coinbase_attestation',
      proof: '0x' + 'b'.repeat(128),
    };

    const result = await sdk.verifyResponseOnChain(response, mockProvider);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid or incomplete response');
  });
});
