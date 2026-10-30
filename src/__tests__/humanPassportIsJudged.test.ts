/**
 * `human_passport_score` is judged on every verify path: 195 public inputs,
 * the issuer root at 96-127 must be Human Passport's, scorer_id (193) must be
 * Base's scorer, `now` (194) is held to the verifier's clock, min_score (192)
 * is never 0 and equals the threshold the request asked for.
 *
 * Matrix (drawn up before the code):
 *   count      195 accepted; 0, 194, 196, a Coinbase v2 proof (193) refused;
 *              not an array
 *   layout     scope 128-159 and nullifier 160-191 read from a REAL proof of
 *              the circuit; nullifier = keccak(keccak(wallet ++ keccak(id)) ++ scope)
 *   root       Human Passport's accepted; the fixture's test-issuer root
 *              refused; root bytes above 255 refused
 *   scorer     335 accepted; 0, 336, not a number refused
 *   min_score  0 refused; above u32 refused; equal to the request accepted,
 *              one unit lower or higher refused; request 20 vs 20.0001
 *   now        15 min behind / 5 min ahead accepted, one second past either
 *              refused; 0; negative; above u64; not a number
 *   threshold  20, 20.5, 0.0001 and 429496.7295 convert; 0, negative, NaN,
 *              Infinity, 5 decimals, string, null, undefined, above u32 refused
 *   request    createRelayRequest / deep-link validation refuse a missing,
 *              zero, string or over-precise minScore before anything is sent;
 *              an action stays optional and a malformed one is refused
 *   wiring     the issuer table runs this check; on-chain verify refuses a
 *              stale proof before any contract; with a fresh proof it reaches
 *              the PINNED contract; verifyResponseOnChain uses the threshold
 *              of a request this SDK made and refuses a response it cannot place
 *   hostile    scope strings with SQL / HTML / wildcards are carried, not
 *              interpreted (the request only forwards them)
 *   authz/race N/A: pure functions over public inputs, no caller identity
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import fixture from './fixtures/humanPassportTestIssuerProof.json';
import {
  CIRCUIT_ISSUER_CHECKS,
  checkHumanPassportProof,
  checkProofIssuer,
  extractNullifierFromPublicInputs,
  extractScopeFromPublicInputs,
  getPinnedVerifier,
  verifyProofOnChain,
  HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS,
  HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT,
} from '@zkproofport-app/core';
import {
  HUMAN_PASSPORT_ISSUER_LEAVES,
  HUMAN_PASSPORT_ISSUER_ROOT,
  HUMAN_PASSPORT_ISSUER,
  HUMAN_PASSPORT_SCORE_SCHEMA,
  HUMAN_PASSPORT_SCORER_ID,
  humanPassportScoreUnits,
} from '../circuits';
import { ProofportSDK } from '../ProofportSDK';
import { validateProofRequest } from '../deeplink';
import { verifyProofOffChain } from '../offChainVerifier';

vi.mock('@aztec/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: any) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const realKeccak = (await vi.importActual<typeof import('ethers')>('ethers')).ethers;
const L = HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT;
const NOW = 1_800_000_000;
const field = (v: bigint | number) => '0x' + BigInt(v).toString(16).padStart(64, '0');

/** The real proof's public inputs, re-anchored to Human Passport's root and a fresh clock. */
function goodInputs(overrides: Partial<Record<number, string>> = {}): string[] {
  const inputs = [...fixture.publicInputs];
  const root = realKeccak.getBytes(HUMAN_PASSPORT_ISSUER_ROOT);
  for (let i = 0; i < 32; i++) inputs[L.MERKLE_ROOT_START + i] = field(root[i]);
  inputs[L.NOW] = field(NOW);
  for (const [k, v] of Object.entries(overrides)) inputs[Number(k)] = v as string;
  return inputs;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Human Passport anchors', () => {
  it('the root is the positional tree over the published leaves', () => {
    const T = (s: string) => realKeccak.keccak256(realKeccak.toUtf8Bytes(s));
    const enc = realKeccak.AbiCoder.defaultAbiCoder();
    for (const leaf of HUMAN_PASSPORT_ISSUER_LEAVES) {
      const domain = realKeccak.keccak256(enc.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [T('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), T('GitcoinVerifier'), T('1'), 8453, leaf.verifier],
      ));
      expect(leaf.domainSeparator).toBe(domain);
      expect(leaf.leaf).toBe(realKeccak.keccak256(realKeccak.concat([HUMAN_PASSPORT_ISSUER, domain, HUMAN_PASSPORT_SCORE_SCHEMA])));
    }
    const [a, b] = HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.leaf);
    expect(HUMAN_PASSPORT_ISSUER_ROOT).toBe(realKeccak.keccak256(realKeccak.concat([a, b])));
  });

  it('converts thresholds in points to score units', () => {
    expect(humanPassportScoreUnits(20)).toBe(200000);
    expect(humanPassportScoreUnits(20.5)).toBe(205000);
    expect(humanPassportScoreUnits(0.0001)).toBe(1);
    expect(humanPassportScoreUnits(429496.7295)).toBe(4294967295);
  });

  it.each([0, -1, NaN, Infinity, 20.00001, '20', null, undefined, 429496.7296, {}])(
    'refuses the threshold %p',
    bad => {
      expect(() => humanPassportScoreUnits(bad)).toThrow();
    },
  );
});

describe('checkHumanPassportProof', () => {
  it('accepts a proof anchored to Human Passport, scorer 335 and a fresh clock', async () => {
    expect(await checkHumanPassportProof(goodInputs())).toEqual({ ok: true });
  });

  it('runs through the issuer table for human_passport_score', async () => {
    expect(CIRCUIT_ISSUER_CHECKS.human_passport_score).toBeTypeOf('function');
    expect(await checkProofIssuer('human_passport_score', fixture.publicInputs)).toMatchObject({ ok: false });
    expect(await checkProofIssuer('human_passport_score', goodInputs(), { minScore: 23.386 })).toEqual({ ok: true });
  });

  it.each([0, 193, 194, 196])('refuses %i public inputs', async count => {
    const inputs = goodInputs().slice(0, Math.min(count, 195));
    while (inputs.length < count) inputs.push(field(0));
    const r = await checkHumanPassportProof(inputs);
    expect(r.ok).toBe(false);
  });

  it('refuses something that is not an array', async () => {
    expect((await checkHumanPassportProof('nope' as unknown as string[])).ok).toBe(false);
  });

  it('refuses the fixture as proved: its issuer root includes a test issuer', async () => {
    const inputs = [...fixture.publicInputs];
    inputs[L.NOW] = field(NOW);
    const r = await checkHumanPassportProof(inputs);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/signer-list root/);
  });

  it('refuses a root byte above 255', async () => {
    expect((await checkHumanPassportProof(goodInputs({ [L.MERKLE_ROOT_START]: field(256) }))).ok).toBe(false);
  });

  it.each([[0n], [336n], [BigInt(HUMAN_PASSPORT_SCORER_ID) + (1n << 64n)]])('refuses scorer %s', async scorer => {
    const r = await checkHumanPassportProof(goodInputs({ [L.SCORER_ID]: field(scorer) }));
    expect(r.ok).toBe(false);
  });

  it('refuses a scorer that is not a number', async () => {
    expect((await checkHumanPassportProof(goodInputs({ [L.SCORER_ID]: 'abc' }))).ok).toBe(false);
  });

  it('refuses min_score 0 and above u32', async () => {
    expect((await checkHumanPassportProof(goodInputs({ [L.MIN_SCORE]: field(0) }))).ok).toBe(false);
    expect((await checkHumanPassportProof(goodInputs({ [L.MIN_SCORE]: field(1n << 32n) }))).ok).toBe(false);
  });

  it('holds min_score to the requested threshold exactly', async () => {
    const at = (units: number) => goodInputs({ [L.MIN_SCORE]: field(units) });
    expect(await checkHumanPassportProof(at(200000), { minScore: 20 })).toEqual({ ok: true });
    expect((await checkHumanPassportProof(at(199999), { minScore: 20 })).ok).toBe(false);
    expect((await checkHumanPassportProof(at(200001), { minScore: 20 })).ok).toBe(false);
    expect((await checkHumanPassportProof(at(200000), { minScore: 20.0001 })).ok).toBe(false);
    expect((await checkHumanPassportProof(at(200000), { minScore: 0 })).ok).toBe(false);
  });

  it('holds now to the verifier clock', async () => {
    const at = (t: bigint | number) => checkHumanPassportProof(goodInputs({ [L.NOW]: field(t) }));
    expect((await at(NOW - HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS)).ok).toBe(true);
    expect((await at(NOW - HUMAN_PASSPORT_NOW_MAX_AGE_SECONDS - 1)).ok).toBe(false);
    expect((await at(NOW + HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS)).ok).toBe(true);
    expect((await at(NOW + HUMAN_PASSPORT_NOW_MAX_FUTURE_SECONDS + 1)).ok).toBe(false);
    expect((await at(0)).ok).toBe(false);
    expect((await at(1n << 64n)).ok).toBe(false);
    expect((await checkHumanPassportProof(goodInputs({ [L.NOW]: '-1' }))).ok).toBe(false);
    expect((await checkHumanPassportProof(goodInputs({ [L.NOW]: 'x' }))).ok).toBe(false);
  });
});

describe('layout, on a real proof', () => {
  it('reads scope and nullifier at 128 and 160, and the nullifier is the wallet + circuit-tag rule', () => {
    expect(fixture.publicInputs).toHaveLength(HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT);
    expect(fixture.proofBytes).toBe(10688);
    const scope = extractScopeFromPublicInputs(fixture.publicInputs, 'human_passport_score');
    const nullifier = extractNullifierFromPublicInputs(fixture.publicInputs, 'human_passport_score');
    const fixtureScope = realKeccak.keccak256(realKeccak.toUtf8Bytes('human-passport-score-fixture-scope'));
    expect(scope).toBe(fixtureScope);
    const wallet = new realKeccak.Wallet(realKeccak.keccak256(realKeccak.toUtf8Bytes('zkproofport human_passport_score INSECURE TEST WALLET'))).address;
    const tag = realKeccak.keccak256(realKeccak.toUtf8Bytes('human_passport_score'));
    const expected = realKeccak.keccak256(realKeccak.concat([realKeccak.keccak256(realKeccak.concat([wallet, tag])), fixtureScope]));
    expect(nullifier).toBe(expected);
    expect(Number(BigInt(fixture.publicInputs[L.SCORER_ID]))).toBe(335);
  });
});

describe('on-chain verify', () => {
  it('refuses a stale proof before calling any contract', async () => {
    const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
    Contract.mockClear();
    const inputs = goodInputs({ [L.NOW]: field(NOW - 3600) });
    const r = await verifyProofOnChain('human_passport_score', { proofHex: '0x' + '00'.repeat(10688), publicInputsHex: inputs, numPublicInputs: 195 }, {}, { chainId: 84532 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/behind this verifier's clock/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('with a fresh proof reaches the pinned contract', async () => {
    const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
    Contract.mockClear();
    const r = await verifyProofOnChain('human_passport_score', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: goodInputs(), numPublicInputs: 195 }, {}, { chainId: 84532 });
    expect(r).toEqual({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
    expect(String(Contract.mock.calls[0][0]).toLowerCase()).toBe(getPinnedVerifier('human_passport_score', 84532).address);
  });

  it('off-chain verify refuses a stale proof before fetching a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyProofOffChain('human_passport_score', '0x' + 'ab'.repeat(64), goodInputs({ [L.NOW]: field(NOW - 3600) }));
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('pins a verifier on Base Sepolia and Ethereum Sepolia', () => {
    expect(getPinnedVerifier('human_passport_score', 84532).address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(getPinnedVerifier('human_passport_score', 11155111).address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('requests', () => {
  const sdk = () => new ProofportSDK({ relayUrl: 'https://relay.invalid' } as any);

  it.each([undefined, 0, -5, '20', 20.00001, NaN])('createRelayRequest refuses minScore %p before any network call', async bad => {
    const s = sdk();
    s.setSigner({ signMessage: vi.fn(), getAddress: vi.fn() } as any);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(s.createRelayRequest('human_passport_score', { scope: 'myapp.com', minScore: bad } as any)).rejects.toThrow(/minScore/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  const link = (inputs: Record<string, unknown>) => ({
    requestId: 'r1', circuit: 'human_passport_score' as const, inputs: inputs as any,
    callbackUrl: 'https://relay.invalid/cb', createdAt: Date.now(),
  });

  it('deep-link validation accepts a threshold and an optional action', () => {
    expect(validateProofRequest(link({ scope: 'myapp.com', minScore: 20 }))).toEqual({ valid: true });
    expect(validateProofRequest(link({ scope: "x'; DROP TABLE--<script>%_", minScore: 0.0001 }))).toEqual({ valid: true });
  });

  it.each([
    [{ scope: 'myapp.com' }, /minScore/],
    [{ scope: 'myapp.com', minScore: 0 }, /minScore/],
    [{ scope: 'myapp.com', minScore: '20' }, /minScore/],
    [{ scope: 'myapp.com', minScore: 1.123456 }, /decimals/],
    [{ scope: '', minScore: 20 }, /scope/],
    [{ scope: '   ', minScore: 20 }, /scope/],
    [{ scope: 'myapp.com', minScore: 20, userAddress: '0x123' }, /userAddress/],
    [{ scope: 'myapp.com', minScore: 20, action: { domain: {} } }, /./],
  ])('deep-link validation refuses %j', (inputs, message) => {
    const r = validateProofRequest(link(inputs));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(message);
  });

  it('verifyResponseOnChain refuses a Human Passport response it cannot place', async () => {
    const r = await sdk().verifyResponseOnChain({
      requestId: 'unknown', circuit: 'human_passport_score', status: 'completed',
      proof: '0x00', publicInputs: goodInputs(), timestamp: Date.now(),
    } as any);
    expect(r).toMatchObject({ valid: false });
    expect(r.error).toMatch(/minScore/);
  });

  it('verifyResponseOnChain checks the threshold of a request it made (deep link)', async () => {
    const s = ProofportSDK.create('staging');
    const request = (s as any).createProofRequest('human_passport_score', { scope: 'myapp.com', minScore: 20 });
    const r = await s.verifyResponseOnChain({
      requestId: request.requestId, circuit: 'human_passport_score', status: 'completed',
      proof: '0x' + '00'.repeat(10688), publicInputs: goodInputs({ [L.MIN_SCORE]: field(150000) }), timestamp: Date.now(),
    } as any, {}, {});
    expect(r).toMatchObject({ valid: false });
    expect(r.error).toMatch(/threshold/);
  });
});
