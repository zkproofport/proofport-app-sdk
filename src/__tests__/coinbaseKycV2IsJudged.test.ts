/**
 * Coinbase KYC is judged by the v2 layout on every verify path: 193 public
 * inputs, the signer root at 96-127, and `attested_at` (192) held to the
 * verifier's clock. The circuit has no clock of its own, so without the last
 * check a proof whose attestation was unrevoked once would verify forever.
 *
 * Matrix:
 *   count       128 (v1) refused by name; 0, 192, 194 refused; not an array
 *   root        published root accepted; any other refused
 *   attested_at boundaries: 15 min behind accepted, +1 s refused; 5 min ahead
 *               accepted, +1 s refused; not a number, negative, above u64
 *   wiring      the issuer table runs this check; on-chain and off-chain
 *               verify refuse a stale proof before any contract or key fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import {
  CIRCUIT_ISSUER_CHECKS,
  COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT,
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_ATTESTED_AT_MAX_AGE_SECONDS,
  COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS,
  checkCoinbaseAttestationProof,
  checkProofIssuer,
  verifyProofOnChain,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { attestationInputs } from './helpers/signerFixtures';

vi.mock('@aztec/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: any) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const NOW = 1_800_000_000;
const AT = COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT;
const field = (v: bigint | number) => '0x' + BigInt(v).toString(16).padStart(64, '0');

function withAttestedAt(value: string): string[] {
  const inputs = attestationInputs('coinbase_attestation');
  inputs[AT] = value;
  return inputs;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  Contract.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('count', () => {
  it('the layout is 193 fields, attested_at last', () => {
    expect(COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT).toBe(193);
    expect(AT).toBe(192);
    expect(COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.MERKLE_ROOT_START).toBe(96);
    expect(COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_START).toBe(128);
    expect(COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_START).toBe(160);
  });

  it('refuses a v1 proof (128 inputs) naming what it is', async () => {
    const r = await checkCoinbaseAttestationProof(Array.from({ length: 128 }, () => field(0)));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^This is a Coinbase KYC v1 proof \(128 public inputs\)\. Only Coinbase KYC v2 proofs \(193/) });
  });

  it.each([[0], [192], [194]])('refuses %i inputs by count', async n => {
    const r = await checkCoinbaseAttestationProof(Array.from({ length: n }, () => field(0)));
    expect(r).toEqual({ ok: false, error: `Expected 193 public inputs; got ${n}.` });
  });

  it('refuses something that is not an array', async () => {
    const r = await checkCoinbaseAttestationProof('0x01' as unknown as string[]);
    expect(r).toEqual({ ok: false, error: 'Expected 193 public inputs; got string.' });
  });
});

describe('root', () => {
  it('accepts the published root with a fresh attested_at', async () => {
    expect(await checkCoinbaseAttestationProof(withAttestedAt(field(NOW)))).toEqual({ ok: true });
  });

  it('refuses another root before reading attested_at', async () => {
    const inputs = attestationInputs('coinbase_attestation', '0x' + '11'.repeat(32));
    inputs[AT] = field(NOW);
    const r = await checkCoinbaseAttestationProof(inputs);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/is not the root of Coinbase's published signers/) });
  });
});

describe('attested_at', () => {
  it('accepts exactly 15 minutes behind, refuses one second more', async () => {
    expect(await checkCoinbaseAttestationProof(withAttestedAt(field(NOW - COINBASE_ATTESTED_AT_MAX_AGE_SECONDS)))).toEqual({ ok: true });
    const r = await checkCoinbaseAttestationProof(withAttestedAt(field(NOW - COINBASE_ATTESTED_AT_MAX_AGE_SECONDS - 1)));
    expect(r).toEqual({ ok: false, error: `The proof's attested_at (${NOW - 901}) is 901s behind this verifier's clock (${NOW}); at most 900s is accepted.` });
  });

  it('accepts exactly 5 minutes ahead, refuses one second more', async () => {
    expect(await checkCoinbaseAttestationProof(withAttestedAt(field(NOW + COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS)))).toEqual({ ok: true });
    const r = await checkCoinbaseAttestationProof(withAttestedAt(field(NOW + COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS + 1)));
    expect(r).toEqual({ ok: false, error: `The proof's attested_at (${NOW + 301}) is 301s ahead of this verifier's clock (${NOW}); at most 300s is accepted.` });
  });

  it('refuses zero (a statement never signed)', async () => {
    const r = await checkCoinbaseAttestationProof(withAttestedAt(field(0)));
    expect(r.ok).toBe(false);
  });

  it.each([
    ['not a number', '0xzz', /Public input 192 \(attested_at\) is not a number\./],
    ['negative', '-1', /Public input 192 \(attested_at\) is out of range: -1\./],
    ['above u64', field(1n << 64n), /Public input 192 \(attested_at\) is out of range/],
  ])('refuses a value that is %s', async (_label, value, message) => {
    const r = await checkCoinbaseAttestationProof(withAttestedAt(value));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(message) });
  });
});

describe('wiring', () => {
  it('the issuer table runs this check for coinbase_attestation', async () => {
    expect(CIRCUIT_ISSUER_CHECKS.coinbase_attestation).toBe(checkCoinbaseAttestationProof);
    const r = await checkProofIssuer('coinbase_attestation', withAttestedAt(field(NOW - 3600)));
    expect(r.ok).toBe(false);
  });

  it('on-chain verify refuses a stale proof before calling any contract', async () => {
    const stale = withAttestedAt(field(NOW - 3600));
    const r = await verifyProofOnChain('coinbase_attestation', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: stale, numPublicInputs: 193 }, {}, { chainId: 84532 });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('on-chain verify reaches the pinned contract with a fresh proof', async () => {
    const fresh = withAttestedAt(field(NOW));
    const r = await verifyProofOnChain('coinbase_attestation', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: fresh, numPublicInputs: 193 }, {}, { chainId: 84532 });
    expect(r).toEqual({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
  });

  it('off-chain verify refuses a stale proof before fetching a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyProofOffChain('coinbase_attestation', '0x' + 'ab'.repeat(64), withAttestedAt(field(NOW - 3600)));
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
