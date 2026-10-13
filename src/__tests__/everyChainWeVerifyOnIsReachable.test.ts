import { describe, it, expect } from 'vitest';
import { RPC_ENDPOINTS } from '../constants';
import { getDefaultProvider } from '../verifier';

/**
 * A chain a proof can be verified on must be a chain the SDK can reach.
 *
 * A verifier deployed on a chain the RPC table has no row for makes on-chain
 * verification answer "No RPC endpoint configured for chain N" for a valid
 * proof — an error that reads like the proof's fault.
 *
 * The chains listed here are the ones a ZKProofport verifier is deployed on.
 * Adding a deployment means adding its RPC, and this test is what says so.
 */
const CHAINS_WITH_A_VERIFIER = {
  8453: 'Base',
  84532: 'Base Sepolia',
  91342: 'GIWA Sepolia',
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

  it('names the chains it does know, so the caller sees what was expected', () => {
    expect(() => getDefaultProvider(999999)).toThrow(/Known chains: .*8453.*84532|Known chains: .*84532.*8453/);
  });

  // Arc was removed from the SDK on 2026-10-13. Its testnet must now be refused
  // like any other unknown chain -- never resolved to another chain's RPC.
  it('refuses Arc Testnet (5042002), which the SDK no longer supports', () => {
    expect(RPC_ENDPOINTS[5042002]).toBeUndefined();
    expect(() => getDefaultProvider(5042002)).toThrow(/No RPC endpoint configured for chain 5042002/);
  });
});
