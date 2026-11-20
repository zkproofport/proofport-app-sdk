/**
 * A circuit rebuild redeploys its verifier. Apps already installed keep the
 * old circuit files, so for a while their proofs only verify on the OLD
 * contract and the new app's only on the NEW one. During that window the SDK
 * accepts both -- but only contracts it names itself: the current deployment,
 * then each superseded one listed in ACCEPTED_LEGACY_VERIFIERS until its
 * acceptedUntil. Removing that entry (a data change) ends acceptance.
 *
 * Imported from core's source so the legacy table can be swapped per test;
 * the shipped bundle reads the generated table, which is empty today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { verifyProofOnChain } from '../../packages/core/src/verifier';
import { getAcceptedVerifiers, getAcceptedLegacyVerifiers } from '../../packages/core/src/pinnedVerifiers';
import { PINNED_VERIFIERS, PINNED_VARIANT_VERIFIERS } from '../../packages/core/src/pinnedVerifiers.generated';
import type { LegacyVerifier } from '../../packages/core/src/pinnedVerifiers.generated';
import { attestationInputs, OPRF_TEST_ENVIRONMENT } from './helpers/signerFixtures';

const { legacyTable } = vi.hoisted(() => ({ legacyTable: [] as LegacyVerifier[] }));
vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
  // Verifiers awaiting a redeploy stand in as deployed (helpers/redeployedVerifiers.ts).
  const { withRedeployedVerifiers } = await import('./helpers/redeployedVerifiers');
  const real = withRedeployedVerifiers(await importOriginal<typeof import('../../packages/core/src/pinnedVerifiers.generated')>());
  return { ...real, ACCEPTED_LEGACY_VERIFIERS: legacyTable };
});

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const CHAIN = 84532;
const CURRENT = PINNED_VERIFIERS.coinbase_attestation[CHAIN].address;
const LEGACY = '0x' + '11'.repeat(20);
const ATTACKER = '0x000000000000000000000000000000000000dead';
const VK_REF = 'a'.repeat(40);
const provider = {};
const parsed = { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: attestationInputs('coinbase_attestation'), numPublicInputs: 133 };
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };

const legacyEntry = (over: Partial<LegacyVerifier> = {}): LegacyVerifier => ({
  circuit: 'coinbase_attestation',
  variant: 'standard',
  chainId: CHAIN,
  address: LEGACY,
  vkRef: VK_REF,
  bbVersion: '6.0.0',
  acceptedUntil: '2099-12-31',
  reason: 'test transition',
  ...over,
});

/** Each contract answers by address: true for those in `accepting`, a revert for those in `reverting`. */
function contractsAnswer(accepting: string[], reverting: string[] = []) {
  Contract.mockImplementation(function (this: any, address: string) {
    const a = String(address).toLowerCase();
    this.verify = reverting.includes(a)
      ? vi.fn().mockRejectedValue(new Error('execution reverted'))
      : vi.fn().mockResolvedValue(accepting.includes(a));
  });
}
const calledAddresses = () => Contract.mock.calls.map(c => String(c[0]).toLowerCase());

beforeEach(() => {
  legacyTable.splice(0, legacyTable.length);
  Contract.mockClear();
});
afterEach(() => {
  // Back to the global setup's "every contract accepts" for the other files.
  Contract.mockImplementation(function (this: any) {
    this.verify = vi.fn().mockResolvedValue(true);
  });
});

describe('the accepted set', () => {
  it('is only the current deployment when nothing is in transition', () => {
    expect(getAcceptedVerifiers('coinbase_attestation', 'standard', CHAIN)).toEqual([
      { address: CURRENT, chainId: CHAIN, label: 'current' },
    ]);
  });

  it('puts the current deployment first, then the legacy one', () => {
    legacyTable.push(legacyEntry());
    expect(getAcceptedVerifiers('coinbase_attestation', 'standard', CHAIN).map(v => [v.label, v.address])).toEqual([
      ['current', CURRENT],
      ['legacy', LEGACY],
    ]);
  });

  it('keeps a legacy entry to its own package and chain', () => {
    legacyTable.push(legacyEntry({ variant: 'android' }), legacyEntry({ chainId: 8453 }), legacyEntry({ circuit: 'oidc_domain_attestation' }));
    expect(getAcceptedVerifiers('coinbase_attestation', 'standard', CHAIN).map(v => v.label)).toEqual(['current']);
    expect(getAcceptedVerifiers('coinbase_attestation', 'android', CHAIN).map(v => [v.label, v.address])).toEqual([
      ['current', PINNED_VARIANT_VERIFIERS.android.coinbase_attestation![CHAIN].address],
      ['legacy', LEGACY],
    ]);
  });

  it('accepts a legacy entry through the last day of its window and not the day after (UTC)', () => {
    legacyTable.push(legacyEntry({ acceptedUntil: '2026-12-31' }));
    const on = (iso: string) => getAcceptedVerifiers('coinbase_attestation', 'standard', CHAIN, new Date(iso)).map(v => v.label);
    expect(on('2026-12-31T23:59:59Z')).toEqual(['current', 'legacy']);
    expect(on('2027-01-01T00:00:00Z')).toEqual(['current']);
  });

  it('still throws for an unknown circuit, an unknown variant, or a chain with no current deployment', () => {
    legacyTable.push(legacyEntry({ chainId: 424242 }));
    expect(() => getAcceptedVerifiers('not_a_circuit', 'standard', CHAIN)).toThrow(/Unknown circuit 'not_a_circuit'/);
    expect(() => getAcceptedVerifiers('coinbase_attestation', 'ios', CHAIN)).toThrow();
    // A legacy entry alone never makes a chain verifiable.
    expect(() => getAcceptedVerifiers('coinbase_attestation', 'standard', 424242)).toThrow(/No coinbase_attestation verifier is deployed on chain 424242/);
  });

  it("lists legacy keys on every chain with 'any', for the off-chain path", () => {
    legacyTable.push(legacyEntry(), legacyEntry({ chainId: 8453, address: '0x' + '22'.repeat(20) }));
    expect(getAcceptedLegacyVerifiers('coinbase_attestation', 'standard', new Date(), 'any')).toHaveLength(2);
    expect(getAcceptedLegacyVerifiers('coinbase_attestation', 'standard', new Date(), CHAIN)).toHaveLength(1);
  });
});

describe('verifyProofOnChain during a transition', () => {
  it('a new-build proof: the current contract accepts and is reported', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([CURRENT]);
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r).toEqual({ valid: true, verifiedBy: { address: CURRENT, chainId: CHAIN, label: 'current' } });
    expect(calledAddresses()).toEqual([CURRENT]);
  });

  it('an old-build proof: the current contract refuses, the legacy one accepts and is reported', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([LEGACY]);
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r).toEqual({ valid: true, verifiedBy: { address: LEGACY, chainId: CHAIN, label: 'legacy' } });
    expect(calledAddresses()).toEqual([CURRENT, LEGACY]);
  });

  it('neither accepts: not valid, and no error because both answered', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([]);
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r).toEqual({ valid: false });
    expect(calledAddresses()).toEqual([CURRENT, LEGACY]);
  });

  it('a revert on the current contract does not hide a legacy contract that accepts', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([LEGACY], [CURRENT]);
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r.valid).toBe(true);
    expect(r.verifiedBy?.label).toBe('legacy');
  });

  it('a refusal with one contract unreachable names it, so "no" is not mistaken for "checked everywhere"', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([], [LEGACY]);
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(new RegExp(`legacy ${LEGACY}: execution reverted`));
  });

  it('a response may name the legacy contract, but never add one', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([LEGACY]);
    const named = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, { verifierAddress: LEGACY }, ENV);
    expect(named.valid).toBe(true);

    Contract.mockClear();
    const attacker = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, { verifierAddress: ATTACKER }, ENV);
    expect(attacker.valid).toBe(false);
    expect(attacker.error).toMatch(/Refusing rather than trusting the response/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a configured verifier is the only candidate and is reported as configured', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([ATTACKER]);
    const configured = { address: ATTACKER, chainId: CHAIN, abi: [] as unknown as typeof PINNED_VERIFIERS };
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, configured as never, undefined, ENV);
    expect(r).toEqual({ valid: true, verifiedBy: { address: ATTACKER, chainId: CHAIN, label: 'configured' } });
    expect(calledAddresses()).toEqual([ATTACKER]);
  });

  it('retiring: once the legacy entry is removed, an old-build proof fails', async () => {
    legacyTable.push(legacyEntry());
    contractsAnswer([LEGACY]);
    expect((await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV)).valid).toBe(true);

    legacyTable.splice(0, legacyTable.length); // the one-line data change
    Contract.mockClear();
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: CHAIN }, undefined, ENV);
    expect(r).toEqual({ valid: false });
    expect(calledAddresses()).toEqual([CURRENT]);
  });

  it('retiring by date: after acceptedUntil the legacy contract is not even called', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      legacyTable.push(legacyEntry({ acceptedUntil: '2026-01-01' }));
      vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
      contractsAnswer([LEGACY]);
      // The coinbase fixture's attested_at is checked against this clock too;
      // only the contract choice matters here, so read the candidates instead.
      expect(getAcceptedVerifiers('coinbase_attestation', 'standard', CHAIN).map(v => v.label)).toEqual(['current']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown chain still fails by name even with a legacy entry for it', async () => {
    legacyTable.push(legacyEntry({ chainId: 424242 }));
    const r = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 424242 }, undefined, ENV);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/No coinbase_attestation verifier is deployed on chain 424242/);
  });
});
