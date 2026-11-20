/**
 * Core's generated tables as they will read once every verifier waiting for a
 * redeploy has been redeployed.
 *
 * WHY. When the circuits are rebuilt (a toolchain upgrade, a circuit fix) the
 * generator leaves every verifier built from a superseded key out of the
 * pinned tables and lists it in AWAITING_REDEPLOY. Until the redeploy there is
 * no contract to verify a current proof against, so every test of the on-chain
 * WIRING -- "the policy runs before the contract is asked", "the pinned
 * contract is the one called" -- would have nothing to reach. These tests are
 * about the wiring, not about which address is deployed, so they run against
 * this table: each waiting row becomes a pinned row at a synthetic address
 * that cannot be mistaken for a deployed one (`0x5ee7…` + the chain and row
 * number). Rows that ARE pinned are kept as they are, so once nothing waits
 * this returns the generated tables unchanged.
 *
 * Tests that assert which contract is deployed read the real tables and never
 * use this.
 *
 * Use (core is loaded from source, see vitest.config.ts):
 *
 *   vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
 *     const { withRedeployedVerifiers } = await import('./helpers/redeployedVerifiers');
 *     return withRedeployedVerifiers(await importOriginal());
 *   });
 */
import type * as Generated from '../../../packages/core/src/pinnedVerifiers.generated';

type GeneratedModule = typeof Generated;

/** The synthetic address standing in for the redeployed verifier of `row`. */
export function redeployedAddress(chainId: number, row: number): string {
  return '0x5ee7' + chainId.toString(16).padStart(12, '0') + row.toString(16).padStart(24, '0');
}

export function withRedeployedVerifiers(actual: GeneratedModule): GeneratedModule {
  const standard: Record<string, Record<number, Generated.PinnedVerifier>> = {};
  for (const [circuit, byChain] of Object.entries(actual.PINNED_VERIFIERS)) standard[circuit] = { ...byChain };
  const variants: Record<string, Record<string, Record<number, Generated.PinnedVerifier>>> = {};
  for (const [variant, byCircuit] of Object.entries(actual.PINNED_VARIANT_VERIFIERS)) {
    variants[variant] = {};
    for (const [circuit, byChain] of Object.entries(byCircuit)) variants[variant][circuit] = { ...byChain };
  }
  actual.AWAITING_REDEPLOY.forEach((row, i) => {
    const key = actual.VERIFICATION_KEYS[row.circuit][row.variant];
    if (!key) throw new Error(`No current key for ${row.circuit} '${row.variant}' in the generated table`);
    const pinned: Generated.PinnedVerifier = {
      address: redeployedAddress(row.chainId, i),
      deployedAt: '2026-12-01T00:00:00.000Z',
      circuitsCommit: 'redeploy',
      vkSha256: key.sha256,
      record: row.record,
    };
    if (row.variant === 'standard') standard[row.circuit][row.chainId] = pinned;
    else variants[row.variant][row.circuit][row.chainId] = pinned;
  });
  return {
    ...actual,
    PINNED_VERIFIERS: standard as GeneratedModule['PINNED_VERIFIERS'],
    PINNED_VARIANT_VERIFIERS: variants as unknown as GeneratedModule['PINNED_VARIANT_VERIFIERS'],
    AWAITING_REDEPLOY: [],
  };
}
