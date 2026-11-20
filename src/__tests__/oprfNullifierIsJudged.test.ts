/**
 * Every verify path judges a wallet credential proof's OPRF nullifier
 * (circuits/oprf-nullifier-libs/README.md, "What a verifier checks"):
 * its key hash against the one pinned for the proof type and environment
 * (core's OPRF_KEY_HASHES, the REAL table here -- no mock), and its domain and
 * scope against keccak256 mod p of the strings the request named.
 *
 * Matrix (drawn up before the code):
 *   key table    staging and local = TACEO's test key hash, for every proof
 *                type; production has no row and refuses by name; an unknown
 *                environment ('', 'Production', 'prod', null, '__proto__') and
 *                an unknown circuit refuse by name; OIDC has no OPRF nullifier
 *   key hash     the pinned hash accepted; hash + 1, the circuits' fixture
 *                key, the TACEO hash under production, 0, p - 1 refused; the
 *                environment missing refuses naming the option
 *   domain/scope right pair accepted; another domain, another scope, the two
 *                swapped (named), the raw keccak256 (not reduced) refused;
 *                Korean / emoji / SQL / markup names compared as bytes; NFC vs
 *                NFD differ; no request -> domain/scope not compared, key
 *                still is; request without oprfDomain refused naming it; a
 *                request name the node would refuse (257 bytes, RLO, empty,
 *                null) refused naming why
 *   values       a public input at p, at 2^256 - 1, not a number refused;
 *                every earlier count named; another count refused
 *   wiring       checkProofIssuer, core verifyProofOnChain and
 *                verifyProofOffChain all refuse a wrong key hash and a wrong
 *                scope before any contract call or key fetch; the SDK passes
 *                its own environment and the request's oprfDomain (relay and
 *                deep link), and a custom-config SDK without an environment
 *                refuses naming oprfEnvironment
 *   authz/race   N/A: pure checks over public inputs; no caller identity and
 *                no async path beyond the ones under "wiring"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  OPRF_CIRCUIT_IDS,
  OPRF_ENVIRONMENTS,
  OPRF_KEY_HASHES,
  OPRF_PUBLIC_INPUT_LAYOUTS,
  TACEO_TESTNET_OPRF_KEY_HASH,
  checkOprfProof,
  checkProofIssuer,
  getPinnedOprfKeyHash,
  reduceOprfName,
  verifyProofOnChain,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { ProofportSDK } from '../ProofportSDK';
import type { ProofResponse } from '../types';
import { attestationInputs, fillOprf, TEST_REQUEST } from './helpers/signerFixtures';
import vectors from './fixtures/oprf-vectors.json';

vi.mock('../../packages/core/src/pinnedVerifiers.generated', async importOriginal => {
  const { withRedeployedVerifiers } = await import('./helpers/redeployedVerifiers');
  return withRedeployedVerifiers(await importOriginal());
});
vi.mock('@aztec-foundation/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: { verifyProof: unknown }) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const hex = (v: bigint) => '0x' + v.toString(16).padStart(64, '0');
const STAGING = { oprfEnvironment: 'staging' };
const REQ = { scope: TEST_REQUEST.scope, oprfDomain: TEST_REQUEST.oprfDomain };
const fixtureKeyHash = vectors.evaluations.find(e => e.note === 'circuits fixture key for coinbase_attestation (oprf.js fixtureKey)')!.keyHash;

beforeEach(() => {
  Contract.mockClear();
});

/** Synthetic GIWA inputs (it has a signer root but no clock), OPRF four as an honest prover for REQ under staging's key. */
const giwa = () => attestationInputs('giwa_attestation');
const L = OPRF_PUBLIC_INPUT_LAYOUTS.giwa_attestation;

describe('the key table', () => {
  it('staging and local pin TACEO\'s test network key for every proof type; production pins nothing', () => {
    for (const env of ['staging', 'local'] as const) {
      for (const id of OPRF_CIRCUIT_IDS) expect(getPinnedOprfKeyHash(env, id)).toBe(TACEO_TESTNET_OPRF_KEY_HASH);
    }
    expect(OPRF_KEY_HASHES.production).toBeNull();
    expect(TACEO_TESTNET_OPRF_KEY_HASH).toBe(vectors.network.keyHash);
    expect([...OPRF_ENVIRONMENTS]).toEqual(['production', 'staging', 'local']);
  });

  it.each(OPRF_CIRCUIT_IDS)('production refuses %s by name, never falling back to the test key', id => {
    expect(() => getPinnedOprfKeyHash('production', id)).toThrow(
      "No OPRF key is registered for the 'production' environment, so no wallet credential proof can be verified there yet.",
    );
  });

  it.each([[''], ['Production'], ['prod'], ['testnet'], [null], [undefined], ['__proto__'], ['constructor']])('an unknown environment %j is refused by name', env => {
    expect(() => getPinnedOprfKeyHash(env, 'coinbase_attestation')).toThrow(`Unknown OPRF environment '${String(env)}'. Known: production, staging, local.`);
  });

  it.each([['coinbase-kyc'], [''], ['__proto__'], [undefined]])('an unknown circuit %j is refused by name', id => {
    expect(() => getPinnedOprfKeyHash('staging', id)).toThrow(`Unknown circuit '${String(id)}'`);
  });

  it('OIDC has no OPRF nullifier and no row', () => {
    expect(() => getPinnedOprfKeyHash('staging', 'oidc_domain_attestation')).toThrow('oidc_domain_attestation has no OPRF nullifier');
    expect(OPRF_CIRCUIT_IDS).not.toContain('oidc_domain_attestation');
  });
});

describe('the key hash', () => {
  it('the pinned hash is accepted', () => {
    expect(checkOprfProof('giwa_attestation', giwa(), STAGING)).toEqual({ ok: true });
    expect(checkOprfProof('giwa_attestation', giwa(), { oprfEnvironment: 'local' })).toEqual({ ok: true });
  });

  it.each([
    ['hash + 1', hex(BigInt(TACEO_TESTNET_OPRF_KEY_HASH) + 1n)],
    ['the circuits\' fixture key', fixtureKeyHash],
    ['zero', hex(0n)],
    ['p - 1', hex(P - 1n)],
  ])('%s is refused, naming both hashes', (_label, keyHash) => {
    const inputs = giwa();
    inputs[L.keyHash] = keyHash;
    const r = checkOprfProof('giwa_attestation', inputs, STAGING);
    expect(r).toEqual({
      ok: false,
      error: `The proof's OPRF key hash ${keyHash} is not the key pinned for giwa_attestation in 'staging' (${TACEO_TESTNET_OPRF_KEY_HASH}), so its nullifier may come from a key someone else holds.`,
    });
  });

  it('the staging key under production is refused, by the missing row', () => {
    expect(checkOprfProof('giwa_attestation', giwa(), { oprfEnvironment: 'production' })).toEqual({
      ok: false,
      error: "No OPRF key is registered for the 'production' environment, so no wallet credential proof can be verified there yet.",
    });
  });

  it('a missing environment is refused naming the option, not defaulted', () => {
    expect(checkOprfProof('giwa_attestation', giwa(), {})).toEqual({
      ok: false,
      error: expect.stringMatching(/^oprfEnvironment is required to verify a giwa_attestation proof/),
    });
  });

  it('unknown circuit and OIDC are refused by name', () => {
    expect(checkOprfProof('coinbase-kyc', giwa(), STAGING)).toEqual({ ok: false, error: expect.stringMatching(/^Unknown circuit 'coinbase-kyc'/) });
    expect(checkOprfProof('oidc_domain_attestation', giwa(), STAGING)).toEqual({ ok: false, error: 'oidc_domain_attestation has no OPRF nullifier.' });
  });
});

describe('domain and scope', () => {
  it('the right pair is accepted', () => {
    expect(checkOprfProof('giwa_attestation', giwa(), { ...STAGING, request: REQ })).toEqual({ ok: true });
  });

  it('another domain is refused', () => {
    const r = checkOprfProof('giwa_attestation', giwa(), { ...STAGING, request: { ...REQ, oprfDomain: 'evil.example' } });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^The proof's OPRF domain .* is not keccak256\("evil.example"\) mod p/) });
  });

  it('another scope is refused', () => {
    const r = checkOprfProof('giwa_attestation', giwa(), { ...STAGING, request: { ...REQ, scope: 'myapp.com ' } });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^The proof's scope .* is not keccak256\("myapp.com "\) mod p/) });
  });

  it('domain and scope swapped are refused, and named', () => {
    const inputs = giwa();
    [inputs[L.domain], inputs[L.scope]] = [inputs[L.scope], inputs[L.domain]];
    const r = checkOprfProof('giwa_attestation', inputs, { ...STAGING, request: REQ });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Domain and scope are swapped\.$/) });
  });

  it('a raw keccak256 (not reduced mod p) is refused: the circuit never publishes one', () => {
    const inputs = giwa();
    const raw = BigInt(ethers.keccak256(ethers.toUtf8Bytes(REQ.oprfDomain)));
    expect(raw >= P).toBe(true);
    inputs[L.domain] = hex(raw);
    expect(checkOprfProof('giwa_attestation', inputs, { ...STAGING, request: REQ })).toEqual({
      ok: false, error: expect.stringMatching(/Public input 129 \(domain\) is not below the field modulus/),
    });
  });

  it.each([
    ['Korean and emoji', { scope: '투표 2026 🗳️', oprfDomain: '한국어 도메인' }],
    ['SQL and markup', { scope: "%_\\' OR 1=1; <script>x</script>", oprfDomain: 'zkproofport.app' }],
    ['256 bytes each', { scope: 'a'.repeat(256), oprfDomain: '가'.repeat(85) }],
  ])('%s are compared as their UTF-8 bytes', (_label, req) => {
    const inputs = fillOprf(giwa(), 'giwa_attestation', req);
    expect(checkOprfProof('giwa_attestation', inputs, { ...STAGING, request: req })).toEqual({ ok: true });
  });

  it('NFC and NFD are two scopes', () => {
    const inputs = fillOprf(giwa(), 'giwa_attestation', { scope: 'é', oprfDomain: REQ.oprfDomain });
    expect(checkOprfProof('giwa_attestation', inputs, { ...STAGING, request: { scope: 'é', oprfDomain: REQ.oprfDomain } }).ok).toBe(false);
  });

  it('without a request, domain and scope are not compared; the key hash still is', () => {
    const inputs = giwa();
    inputs[L.scope] = reduceOprfName('anything');
    expect(checkOprfProof('giwa_attestation', inputs, STAGING)).toEqual({ ok: true });
    inputs[L.keyHash] = fixtureKeyHash;
    expect(checkOprfProof('giwa_attestation', inputs, STAGING).ok).toBe(false);
  });

  it('a request that names no OPRF domain is refused, naming the field', () => {
    expect(checkOprfProof('giwa_attestation', giwa(), { ...STAGING, request: { scope: REQ.scope } })).toEqual({
      ok: false, error: "The request names no OPRF domain, so the proof's OPRF domain cannot be checked. Pass request.oprfDomain.",
    });
  });

  it.each([
    ['257 bytes', { scope: 'a'.repeat(257), oprfDomain: REQ.oprfDomain }, /scope cannot be an OPRF name \(too-long\)/],
    ['a bidi override', { scope: REQ.scope, oprfDomain: 'zk‮proofport.app' }, /OPRF domain cannot be an OPRF name \(format-character\)/],
    ['an empty scope', { scope: '', oprfDomain: REQ.oprfDomain }, /scope cannot be an OPRF name \(empty\)/],
    ['a null domain', { scope: REQ.scope, oprfDomain: null }, /OPRF domain cannot be an OPRF name \(not-a-string\)/],
    ['a lone surrogate', { scope: 'a\ud800', oprfDomain: REQ.oprfDomain }, /scope cannot be an OPRF name \(not-utf8\)/],
  ])('a request name the node would refuse (%s) is refused, naming why', (_label, req, message) => {
    expect(checkOprfProof('giwa_attestation', giwa(), { ...STAGING, request: req as never })).toEqual({ ok: false, error: expect.stringMatching(message) });
  });
});

describe('values and counts', () => {
  it.each([
    ['p', hex(P)],
    ['2^256 - 1', '0x' + 'ff'.repeat(32)],
    ['not a number', '<script>'],
    ['empty', ''],
  ])('a nullifier that is %s is refused', (_label, value) => {
    const inputs = giwa();
    inputs[L.nullifier] = value;
    expect(checkOprfProof('giwa_attestation', inputs, STAGING).ok).toBe(false);
  });

  it.each([[192, /GIWA proof made before the OPRF nullifier/], [131, /has 132 public inputs; got 131/], [133, /got 133/], [0, /got 0/]])('%i public inputs are refused', (n, message) => {
    const inputs = Array.from({ length: n }, () => hex(0n));
    expect(checkOprfProof('giwa_attestation', inputs, STAGING)).toEqual({ ok: false, error: expect.stringMatching(message) });
  });
});

describe('every verify path runs it before any contract or key', () => {
  const PROOF = '0x' + 'ab'.repeat(64);
  const wrongKey = () => {
    const inputs = giwa();
    inputs[L.keyHash] = fixtureKeyHash;
    return inputs;
  };
  const wrongScope = () => fillOprf(giwa(), 'giwa_attestation', { scope: 'another.app', oprfDomain: REQ.oprfDomain });

  it('checkProofIssuer', async () => {
    expect(await checkProofIssuer('giwa_attestation', giwa(), { ...STAGING, request: { ...TEST_REQUEST } })).toEqual({ ok: true });
    expect((await checkProofIssuer('giwa_attestation', wrongKey(), STAGING)).ok).toBe(false);
    expect(await checkProofIssuer('giwa_attestation', wrongScope(), { ...STAGING, request: { ...TEST_REQUEST } })).toEqual({
      ok: false, error: expect.stringMatching(/^The proof's scope/),
    });
    expect(await checkProofIssuer('giwa_attestation', giwa(), {})).toEqual({ ok: false, error: expect.stringMatching(/^oprfEnvironment is required/) });
  });

  it('core verifyProofOnChain', async () => {
    const parsed = (i: string[]) => ({ proofHex: PROOF, publicInputsHex: i, numPublicInputs: i.length });
    expect(await verifyProofOnChain('giwa_attestation', parsed(wrongKey()), {}, { chainId: 91342 }, undefined, STAGING)).toEqual({
      valid: false, error: expect.stringMatching(/OPRF key hash/),
    });
    expect(await verifyProofOnChain('giwa_attestation', parsed(wrongScope()), {}, { chainId: 91342 }, undefined, { ...STAGING, request: { ...TEST_REQUEST } })).toEqual({
      valid: false, error: expect.stringMatching(/^The proof's scope/),
    });
    expect(Contract).not.toHaveBeenCalled();
    expect(await verifyProofOnChain('giwa_attestation', parsed(giwa()), {}, { chainId: 91342 }, undefined, { ...STAGING, request: { ...TEST_REQUEST } })).toMatchObject({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
  });

  it('verifyProofOffChain', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await verifyProofOffChain('giwa_attestation', PROOF, wrongKey(), STAGING)).toEqual({ valid: false, error: expect.stringMatching(/OPRF key hash/) });
      expect(await verifyProofOffChain('giwa_attestation', PROOF, wrongScope(), { ...STAGING, request: { ...TEST_REQUEST } })).toEqual({
        valid: false, error: expect.stringMatching(/^The proof's scope/),
      });
      expect(await verifyProofOffChain('giwa_attestation', PROOF, giwa(), {})).toEqual({ valid: false, error: expect.stringMatching(/^oprfEnvironment is required/) });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const response = (inputs: string[], requestId: string = TEST_REQUEST.requestId): ProofResponse => ({
    requestId, circuit: 'giwa_attestation', status: 'completed', proof: PROOF, publicInputs: inputs,
  });

  it('the SDK verifies for its own environment, with the request it was given', async () => {
    const sdk = ProofportSDK.create('staging');
    expect(await sdk.verifyResponseOnChain(response(giwa()), {}, { request: { ...TEST_REQUEST } })).toMatchObject({ valid: true });
    expect(await sdk.verifyResponseOnChain(response(wrongScope()), {}, { request: { ...TEST_REQUEST } })).toEqual({
      valid: false, error: expect.stringMatching(/^The proof's scope/),
    });
    expect(await sdk.verifyResponseOnChain(response(giwa()), {}, { request: { scope: TEST_REQUEST.scope, requestId: TEST_REQUEST.requestId } })).toEqual({
      valid: false, error: expect.stringMatching(/Pass request\.oprfDomain/),
    });
  });

  it('the production SDK refuses by name; a custom-config SDK without an environment names the option', async () => {
    expect(await ProofportSDK.create().verifyResponseOnChain(response(giwa()), {}, { request: { ...TEST_REQUEST } })).toEqual({
      valid: false, error: expect.stringMatching(/'production' environment/),
    });
    const custom = new ProofportSDK({ verifiers: { giwa_attestation: { address: '0x' + '42'.repeat(20), chainId: 91342, abi: [] } } } as never);
    expect(await custom.verifyResponseOnChain(response(giwa()), {}, { request: { ...TEST_REQUEST } })).toEqual({
      valid: false, error: expect.stringMatching(/^oprfEnvironment is required/),
    });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a deep-link request remembers its oprfDomain', async () => {
    const sdk = ProofportSDK.create('staging');
    const request = (sdk as any).createProofRequest('giwa_attestation', { scope: TEST_REQUEST.scope, oprfDomain: TEST_REQUEST.oprfDomain });
    const inputs = attestationInputs('giwa_attestation');
    // That request's signal_hash, so the binding is not what decides.
    const { computeSignalHash } = await import('../verifier');
    const signal = computeSignalHash({ scope: TEST_REQUEST.scope, circuitId: 'giwa_attestation', requestId: request.requestId });
    signal.slice(2).match(/../g)!.forEach((b: string, i: number) => (inputs[i] = hex(BigInt(parseInt(b, 16)))));
    expect(await sdk.verifyResponseOnChain(response(inputs, request.requestId), {})).toMatchObject({ valid: true });
    const other = (sdk as any).createProofRequest('giwa_attestation', { scope: TEST_REQUEST.scope, oprfDomain: 'other.example' });
    const otherInputs = [...inputs];
    computeSignalHash({ scope: TEST_REQUEST.scope, circuitId: 'giwa_attestation', requestId: other.requestId })
      .slice(2).match(/../g)!.forEach((b: string, i: number) => (otherInputs[i] = hex(BigInt(parseInt(b, 16)))));
    expect(await sdk.verifyResponseOnChain(response(otherInputs, other.requestId), {})).toEqual({
      valid: false, error: expect.stringMatching(/OPRF domain .* is not keccak256\("other.example"\)/),
    });
  });
});
