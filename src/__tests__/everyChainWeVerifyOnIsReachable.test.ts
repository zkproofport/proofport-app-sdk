import { describe, it, expect } from 'vitest';
import { RPC_ENDPOINTS } from '../constants';
import { getDefaultProvider } from '../verifier';

/**
 * A chain a proof can be verified on must be a chain the SDK can reach.
 *
 * On 2026-09-12 the Arc circuit was supported, its verifier was deployed on Arc
 * Testnet, a phone generated a valid proof — and on-chain verification answered
 * "No RPC endpoint configured for chain 5042002". Nothing was wrong with the
 * proof; the RPC table simply had no row, and the error named the chain in a
 * way that reads like the proof's fault.
 *
 * The chains listed here are the ones a ZKProofport verifier is deployed on.
 * Adding a deployment means adding its RPC, and this test is what says so.
 */
const CHAINS_WITH_A_VERIFIER = {
  8453: 'Base',
  84532: 'Base Sepolia',
  91342: 'GIWA Sepolia',
  5042002: 'Arc Testnet',
} as const;

describe('every chain we verify on is reachable', () => {
  for (const [chainId, name] of Object.entries(CHAINS_WITH_A_VERIFIER)) {
    it(`${name} has an RPC endpoint`, () => {
      const url = RPC_ENDPOINTS[Number(chainId)];
      expect(url, `chain ${chainId} (${name}) has a verifier deployed and no RPC to reach it`).toBeTruthy();
      expect(() => new URL(url)).not.toThrow();
      expect(new URL(url).protocol).toBe('https:');
    });
  }

  it('hands back a provider for each of them rather than throwing', () => {
    for (const chainId of Object.keys(CHAINS_WITH_A_VERIFIER)) {
      expect(() => getDefaultProvider(Number(chainId))).not.toThrow();
    }
  });

  it('still refuses a chain nobody deployed to, naming it', () => {
    expect(() => getDefaultProvider(999999)).toThrow(/No RPC endpoint configured for chain 999999/);
  });
});
