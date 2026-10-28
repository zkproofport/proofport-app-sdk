/**
 * The OIDC testnet verifiers core pins are the ones built from the circuit
 * that also checks a signed provider-key statement (circuits branch
 * oidc-signature, artifacts 5081cfd; fix list item 12). Every earlier OIDC v2
 * verifier accepts a proof made with a self-generated RSA key, so a row that
 * slid back to one of them would quietly reopen that hole on chain.
 *
 * Public inputs did not change (214), so nothing else in a proof tells the
 * two circuits apart: only the pinned address does.
 */
import { describe, it, expect } from 'vitest';
import { PINNED_VERIFIERS, PINNED_VERIFIERS_SOURCE_COMMIT } from '@zkproofport-app/core';

const PROVIDER_KEY_VERIFIERS: Record<number, string> = {
  84532: '0xea5933abc598401c89f63b3f13ae56a7e78984e8',
  11155111: '0x8e8f481d98149f13fb756cab69376814fa854180',
};

// v2 before the claim-quote fix, v2 with it -- neither checks the key.
const WITHOUT_PROVIDER_KEY_CHECK = [
  '0x003334a7c2ff15ee9ee845ab88e152a2a3694167',
  '0x728eed982a3aeb0274fef972ebba9b774a2f9be4',
  '0x3a1f5c1ac0e340484b1638fe77bcb9d75d20372f',
  '0x90d89a56433a91cfd81b888e38976320d2a4e39e',
];

describe('OIDC testnet verifiers check the provider-key statement', () => {
  for (const [chain, address] of Object.entries(PROVIDER_KEY_VERIFIERS)) {
    it(`chain ${chain} pins ${address}`, () => {
      const row = PINNED_VERIFIERS.oidc_domain_attestation[Number(chain)];
      expect(row).toBeDefined();
      expect(row.address).toBe(address);
      expect(row.circuitsCommit).toBe('5081cfd');
    });
  }

  it('no OIDC row is a verifier without the provider-key check', () => {
    const pinned = Object.values(PINNED_VERIFIERS.oidc_domain_attestation).map((r) => r.address.toLowerCase());
    for (const old of WITHOUT_PROVIDER_KEY_CHECK) expect(pinned).not.toContain(old);
  });

  it('the table names the circuits commit it was generated from', () => {
    expect(PINNED_VERIFIERS_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});
