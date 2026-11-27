/**
 * GIWA KYC (`giwa_attestation`) and the Dojang Playground
 * (`dojang_playground`) v2, 2026-11-27: each proof carries a device-signed
 * statement that its GIWA Sepolia EAS attestation was neither revoked nor
 * expired at `attested_at`, the last public input (circuits giwa-v2-libs,
 * statement.nr). The circuit has no clock, so the verifier holds attested_at
 * to its own, by the same rule as Coinbase KYC v2 (core coinbasePolicy.ts).
 *
 * Matrix (written before the tests):
 *   count       GIWA 133 / Dojang 101; 132 / 100 (before the statement) and
 *               192 / 160 (before the OPRF nullifier) refused by name, on the
 *               issuer check and through checkProofIssuer; 0, count - 1,
 *               count + 1 refused; not an array
 *   root        GIWA: published GIWA root accepted, Coinbase's refused.
 *               Dojang: none (faucet and chain are circuit constants)
 *   attested_at 900 s behind accepted, 901 refused; 300 s ahead accepted,
 *               301 refused; 0; 2^64 - 1 (u64 max, far ahead) refused as
 *               ahead; 2^64 and 2^256 - 1 refused as out of range; negative;
 *               not a number; empty; HTML
 *   wiring      the issuer table runs these checks; on-chain and off-chain
 *               verify refuse a stale proof before any contract call or key
 *               fetch; a fresh proof of each package reaches the GIWA Sepolia
 *               verifier pinned for it (three per circuit, exact addresses)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import {
  CIRCUIT_ISSUER_CHECKS,
  COINBASE_ATTESTED_AT_MAX_AGE_SECONDS,
  COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS,
  COINBASE_SIGNER_SET,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT,
  GIWA_ATTESTATION_PUBLIC_INPUT_COUNT,
  GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  checkDojangPlaygroundProof,
  checkGiwaAttestationProof,
  checkProofIssuer,
  getPinnedVariantVerifier,
  verifyProofOnChain,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { attestationInputs, dojangInputs, OPRF_TEST_ENVIRONMENT } from './helpers/signerFixtures';

vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
  const { withRedeployedVerifiers } = await import('./helpers/redeployedVerifiers');
  return withRedeployedVerifiers(await importOriginal());
});

vi.mock('@aztec-foundation/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: any) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const NOW = 1_800_000_000;
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };
const field = (v: bigint | number) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const PROOF_2_20 = '0x' + 'ab'.repeat(10304);
const PROOF_2_21 = '0x' + 'ab'.repeat(10688);

const CIRCUITS = {
  giwa_attestation: {
    label: 'GIWA KYC',
    count: GIWA_ATTESTATION_PUBLIC_INPUT_COUNT,
    at: GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,
    check: checkGiwaAttestationProof,
    inputs: (attestedAt: string) => {
      const inputs = attestationInputs('giwa_attestation');
      inputs[GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT] = attestedAt;
      return inputs;
    },
    preOprf: 192,
    preOprfName: 'GIWA proof made before the OPRF nullifier',
    // circuits deployments/91342/GiwaAttestationV2{,Android,AndroidFactory}.json
    pinned: {
      standard: '0x55e7b9d9f2e9ac0080b668514ee01f15b686bfce',
      android: '0x428074597be3d784535e40f9b1cdfe048af57f03',
      android_factory: '0x465fab030d82241bd95268704537a782b8109807',
    },
  },
  dojang_playground: {
    label: 'Dojang Playground',
    count: DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT,
    at: DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,
    check: checkDojangPlaygroundProof,
    inputs: (attestedAt: string) => {
      const inputs = dojangInputs();
      inputs[DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT] = attestedAt;
      return inputs;
    },
    preOprf: 160,
    preOprfName: 'Dojang Playground proof made before the OPRF nullifier',
    // circuits deployments/91342/DojangPlaygroundV2{,Android,AndroidFactory}.json
    pinned: {
      standard: '0xc1c42ade7c31afdf99fbaedf97da5b07fccba724',
      android: '0x7fc2059a73cef2b572c8deee911c72963dcb4a8a',
      android_factory: '0x0b3af3dfc67dc65e0145c37ee00230139d579f64',
    },
  },
} as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  Contract.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('GIWA is 133 fields and the Dojang Playground 101, attested_at last', () => {
  expect(GIWA_ATTESTATION_PUBLIC_INPUT_COUNT).toBe(133);
  expect(GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT).toBe(132);
  expect(GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER).toBe(131);
  expect(DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT).toBe(101);
  expect(DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.ATTESTED_AT).toBe(100);
  expect(DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT.NULLIFIER).toBe(99);
  expect(COINBASE_ATTESTED_AT_MAX_AGE_SECONDS).toBe(900);
  expect(COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS).toBe(300);
});

describe.each(Object.entries(CIRCUITS))('%s', (circuit, c) => {
  const id = circuit as keyof typeof CIRCUITS;
  const zeros = (n: number) => Array.from({ length: n }, () => field(0));

  describe('count', () => {
    const preStatement = c.count - 1;
    it(`refuses ${c.count - 1} inputs (before the device status statement) by name`, async () => {
      const message =
        `This is a ${c.label} proof made before the device status statement (it does not show the attestation was unrevoked and unexpired) ` +
        `(${preStatement} public inputs). Only current ${c.label} proofs (${c.count} public inputs) are accepted; ` +
        'generate the proof again with a current ZKProofport app or prover.';
      expect(await c.check(zeros(preStatement))).toEqual({ ok: false, error: message });
      // Through the issuer entry point the OPRF reader meets it first, and names it too.
      expect(await checkProofIssuer(id, zeros(preStatement), ENV)).toEqual({
        ok: false,
        error: expect.stringMatching(new RegExp(`^This is a ${c.label} proof made before the device status statement .*\\(${preStatement} public inputs\\)`)),
      });
    });

    it(`refuses ${c.preOprf} inputs (before the OPRF nullifier) by name`, async () => {
      expect(await c.check(zeros(c.preOprf))).toEqual({ ok: false, error: expect.stringContaining(`This is a ${c.preOprfName}`) });
    });

    it.each([[0], [c.count + 1], [c.count - 2]])('refuses %i inputs by count', async n => {
      expect(await c.check(zeros(n))).toEqual({ ok: false, error: `Expected ${c.count} public inputs; got ${n}.` });
    });

    it('refuses something that is not an array', async () => {
      expect(await c.check('0x01' as unknown as string[])).toEqual({ ok: false, error: `Expected ${c.count} public inputs; got string.` });
    });
  });

  describe('attested_at', () => {
    it('accepts exactly 900 s behind, refuses 901', async () => {
      expect(await c.check(c.inputs(field(NOW - 900)))).toEqual({ ok: true });
      expect(await c.check(c.inputs(field(NOW - 901)))).toEqual({
        ok: false,
        error: `The proof's attested_at (${NOW - 901}) is 901s behind this verifier's clock (${NOW}); at most 900s is accepted.`,
      });
    });

    it('accepts exactly 300 s ahead, refuses 301', async () => {
      expect(await c.check(c.inputs(field(NOW + 300)))).toEqual({ ok: true });
      expect(await c.check(c.inputs(field(NOW + 301)))).toEqual({
        ok: false,
        error: `The proof's attested_at (${NOW + 301}) is 301s ahead of this verifier's clock (${NOW}); at most 300s is accepted.`,
      });
    });

    it('accepts now', async () => {
      expect(await c.check(c.inputs(field(NOW)))).toEqual({ ok: true });
    });

    it('refuses zero (a statement never signed)', async () => {
      expect(await c.check(c.inputs(field(0)))).toEqual({ ok: false, error: expect.stringMatching(/^The proof's attested_at \(0\) is \d+s behind/) });
    });

    it('refuses u64 max as far ahead', async () => {
      const max = (1n << 64n) - 1n;
      expect(await c.check(c.inputs(field(max)))).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`^The proof's attested_at \\(${max}\\) is \\d+s ahead`)) });
    });

    it.each([
      ['2^64', field(1n << 64n), new RegExp(`^Public input ${c.at} \\(attested_at\\) is out of range: ${1n << 64n}\\.$`)],
      ['2^256 - 1', '0x' + 'ff'.repeat(32), new RegExp(`^Public input ${c.at} \\(attested_at\\) is out of range`)],
      ['negative', '-1', new RegExp(`^Public input ${c.at} \\(attested_at\\) is out of range: -1\\.$`)],
      ['not a number', '0xzz', new RegExp(`^Public input ${c.at} \\(attested_at\\) is not a number\\.$`)],
      ['HTML', '<script>', new RegExp(`^Public input ${c.at} \\(attested_at\\) is not a number\\.$`)],
    ])('refuses a value that is %s', async (_label, value, message) => {
      expect(await c.check(c.inputs(value))).toEqual({ ok: false, error: expect.stringMatching(message) });
    });

    it('an empty string reads as zero and is refused as stale, never accepted', async () => {
      // BigInt('') is 0n.
      expect((await c.check(c.inputs(''))).ok).toBe(false);
    });
  });

  describe('wiring', () => {
    it('checkProofIssuer runs this check', async () => {
      expect(await checkProofIssuer(id, c.inputs(field(NOW)), ENV)).toEqual({ ok: true });
      expect(await checkProofIssuer(id, c.inputs(field(NOW - 901)), ENV)).toEqual({ ok: false, error: expect.stringMatching(/901s behind this verifier's clock/) });
    });

    it('on-chain verify refuses a stale proof before calling any contract', async () => {
      const stale = c.inputs(field(NOW - 3600));
      const r = await verifyProofOnChain(id, { proofHex: PROOF_2_20, publicInputsHex: stale, numPublicInputs: c.count }, {}, { chainId: 91342 }, undefined, ENV);
      expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
      expect(Contract).not.toHaveBeenCalled();
    });

    it('off-chain verify refuses a stale proof before fetching a key', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const r = await verifyProofOffChain(id, PROOF_2_20, c.inputs(field(NOW - 3600)), ENV);
      expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['standard', PROOF_2_20],
      ['android', PROOF_2_21],
      ['android_factory', PROOF_2_21],
    ] as const)('a fresh %s proof reaches the GIWA Sepolia verifier pinned for that package', async (variant, proofHex) => {
      expect(getPinnedVariantVerifier(id, variant, 91342).address).toBe(c.pinned[variant]);
      const r = await verifyProofOnChain(
        id,
        { proofHex, publicInputsHex: c.inputs(field(NOW)), numPublicInputs: c.count },
        {},
        { chainId: 91342 },
        undefined,
        { ...ENV, signerVariant: variant },
      );
      expect(r).toMatchObject({ valid: true });
      expect(Contract).toHaveBeenCalledTimes(1);
      expect(String(Contract.mock.calls[0][0]).toLowerCase()).toBe(c.pinned[variant]);
    });
  });
});

describe('GIWA signer root', () => {
  it('refuses Coinbase\'s root before reading attested_at', async () => {
    const inputs = attestationInputs('giwa_attestation', COINBASE_SIGNER_SET.root);
    inputs[GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT] = field(NOW);
    expect(await checkGiwaAttestationProof(inputs)).toEqual({ ok: false, error: expect.stringMatching(/is not the root of the GIWA attester's published signers/) });
  });

  it('the issuer table names both checks', () => {
    expect(CIRCUIT_ISSUER_CHECKS.giwa_attestation).toBe(checkGiwaAttestationProof);
    expect(CIRCUIT_ISSUER_CHECKS.dojang_playground).toBe(checkDojangPlaygroundProof);
  });
});
