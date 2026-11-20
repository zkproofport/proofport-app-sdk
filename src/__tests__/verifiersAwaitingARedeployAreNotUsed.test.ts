/**
 * A verifier built from a superseded key waits for a redeploy: the generator
 * leaves it out of the pinned tables and lists it in AWAITING_REDEPLOY. Core
 * must then refuse that chain by saying so -- never fall back to the previous
 * contract (which would accept proofs of the superseded circuit) and never
 * report the chain as having nothing deployed.
 *
 * Also holds the real generated table to the state it is in on this branch:
 * the testnet verifiers are the bb 6.0.0 redeploy, the mainnet ones still
 * await it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { attestationInputs } from './helpers/signerFixtures';

const { PREVIOUS } = vi.hoisted(() => ({ PREVIOUS: '0x1885aa2283db21ad0fc63a2df98efe92f31908e6' }));
vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
  const real = await importOriginal<typeof import('../../packages/core/src/pinnedVerifiers.generated')>();
  const empty = (byCircuit: Record<string, unknown>) => Object.fromEntries(Object.keys(byCircuit).map(c => [c, {}]));
  return {
    ...real,
    PINNED_VERIFIERS: {
      ...empty(real.PINNED_VERIFIERS),
      coinbase_attestation: {
        8453: { address: '0x00000000000000000000000000000000000ba5e1', deployedAt: '2026-12-01T00:00:00.000Z', circuitsCommit: 'new', vkSha256: 'new', record: 'r' },
      },
    },
    PINNED_VARIANT_VERIFIERS: {
      android: empty(real.PINNED_VARIANT_VERIFIERS.android),
      android_factory: empty(real.PINNED_VARIANT_VERIFIERS.android_factory),
    },
    AWAITING_REDEPLOY: [
      { circuit: 'coinbase_attestation', variant: 'standard', chainId: 84532, previousAddress: PREVIOUS, previousVkSha256: 'old', record: 'r' },
      { circuit: 'coinbase_attestation', variant: 'android', chainId: 84532, previousAddress: '0x00000000000000000000000000000000000a0d01', previousVkSha256: 'old', record: 'r' },
    ],
  };
});

const { getPinnedVerifier, getPinnedVariantVerifier, getAcceptedVerifiers, verifyProofOnChain } = await import('../../packages/core/src/index');
const real = await vi.importActual<typeof import('../../packages/core/src/pinnedVerifiers.generated')>('../../packages/core/src/pinnedVerifiers.generated');

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const AWAITS =
  `The coinbase_attestation verifier on chain 84532 awaits a redeploy: the contract deployed there (${PREVIOUS}) ` +
  `was built from a verification key that is no longer this circuit's, so it is not used.`;

beforeEach(() => {
  Contract.mockClear();
});

describe('a chain whose verifier awaits a redeploy', () => {
  it('the getters say so, naming the previous contract', () => {
    expect(() => getPinnedVerifier('coinbase_attestation', 84532)).toThrow(AWAITS);
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'standard', 84532)).toThrow(AWAITS);
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'android', 84532)).toThrow(
      "The coinbase_attestation verifier for the 'android' signer on chain 84532 awaits a redeploy",
    );
    expect(() => getAcceptedVerifiers('coinbase_attestation', 'standard', 84532)).toThrow(AWAITS);
  });

  it('a chain with neither a pin nor a waiting row is still "nothing deployed"', () => {
    expect(() => getPinnedVerifier('coinbase_attestation', 11155111)).toThrow(
      'No coinbase_attestation verifier is deployed on chain 11155111. Chains with one: 8453.',
    );
  });

  it('a redeployed chain beside it is unaffected', () => {
    expect(getPinnedVerifier('coinbase_attestation', 8453).address).toBe('0x00000000000000000000000000000000000ba5e1');
  });

  it('on-chain verification refuses with that reason and asks no contract -- not the previous one either', async () => {
    const parsed = { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: attestationInputs('coinbase_attestation'), numPublicInputs: 193 };
    const r = await verifyProofOnChain('coinbase_attestation', parsed, {}, { chainId: 84532 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('awaits a redeploy');
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a response naming the previous contract is not verified against it', async () => {
    const parsed = { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: attestationInputs('coinbase_attestation'), numPublicInputs: 193 };
    const r = await verifyProofOnChain('coinbase_attestation', parsed, {}, { chainId: 84532 }, { verifierAddress: PREVIOUS, chainId: 84532 });
    expect(r.valid).toBe(false);
    expect(Contract).not.toHaveBeenCalled();
  });
});

describe('the generated table on this branch (Noir 1.0.0 / bb 6.0.0 rebuild, testnets redeployed)', () => {
  // circuits 5a1f906 (2026-11-20) redeployed every shipped package on Base
  // Sepolia, Ethereum Sepolia and GIWA Sepolia. Mainnet (1, 8453) waits for
  // its own redeploy: rewrite this block when that is regenerated.
  const pinnedRows = () =>
    [
      ...Object.values(real.PINNED_VERIFIERS),
      ...Object.values(real.PINNED_VARIANT_VERIFIERS).flatMap(byCircuit => Object.values(byCircuit)),
    ].flatMap(byChain => Object.entries(byChain ?? {}).map(([chain, row]) => ({ chain: Number(chain), ...(row as { address: string; circuitsCommit: string; vkSha256: string }) })));

  it('pins the 22 testnet verifiers and lists the 20 mainnet ones as awaiting a redeploy', () => {
    const pinned = pinnedRows();
    expect(pinned.length).toBe(22);
    expect([...new Set(pinned.map(r => r.chain))].sort((a, b) => a - b)).toEqual([84532, 91342, 11155111]);
    expect(real.AWAITING_REDEPLOY.length).toBe(20);
    expect([...new Set(real.AWAITING_REDEPLOY.map(r => r.chainId))].sort((a, b) => a - b)).toEqual([1, 8453]);
  });

  it('every pinned row was built from the current key, every waiting row from another', () => {
    for (const [circuit, byChain] of Object.entries(real.PINNED_VERIFIERS)) {
      for (const row of Object.values(byChain ?? {})) expect(row.vkSha256).toBe(real.VERIFICATION_KEYS[circuit].standard?.sha256);
    }
    for (const [variant, byCircuit] of Object.entries(real.PINNED_VARIANT_VERIFIERS)) {
      for (const [circuit, byChain] of Object.entries(byCircuit)) {
        for (const row of Object.values(byChain ?? {})) expect(row.vkSha256).toBe(real.VERIFICATION_KEYS[circuit][variant]?.sha256);
      }
    }
    for (const row of real.AWAITING_REDEPLOY) {
      expect(row.previousVkSha256).not.toBe(real.VERIFICATION_KEYS[row.circuit][row.variant]?.sha256);
    }
  });

  it('no pinned address is a contract awaiting a redeploy', () => {
    const waiting = new Set(real.AWAITING_REDEPLOY.map(r => r.previousAddress));
    for (const row of pinnedRows()) expect(waiting.has(row.address)).toBe(false);
  });

  it('the keys are bb 6.0.0 keys fetched at the committed circuits rebuild, the one source of every key', () => {
    expect(real.VERIFICATION_KEY_BB_VERSION).toBe('6.0.0');
    // circuits toolchain-upgrade 2181748: the 1.0.0 / bb 6.0.0 artifacts with
    // the OPRF nullifier and the testnet verifier records. A full commit,
    // never a branch, and the commit the table itself was generated from.
    expect(real.VERIFICATION_KEYS_REF).toBe('2181748bfb7216552ffdd9109486f7ebfbce2cb6');
    expect(real.VERIFICATION_KEYS_REF).toBe(real.PINNED_VERIFIERS_SOURCE_COMMIT);
  });
});
