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
import { AWAITING_REDEPLOY, PINNED_VERIFIERS, PINNED_VERIFIERS_SOURCE_COMMIT } from '@zkproofport-app/core';

// The provider-key circuit's bb 4.2 testnet contracts (artifacts 5081cfd),
// replaced on 2026-11-20 by the bb 6.0.0 redeploy below (circuits 5a1f906).
const PREVIOUS_PROVIDER_KEY_VERIFIERS: Record<number, string> = {
  84532: '0xea5933abc598401c89f63b3f13ae56a7e78984e8',
  11155111: '0x8e8f481d98149f13fb756cab69376814fa854180',
};
const PROVIDER_KEY_VERIFIERS: Record<number, string> = {
  84532: '0x14a2241b0a24679825befaaa562d4a204262d84f',
  11155111: '0x4253eef617ee2d1fc4e551f448fbfdaaaeb9fc90',
};

// v2 before the claim-quote fix, v2 with it -- neither checks the key.
const WITHOUT_PROVIDER_KEY_CHECK = [
  '0x003334a7c2ff15ee9ee845ab88e152a2a3694167',
  '0x728eed982a3aeb0274fef972ebba9b774a2f9be4',
  '0x3a1f5c1ac0e340484b1638fe77bcb9d75d20372f',
  '0x90d89a56433a91cfd81b888e38976320d2a4e39e',
];

describe('OIDC testnet verifiers check the provider-key statement', () => {
  // Rebuilt with nargo 1.0.0 / bb 6.0.0 and the RSA limb fix, redeployed on
  // both testnets: the pinned row is the new contract, never the previous one.
  for (const [chain, address] of Object.entries(PROVIDER_KEY_VERIFIERS)) {
    it(`chain ${chain}: pins ${address}, not the bb 4.2 contract`, () => {
      expect(PINNED_VERIFIERS.oidc_domain_attestation[Number(chain)]?.address).toBe(address);
      expect(PINNED_VERIFIERS.oidc_domain_attestation[Number(chain)]?.address).not.toBe(PREVIOUS_PROVIDER_KEY_VERIFIERS[Number(chain)]);
      expect(AWAITING_REDEPLOY.some(v => v.circuit === 'oidc_domain_attestation' && v.chainId === Number(chain))).toBe(false);
    });
  }

  it('no OIDC row is a verifier without the provider-key check', () => {
    const pinned = Object.values(PINNED_VERIFIERS.oidc_domain_attestation).map((r) => r.address.toLowerCase());
    for (const old of WITHOUT_PROVIDER_KEY_CHECK) expect(pinned).not.toContain(old);
  });

  it('no OIDC row is one of the contracts awaiting a redeploy', () => {
    const pinned = Object.values(PINNED_VERIFIERS.oidc_domain_attestation).map((r) => r.address.toLowerCase());
    for (const row of AWAITING_REDEPLOY) expect(pinned).not.toContain(row.previousAddress);
  });

  it('the table names the circuits commit it was generated from', () => {
    expect(PINNED_VERIFIERS_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});
