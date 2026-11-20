/**
 * `human_passport_score` is judged on every verify path: 135 public inputs,
 * the issuer root at 96-127 must be Human Passport's, scorer_id (133) must be
 * Passport's scorer (335), `now` (134) is held to the verifier's clock, min_score (132)
 * is never 0 and equals the threshold the request asked for.
 *
 * Matrix (drawn up before the code):
 *   count      135 accepted; 0, 134, 136, a Coinbase v2 proof (133) refused;
 *              not an array
 *   layout     the OPRF four at 128-131 read from a REAL proof of the circuit;
 *              its nullifier recomputed by core's OPRF client from the test
 *              wallet and the circuits' test key
 *   root       Human Passport's accepted; the fixture's test-issuer root
 *              refused; root bytes above 255 refused
 *   scorer     335 accepted; 0, 336, 7922 (Shape's, chain dropped), not a
 *              number refused
 *   chains     exactly Base, OP, Arbitrum, Linea, Scroll, zkSync Era; 360
 *              (Shape), unknown ids, strings in any case, empty, null,
 *              undefined, NaN, fractions refused naming the known list;
 *              the previous seven-chain root refused
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
  HUMAN_PASSPORT_CHAINS,
  HUMAN_PASSPORT_CHAIN_IDS,
  HUMAN_PASSPORT_SCORER_IDS,
  humanPassportChain,
  humanPassportScoreUnits,
} from '../circuits';
import { ProofportSDK } from '../ProofportSDK';
import { validateProofRequest } from '../deeplink';
import { verifyProofOffChain } from '../offChainVerifier';
import { OPRF_TEST_ENVIRONMENT } from './helpers/oprfKeys';
import vectors from './fixtures/oprf-vectors.json';
import { oprfQuery, reduceOprfName } from '../../packages/core/src/oprf';
import { encodeToCurve, scalarMul } from '../../packages/core/src/oprf/babyjubjub';
import { poseidon2T4 } from '../../packages/core/src/oprf/poseidon2';
import { OPRF_DS_OUT } from '../../packages/core/src/oprf/client';

// The real proof's OPRF answer comes from the circuits' per-circuit test key;
// staging stands in for it here (helpers/oprfKeys.ts).
vi.mock('../../packages/core/src/oprfKeyHashes', async importOriginal => {
  const { withFixtureOprfKeys } = await import('./helpers/oprfKeys');
  return withFixtureOprfKeys(await importOriginal());
});
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };
/** What the fixture was made for (circuits scripts/human-passport/generate-fixtures.js). */
const FIXTURE_REQUEST = { scope: 'human-passport-score-fixture-scope', oprfDomain: 'zkproofport.app' };

// Verifiers awaiting a redeploy stand in as deployed: this file tests the
// wiring, not which contract is deployed (helpers/redeployedVerifiers.ts).
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
  it('the root is the positional tree over the published leaves, one or more per chain', () => {
    const T = (x: string) => realKeccak.keccak256(realKeccak.toUtf8Bytes(x));
    const enc = realKeccak.AbiCoder.defaultAbiCoder();
    for (const leaf of HUMAN_PASSPORT_ISSUER_LEAVES) {
      const domain = realKeccak.keccak256(enc.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [T('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), T('GitcoinVerifier'), T('1'), leaf.chainId, leaf.verifier],
      ));
      expect(leaf.domainSeparator).toBe(domain);
      const schema = humanPassportChain(leaf.chainId).schema;
      expect(leaf.leaf).toBe(realKeccak.keccak256(realKeccak.concat([HUMAN_PASSPORT_ISSUER, domain, schema])));
    }
    let level: string[] = HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.leaf);
    expect(level).toHaveLength(6);
    while (level.length < 8) level.push('0x' + '00'.repeat(32));
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(realKeccak.keccak256(realKeccak.concat([level[i], level[i + 1]])));
      level = next;
    }
    expect(HUMAN_PASSPORT_ISSUER_ROOT).toBe(level[0]);
    // Every chain has a leaf, and every leaf's chain is a listed chain.
    expect([...new Set(HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.chainId))].sort()).toEqual([...HUMAN_PASSPORT_CHAIN_IDS].sort());
  });

  it('names exactly the six chains Passport offers, all with scorer 335', () => {
    expect(HUMAN_PASSPORT_CHAIN_IDS.map(id => HUMAN_PASSPORT_CHAINS[id].name)).toEqual(['Base', 'OP Mainnet', 'Arbitrum One', 'Linea', 'Scroll', 'zkSync Era']);
    expect(Object.keys(HUMAN_PASSPORT_CHAINS).map(Number).sort((a, b) => a - b)).toEqual([10, 324, 8453, 42161, 59144, 534352]);
    expect([...HUMAN_PASSPORT_SCORER_IDS]).toEqual([335]);
    // One leaf per chain: Base's retired verifier 0x16db... is not in the list.
    expect(HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.verifier.toLowerCase())).not.toContain('0x16db23c4b99bbc9a6bf55df7a787c9aefd261185');
    expect(HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.chainId)).toEqual([...HUMAN_PASSPORT_CHAIN_IDS]);
  });

  it('refuses Shape (360) by name with the known-chain list, never another chain', () => {
    expect(() => humanPassportChain(360)).toThrow('Unknown Human Passport chain 360. Known: 8453, 10, 42161, 59144, 534352, 324.');
    expect(HUMAN_PASSPORT_ISSUER_LEAVES.some(l => l.chainId === 360)).toBe(false);
  });

  it.each([1, 360, 11155111, 84532, '8453', '360', 'shape', 'Shape', 'SHAPE', 'base', 'Base', '', ' ', null, undefined, NaN, 0, -1, 1.5, 8453.0000001, [8453], {}])(
    'humanPassportChain refuses %p by name, listing the known chains',
    id => {
      expect(() => humanPassportChain(id)).toThrow(/Unknown Human Passport chain .*Known: 8453, 10, 42161, 59144, 534352, 324\./);
    },
  );

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

  it('refuses scorer 7922 (Shape\'s scorer) now that Shape is not a listed chain', async () => {
    const r = await checkHumanPassportProof(goodInputs({ [L.SCORER_ID]: field(7922) }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/scorer_id is 7922; only Human Passport's scorers 335 are accepted/);
  });

  it('refuses a proof under the previous seven-chain root (it held Shape and Base 0x16db...)', async () => {
    const inputs = goodInputs();
    const old = realKeccak.getBytes('0xea6d30773f6870aae6384b8aa91f9eb665c40719e13d98acd9afcbe3d79188c8');
    for (let i = 0; i < 32; i++) inputs[L.MERKLE_ROOT_START + i] = field(old[i]);
    expect(await checkHumanPassportProof(inputs)).toMatchObject({ ok: false });
  });

  it('runs through the issuer table for human_passport_score', async () => {
    expect(CIRCUIT_ISSUER_CHECKS.human_passport_score).toBeTypeOf('function');
    expect(await checkProofIssuer('human_passport_score', fixture.publicInputs, ENV)).toMatchObject({ ok: false });
    expect(await checkProofIssuer('human_passport_score', goodInputs(), { ...ENV, minScore: 23.386 })).toEqual({ ok: true });
  });

  it.each([0, 133, 134, 136, 195])('refuses %i public inputs', async count => {
    const inputs = goodInputs().slice(0, Math.min(count, 135));
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

  it.each([[0n], [336n], [7921n], [335n + (1n << 64n)]])('refuses scorer %s', async scorer => {
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
  it('reads the OPRF four at 128-131, and core recomputes the nullifier from the wallet and the test key', () => {
    expect(fixture.publicInputs).toHaveLength(HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT);
    expect((fixture.proof.length - 2) / 2).toBe(10688);
    const scope = extractScopeFromPublicInputs(fixture.publicInputs, 'human_passport_score');
    const nullifier = extractNullifierFromPublicInputs(fixture.publicInputs, 'human_passport_score');
    expect(scope).toBe(reduceOprfName(FIXTURE_REQUEST.scope));
    expect(fixture.publicInputs[L.OPRF_DOMAIN]).toBe(reduceOprfName(FIXTURE_REQUEST.oprfDomain));
    const key = vectors.evaluations.find(e => e.note === 'circuits fixture key for human_passport_score (oprf.js fixtureKey)')!;
    expect(fixture.publicInputs[L.OPRF_KEY_HASH]).toBe(key.keyHash);
    const wallet = new realKeccak.Wallet(realKeccak.keccak256(realKeccak.toUtf8Bytes('zkproofport human_passport_score INSECURE TEST WALLET'))).address;
    const query = BigInt(oprfQuery({ address: wallet, domain: reduceOprfName(FIXTURE_REQUEST.oprfDomain), scope: scope! }));
    const p = scalarMul(encodeToCurve(query), BigInt(key.secretKey));
    expect(nullifier).toBe('0x' + poseidon2T4([OPRF_DS_OUT, query, p.x, p.y])[1].toString(16).padStart(64, '0'));
    expect(Number(BigInt(fixture.publicInputs[L.SCORER_ID]))).toBe(335);
  });
});

describe('on-chain verify', () => {
  it('refuses a stale proof before calling any contract', async () => {
    const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
    Contract.mockClear();
    const inputs = goodInputs({ [L.NOW]: field(NOW - 3600) });
    const r = await verifyProofOnChain('human_passport_score', { proofHex: '0x' + '00'.repeat(10688), publicInputsHex: inputs, numPublicInputs: 135 }, {}, { chainId: 84532 }, undefined, ENV);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/behind this verifier's clock/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('with a fresh proof reaches the pinned contract', async () => {
    const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
    Contract.mockClear();
    const r = await verifyProofOnChain('human_passport_score', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: goodInputs(), numPublicInputs: 135 }, {}, { chainId: 84532 }, undefined, ENV);
    expect(r).toMatchObject({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
    expect(String(Contract.mock.calls[0][0]).toLowerCase()).toBe(getPinnedVerifier('human_passport_score', 84532).address);
  });

  it('off-chain verify refuses a stale proof before fetching a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyProofOffChain('human_passport_score', '0x' + 'ab'.repeat(64), goodInputs({ [L.NOW]: field(NOW - 3600) }), ENV);
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    [1, '0xbb8a7e058f86680ddcfe0df00e8f729ebcf27605'],
    [8453, '0x2d055c42a2b0c1024ac4aa83b4995fc8fd45662e'],
    [84532, '0x39df92d9c603fe6d229c7b00272a1e874a628ace'],
    [11155111, '0xc78585718fd27d428d7a90970d09a2121be36066'],
  ])('the verifier on chain %i (built from a bb 4.2 key) awaits a redeploy and is pinned nowhere', async (chainId, address) => {
    // The real generated table: this file's mock stands redeployed verifiers in.
    // After the redeploy, regenerate and write the new addresses here.
    const real = await vi.importActual<typeof import('../../packages/core/src/pinnedVerifiers.generated')>('../../packages/core/src/pinnedVerifiers.generated');
    expect(real.AWAITING_REDEPLOY).toContainEqual(
      expect.objectContaining({ circuit: 'human_passport_score', variant: 'standard', chainId, previousAddress: address }),
    );
    expect(real.PINNED_VERIFIERS.human_passport_score[chainId]).toBeUndefined();
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
    expect(validateProofRequest(link({ scope: 'myapp.com', minScore: 20 }))).toMatchObject({ valid: true });
    expect(validateProofRequest(link({ scope: "x'; DROP TABLE--<script>%_", minScore: 0.0001 }))).toMatchObject({ valid: true });
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
    } as any, undefined, { request: { scope: 'myapp.com', requestId: 'unknown' } });
    expect(r).toMatchObject({ valid: false });
    expect(r.error).toMatch(/minScore/);
  });

  it('verifyResponseOnChain checks the threshold of a request it made (deep link)', async () => {
    const s = ProofportSDK.create('staging');
    const request = (s as any).createProofRequest('human_passport_score', { ...FIXTURE_REQUEST, minScore: 20 });
    const r = await s.verifyResponseOnChain({
      requestId: request.requestId, circuit: 'human_passport_score', status: 'completed',
      proof: '0x' + '00'.repeat(10688), publicInputs: goodInputs({ [L.MIN_SCORE]: field(150000) }), timestamp: Date.now(),
    } as any, {}, {});
    expect(r).toMatchObject({ valid: false });
    expect(r.error).toMatch(/threshold/);
  });
});
