/**
 * signal_hash without the wallet: keccak256(scope ++ circuitId ++ requestId)
 * (core's computeSignalHash), and the check a relying party runs with it
 * (checkSignalHash, run by checkProofIssuer whenever a request is given, and
 * by verifyResponse* for every request this SDK created).
 *
 * Matrix, written before the code:
 *  - vectors: the shared file every implementation reads (oracle: ethers'
 *    solidityPackedKeccak256), so a re-added wallet address fails here
 *  - the address is not in the preimage: no wallet-prefixed preimage gives a vector
 *  - same inputs -> same hash; another requestId / scope / circuit -> another hash
 *  - scope: empty, whitespace, null/undefined/number, unpaired surrogates,
 *    4096 bytes accepted, 4097 refused, multibyte crossing the cap, hostile text
 *  - requestId: empty, null, 128 accepted, 129 refused, '_', space, newline,
 *    non-ASCII, '%'
 *  - circuit: unknown id and a hyphenated alias refused by name; OIDC has none
 *  - check: the right request accepted; another request, scope or circuit
 *    refused; action-bound with zero signal accepted; both refused; malformed
 *    fields and short arrays refused; never throws
 *  - every verify path: checkProofIssuer runs it only with a request; the SDK
 *    supplies the request it remembered and refuses a response it cannot place
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import vectors from './fixtures/signal-hash-vectors.json';
import { ProofportSDK } from '../ProofportSDK';
import {
  ALL_CIRCUIT_IDS,
  SIGNAL_HASH_CIRCUIT_IDS,
  SIGNAL_HASH_LAYOUTS,
  SIGNAL_HASH_MAX_REQUEST_ID_LENGTH,
  SIGNAL_HASH_MAX_SCOPE_BYTES,
  checkProofIssuer,
  checkSignalHash,
  computeSignalHash,
} from '../verifier';
import type { ProofResponse } from '../types';
import { fillOprf, OPRF_TEST_ENVIRONMENT } from './helpers/signerFixtures';

// setup.ts mocks ethers for the SDK; the oracle here must be the real one.
const { ethers } = (await vi.importActual<typeof import('ethers')>('ethers'));

const REQ = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f';
const OTHER_REQ = '9a1c7e3b-2f5d-4c8a-b6e1-0d4f2a8c6b19';
const SCOPE = 'myapp.com';
const WALLET = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';

const field = (b: number) => '0x' + b.toString(16).padStart(64, '0');
const bytes = (hex: string) => Array.from(ethers.getBytes(hex));

const OPRF_DOMAIN = 'zkproofport.app';
const ENV = { oprfEnvironment: OPRF_TEST_ENVIRONMENT };
/** `inputs` with the OPRF four an honest prover for SCOPE / OPRF_DOMAIN under the test key writes. */
const withOprf = (inputs: string[], circuit: 'dojang_playground' | 'giwa_attestation') =>
  fillOprf(inputs, circuit, { scope: SCOPE, oprfDomain: OPRF_DOMAIN });

/** Public inputs of a wallet circuit with the given signal and action hash; the rest zero. */
function publicInputs(signal: string, actionHash = '0x' + '00'.repeat(32), count = 160): string[] {
  const out = Array(count).fill(field(0));
  bytes(signal).forEach((b, i) => (out[i] = field(b)));
  bytes(actionHash).forEach((b, i) => (out[64 + i] = field(b)));
  return out;
}

describe('computeSignalHash', () => {
  it.each(vectors.vectors.map(v => [v.note, v] as const))('matches the shared vector: %s', (_n, v) => {
    expect(computeSignalHash({ scope: v.scope, circuitId: v.circuitId, requestId: v.requestId })).toBe(v.signalHash);
  });

  it('no wallet-prefixed preimage reproduces a vector (the address is gone)', () => {
    for (const v of vectors.vectors) {
      for (const wallet of [WALLET, ethers.Wallet.createRandom().address]) {
        const withAddress = ethers.solidityPackedKeccak256(['address', 'string', 'string', 'string'], [wallet, v.scope, v.circuitId, v.requestId]);
        const oldRule = ethers.solidityPackedKeccak256(['address', 'string', 'string'], [wallet, v.scope, v.circuitId]);
        expect(v.signalHash).not.toBe(withAddress);
        expect(v.signalHash).not.toBe(oldRule);
      }
    }
  });

  it('is the same for the same request, and differs per request, scope and circuit', () => {
    const base = { scope: SCOPE, circuitId: 'coinbase_attestation', requestId: REQ };
    const h = computeSignalHash(base);
    expect(computeSignalHash({ ...base })).toBe(h);
    expect(computeSignalHash({ ...base, requestId: OTHER_REQ })).not.toBe(h);
    expect(computeSignalHash({ ...base, scope: 'myapp.co' })).not.toBe(h);
    expect(computeSignalHash({ ...base, circuitId: 'giwa_attestation' })).not.toBe(h);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('accepts every circuit that has a signal_hash and only those', () => {
    expect([...SIGNAL_HASH_CIRCUIT_IDS].sort()).toEqual(ALL_CIRCUIT_IDS.filter(id => id !== 'oidc_domain_attestation').sort());
    for (const id of SIGNAL_HASH_CIRCUIT_IDS) expect(() => computeSignalHash({ scope: SCOPE, circuitId: id, requestId: REQ })).not.toThrow();
  });

  it.each([
    ['unknown id', 'coinbase_kyc', /Unknown circuit 'coinbase_kyc'\. Known: coinbase_attestation/],
    ['hyphenated route name', 'coinbase-attestation', /Unknown circuit 'coinbase-attestation'/],
    ['empty id', '', /Unknown circuit ''/],
    ['OIDC (no signal_hash)', 'oidc_domain_attestation', /oidc_domain_attestation has no signal_hash/],
  ])('refuses the circuit: %s', (_n, circuitId, msg) => {
    expect(() => computeSignalHash({ scope: SCOPE, circuitId, requestId: REQ })).toThrow(msg);
  });

  it.each([
    ['empty', '', /scope is empty/],
    ['whitespace only', ' \t\n', /scope is empty/],
    ['null', null, /scope must be a string, got null/],
    ['undefined', undefined, /scope must be a string, got undefined/],
    ['a number', 42, /scope must be a string, got number/],
    ['an unpaired high surrogate', 'ab\uD800c', /unpaired surrogate at index 2/],
    ['an unpaired low surrogate', '\uDC00', /unpaired surrogate at index 0/],
    ['a trailing high surrogate', 'abc\uD83D', /unpaired surrogate at index 3/],
    ['4097 bytes', 'a'.repeat(SIGNAL_HASH_MAX_SCOPE_BYTES + 1), /scope is 4097 bytes; the limit is 4096/],
    ['1366 Korean characters (4098 bytes)', '가'.repeat(1366), /scope is 4098 bytes/],
  ])('refuses the scope: %s', (_n, scope, msg) => {
    expect(() => computeSignalHash({ scope: scope as string, circuitId: 'coinbase_attestation', requestId: REQ })).toThrow(msg);
  });

  it('accepts a scope of exactly 4096 bytes, and emoji pairs', () => {
    expect(() => computeSignalHash({ scope: 'a'.repeat(4096), circuitId: 'coinbase_attestation', requestId: REQ })).not.toThrow();
    expect(() => computeSignalHash({ scope: '🔐🔐', circuitId: 'coinbase_attestation', requestId: REQ })).not.toThrow();
  });

  it.each([
    ['empty', '', /requestId is empty/],
    ['null', null, /requestId must be a string, got null/],
    ['undefined', undefined, /requestId must be a string, got undefined/],
    ['129 characters', 'x'.repeat(SIGNAL_HASH_MAX_REQUEST_ID_LENGTH + 1), /requestId is 129 characters; the limit is 128/],
    ['an underscore (would make the packing ambiguous)', 'req_1', /only ASCII letters, digits and '-'/],
    ['a space', 'req 1', /only ASCII/],
    ['a newline', 'req\n1', /only ASCII/],
    ['non-ASCII', '요청-1', /only ASCII/],
    ['a percent sign', 'req%1', /only ASCII/],
  ])('refuses the requestId: %s', (_n, requestId, msg) => {
    expect(() => computeSignalHash({ scope: SCOPE, circuitId: 'coinbase_attestation', requestId: requestId as string })).toThrow(msg);
  });
});

describe('checkSignalHash', () => {
  const request = { scope: SCOPE, requestId: REQ };
  const expected = (circuitId: string, r = request) => computeSignalHash({ circuitId, ...r });

  it.each(SIGNAL_HASH_CIRCUIT_IDS.map(id => [id]))('%s: accepts the proof made for this request', id => {
    expect(checkSignalHash(id, publicInputs(expected(id)), request)).toEqual({ ok: true });
  });

  it('refuses a proof made for another request, scope or circuit, naming the request', () => {
    const id = 'coinbase_attestation';
    for (const signal of [
      expected(id, { scope: SCOPE, requestId: OTHER_REQ }),
      expected(id, { scope: 'other.com', requestId: REQ }),
      expected('giwa_attestation'),
      ethers.solidityPackedKeccak256(['address', 'string', 'string'], [WALLET, SCOPE, id]),
    ]) {
      expect(checkSignalHash(id, publicInputs(signal), request)).toEqual({
        ok: false,
        error: expect.stringMatching(new RegExp(`not the one for request ${REQ}`)),
      });
    }
  });

  it('refuses an all-zero signal_hash without an action', () => {
    expect(checkSignalHash('coinbase_attestation', publicInputs('0x' + '00'.repeat(32)), request).ok).toBe(false);
  });

  it('accepts an action-bound proof (zero signal_hash) whatever the request', () => {
    const action = '0x' + '5a'.repeat(32);
    expect(checkSignalHash('giwa_attestation', publicInputs('0x' + '00'.repeat(32), action), { scope: 'x', requestId: OTHER_REQ })).toEqual({ ok: true });
  });

  it('refuses a proof that carries both an action and a signal_hash', () => {
    const r = checkSignalHash('giwa_attestation', publicInputs(expected('giwa_attestation'), '0x' + '5a'.repeat(32)), request);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/both an action and signal_hash/) });
  });

  it.each([
    ['a byte above 255', (p: string[]) => { p[3] = field(256); }, /Public input 3 \(signal_hash byte 3\) is out of range: 256/],
    ['a negative byte', (p: string[]) => { p[0] = '-1'; }, /out of range: -1/],
    ['a non-number', (p: string[]) => { p[5] = 'zz'; }, /Public input 5 \(signal_hash byte 5\) is not a number/],
    ['an action byte that is not a number', (p: string[]) => { p[70] = 'zz'; }, /Public input 70 \(action_hash byte 6\)/],
  ])('refuses malformed public inputs: %s', (_n, mutate, msg) => {
    const p = publicInputs(expected('coinbase_attestation'));
    mutate(p);
    expect(checkSignalHash('coinbase_attestation', p, request)).toEqual({ ok: false, error: expect.stringMatching(msg) });
  });

  it('refuses too few public inputs, an unknown circuit, OIDC and a malformed request without throwing', () => {
    expect(checkSignalHash('coinbase_attestation', publicInputs(expected('coinbase_attestation')).slice(0, 95), request).ok).toBe(false);
    expect(checkSignalHash('nope', [], request)).toEqual({ ok: false, error: expect.stringMatching(/Unknown circuit 'nope'/) });
    expect(checkSignalHash('oidc_domain_attestation', [], request)).toEqual({ ok: false, error: expect.stringMatching(/has no signal_hash/) });
    expect(checkSignalHash('coinbase_attestation', [], null as never).ok).toBe(false);
    expect(checkSignalHash('coinbase_attestation', null as never, request).ok).toBe(false);
    expect(checkSignalHash('coinbase_attestation', publicInputs(expected('coinbase_attestation')), { scope: '', requestId: REQ })).toEqual({
      ok: false, error: 'scope is empty.',
    });
  });

  it('reads signal_hash and action_hash at the offsets the table names', () => {
    for (const id of SIGNAL_HASH_CIRCUIT_IDS) expect(SIGNAL_HASH_LAYOUTS[id]).toEqual({ signalStart: 0, actionHashStart: 64 });
    expect(SIGNAL_HASH_LAYOUTS.oidc_domain_attestation).toBeNull();
  });
});

describe('checkProofIssuer runs the request binding', () => {
  it('refuses a dojang_playground proof for another request (no issuer check of its own)', async () => {
    const p = withOprf(publicInputs(computeSignalHash({ scope: SCOPE, circuitId: 'dojang_playground', requestId: OTHER_REQ }), undefined, 100), 'dojang_playground');
    expect(await checkProofIssuer('dojang_playground', p, { ...ENV, request: { scope: SCOPE, requestId: REQ, oprfDomain: OPRF_DOMAIN } })).toEqual({
      ok: false, error: expect.stringMatching(/not the one for request/),
    });
    expect(await checkProofIssuer('dojang_playground', p, { ...ENV, request: { scope: SCOPE, requestId: OTHER_REQ, oprfDomain: OPRF_DOMAIN } })).toEqual({ ok: true });
  });

  it('does not run it when no request is given', async () => {
    const p = withOprf(publicInputs('0x' + '77'.repeat(32), undefined, 100), 'dojang_playground');
    expect(await checkProofIssuer('dojang_playground', p, ENV)).toEqual({ ok: true });
  });

  it('runs it before the circuit issuer check (a wrong signal is the reason, not the signer root)', async () => {
    const p = withOprf(publicInputs('0x' + '77'.repeat(32), undefined, 132), 'giwa_attestation');
    expect(await checkProofIssuer('giwa_attestation', p, { ...ENV, request: { scope: SCOPE, requestId: REQ, oprfDomain: OPRF_DOMAIN } })).toEqual({
      ok: false, error: expect.stringMatching(/signal_hash/),
    });
  });
});

describe('the SDK checks the signal_hash of the requests it created', () => {
  const PROOF = '0x' + 'ab'.repeat(64);
  afterEach(() => vi.restoreAllMocks());

  async function sdkWithRelayRequest(circuit: 'dojang_playground' | 'giwa_attestation', requestId = REQ) {
    const sdk = ProofportSDK.create('staging');
    sdk.setSigner({ signMessage: async () => '0x' + '22'.repeat(65), getAddress: async () => '0x' + '33'.repeat(20) } as never);
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/challenge')) {
        return { ok: true, json: async () => ({ requestId, challenge: '0x' + '11'.repeat(32), expiresAt: Date.now() + 60000 }) };
      }
      if (String(url).includes('/proof/request')) {
        return { ok: true, json: async () => ({ requestId, deepLink: 'zkproofport://x', status: 'pending', pollUrl: '/p' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as never;
    await sdk.createRelayRequest(circuit, { scope: SCOPE, oprfDomain: OPRF_DOMAIN } as never);
    return sdk;
  }
  const resp = (circuit: ProofResponse['circuit'], inputs: string[], requestId = REQ): ProofResponse =>
    ({ requestId, circuit, status: 'completed', proof: PROOF, publicInputs: inputs });

  it('refuses a response made for another request, with nothing passed back in', async () => {
    const sdk = await sdkWithRelayRequest('dojang_playground');
    const inputs = withOprf(publicInputs(computeSignalHash({ scope: SCOPE, circuitId: 'dojang_playground', requestId: OTHER_REQ }), undefined, 100), 'dojang_playground');
    const r = await sdk.verifyResponseOffChain(resp('dojang_playground', inputs), { verificationKey: new Uint8Array(1) });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/not the one for request/) });
  });

  it('passes the binding for the right request (the failure is then elsewhere, never the request)', async () => {
    const sdk = await sdkWithRelayRequest('dojang_playground');
    const inputs = withOprf(publicInputs(computeSignalHash({ scope: SCOPE, circuitId: 'dojang_playground', requestId: REQ }), undefined, 100), 'dojang_playground');
    const r = await sdk.verifyResponseOffChain(resp('dojang_playground', inputs), { verificationKey: new Uint8Array(1) });
    expect(r.error ?? '').not.toMatch(/signal_hash|request/);
  });

  it('refuses a wallet response for a requestId it never created, naming the option to pass', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOnChain(resp('giwa_attestation', withOprf(publicInputs('0x' + '77'.repeat(32), undefined, 132), 'giwa_attestation')), {});
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/signal_hash cannot be checked.*Pass \{ request: \{ scope, requestId, oprfDomain \} \}/) });
  });

  it('refuses an explicit request whose requestId is not the response\'s', async () => {
    const sdk = ProofportSDK.create('staging');
    const r = await sdk.verifyResponseOnChain(resp('giwa_attestation', withOprf(publicInputs('0x' + '77'.repeat(32), undefined, 132), 'giwa_attestation')), {},
      { request: { scope: SCOPE, requestId: OTHER_REQ } });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/is not the one this response answers/) });
  });
});
