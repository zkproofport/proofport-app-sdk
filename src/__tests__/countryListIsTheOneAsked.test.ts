/**
 * A Coinbase Country proof answers the dApp's question only when it was made
 * against the list and direction the dApp asked for: the wallet's signature
 * does not cover the list, so a proof against ['KR'] verifies as well as one
 * against ['US']. Every verify path that knows the request compares them and
 * fails closed; the core check reads the list strictly.
 *
 * Also the REAL Coinbase Country v2 proofs (fixtures/coinbaseCountryV2SyntheticAnchors.json:
 * the circuit's own source with a synthetic Apple CA and server key, so they
 * verify against the vk in the file and no deployed verifier).
 *
 * Matrix:
 *   real proofs  app kind + EIP-712 action, inclusion [US, KR]; server kind,
 *                exclusion [US]; verified off-chain with their vk; root and
 *                attested_at accepted at their own time; a changed list byte
 *                fails the proof itself
 *   read         length 0 / 11 / not a number; flag 2; a lower-case, non-letter
 *                or non-number byte inside the length; a non-zero byte past it;
 *                wrong count
 *   compare      same set in another order and with a duplicate accepted; a
 *                subset, a superset, another list, the other direction refused;
 *                a requested list that is invalid or missing refused
 *   SDK          verifyResponseOnChain / OffChain: an unknown request refused
 *                before any contract or key; an explicit condition used; a relay
 *                request this SDK created remembered (list and direction); a
 *                pending deep-link request read; a mismatch refused before the
 *                contract; createRelayRequest refuses an invalid list before a
 *                challenge is spent
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';
import {
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as L,
  VERIFIER_ABI,
  checkCountryListMatches,
  checkProofIssuer,
  readCountryCondition,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { ProofportSDK } from '../ProofportSDK';
import type { ProofResponse } from '../types';

interface FixtureProof { proof: string; publicInputs: string[] }
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'coinbaseCountryV2SyntheticAnchors.json'), 'utf8')) as {
  vk: string;
  action: FixtureProof;
  serverExclusion: FixtureProof;
};
const VK = new Uint8Array(Buffer.from(FIXTURE.vk.slice(2), 'hex'));
const ATTESTED_AT_MS = Number(BigInt(FIXTURE.action.publicInputs[L.ATTESTED_AT])) * 1000;
const field = (v: number | bigint) => '0x' + BigInt(v).toString(16).padStart(64, '0');
const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const TARGET = { address: '0x' + '42'.repeat(20), chainId: 84532, abi: VERIFIER_ABI };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ATTESTED_AT_MS + 60_000);
  Contract.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('the real Coinbase Country v2 proofs', () => {
  it('are the shape the pinned bb produces for a 2^20 circuit with 215 public inputs', () => {
    expect(VK.length).toBe(1888);
    for (const p of [FIXTURE.action, FIXTURE.serverExclusion]) {
      expect(p.publicInputs.length).toBe(215);
      expect((p.proof.length - 2) / 2).toBe(10304);
    }
  });

  it('carry the lists they were made against', () => {
    expect(readCountryCondition(FIXTURE.action.publicInputs)).toEqual({ ok: true, condition: { countryList: ['US', 'KR'], isIncluded: true } });
    expect(readCountryCondition(FIXTURE.serverExclusion.publicInputs)).toEqual({ ok: true, condition: { countryList: ['US'], isIncluded: false } });
  });

  it.each([
    ['app kind, EIP-712 action, inclusion', 'action', { countryList: ['KR', 'US'], isIncluded: true }],
    ['server kind, exclusion', 'serverExclusion', { countryList: ['US'], isIncluded: false }],
  ] as const)('%s: verifies off-chain against the list it was asked for', async (_label, key, condition) => {
    const p = FIXTURE[key];
    const r = await verifyProofOffChain('coinbase_country_attestation', p.proof, p.publicInputs, { verificationKey: VK, countryCondition: condition });
    expect(r.error).toBeUndefined();
    expect(r.valid).toBe(true);
  }, 120_000);

  it('the signer root and attested_at inside a real proof are accepted at its own time', async () => {
    expect(await checkProofIssuer('coinbase_country_attestation', FIXTURE.action.publicInputs)).toEqual({ ok: true });
  });

  it('is refused off-chain when the request asked for another list, before Barretenberg', async () => {
    const r = await verifyProofOffChain('coinbase_country_attestation', FIXTURE.action.proof, FIXTURE.action.publicInputs, {
      verificationKey: VK,
      countryCondition: { countryList: ['US'], isIncluded: true },
    });
    expect(r).toEqual({ valid: false, error: "The proof's country list [US, KR] is not the requested [US]." });
  });

  it('a list byte changed to match the request breaks the proof itself', async () => {
    // Exclusion [US] rewritten as [UK]: the comparison passes, the proof does not.
    const inputs = [...FIXTURE.serverExclusion.publicInputs];
    inputs[L.COUNTRY_LIST_START + 1] = field(0x4b);
    const r = await verifyProofOffChain('coinbase_country_attestation', FIXTURE.serverExclusion.proof, inputs, {
      verificationKey: VK,
      countryCondition: { countryList: ['UK'], isIncluded: false },
    });
    expect(r.valid).toBe(false);
  }, 120_000);
});

/** Public inputs with a given list region; everything else from the real action proof. */
function withList(codes: string[], length: number = codes.length, included: number | string = 1): string[] {
  const inputs = [...FIXTURE.action.publicInputs];
  for (let i = L.COUNTRY_LIST_START; i <= L.COUNTRY_LIST_END; i++) inputs[i] = field(0);
  codes.forEach((c, slot) => {
    inputs[L.COUNTRY_LIST_START + 2 * slot] = field(c.charCodeAt(0));
    inputs[L.COUNTRY_LIST_START + 2 * slot + 1] = field(c.charCodeAt(1));
  });
  inputs[L.COUNTRY_LIST_LENGTH] = field(length);
  inputs[L.IS_INCLUDED] = typeof included === 'string' ? included : field(included);
  return inputs;
}

describe('reading the proof\'s list', () => {
  it('reads ten entries', () => {
    const ten = ['US', 'KR', 'JP', 'DE', 'FR', 'GB', 'CA', 'AU', 'SG', 'BR'];
    expect(readCountryCondition(withList(ten))).toEqual({ ok: true, condition: { countryList: ten, isIncluded: true } });
  });

  it.each([
    ['length 0', () => withList([], 0), /country_list_length\) is not 1 to 10/],
    ['length 11', () => withList(['US'], 11), /country_list_length\) is not 1 to 10/],
    ['length not a number', () => { const i = withList(['US']); i[L.COUNTRY_LIST_LENGTH] = 'zz'; return i; }, /country_list_length/],
    ['flag 2', () => withList(['US'], 1, 2), /is_included\) is not 0 or 1/],
    ['flag not a number', () => withList(['US'], 1, '<script>'), /is_included\) is not 0 or 1/],
    ['a lower-case code', () => withList(['us']), /country_list\[0\]\) are not an upper-case country code/],
    ['a digit', () => withList(['U1']), /are not an upper-case country code/],
    ['a byte above 255', () => { const i = withList(['US']); i[L.COUNTRY_LIST_START] = field(0x155); return i; }, /are not an upper-case/],
    ['a garbage byte', () => { const i = withList(['US']); i[L.COUNTRY_LIST_START] = '%_'; return i; }, /are not an upper-case/],
    ['a non-zero byte past the length', () => withList(['US', 'KR'], 1), /country_list\[1\]\) lie past country_list_length and are not zero/],
    ['wrong count', () => withList(['US']).slice(0, 214), /Expected 215 public inputs; got 214/],
  ])('refuses %s', (_label, make, message) => {
    const r = readCountryCondition(make());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(message);
  });
});

describe('comparing it with the request', () => {
  const proof = withList(['US', 'KR']);
  it.each([
    [{ countryList: ['US', 'KR'], isIncluded: true }],
    [{ countryList: ['KR', 'US'], isIncluded: true }],
    [{ countryList: ['KR', 'US', 'KR'], isIncluded: true }],
  ])('accepts %j', want => {
    expect(checkCountryListMatches(proof, want)).toEqual({ ok: true });
  });

  it.each([
    ['a subset', { countryList: ['US'], isIncluded: true }, /is not the requested \[US\]/],
    ['a superset', { countryList: ['US', 'KR', 'JP'], isIncluded: true }, /is not the requested/],
    ['another list', { countryList: ['JP', 'DE'], isIncluded: true }, /is not the requested/],
    ['the other direction', { countryList: ['US', 'KR'], isIncluded: false }, /^The proof is an inclusion check, but the request asked for exclusion\.$/],
    ['an invalid requested list', { countryList: ['us', 'kr'], isIncluded: true }, /requested country list cannot be compared/],
    ['an empty requested list', { countryList: [], isIncluded: true }, /requested country list cannot be compared/],
    ['no flag', { countryList: ['US', 'KR'] }, /missing or has no isIncluded flag/],
    ['nothing', null, /missing/],
  ])('refuses %s', (_label, want, message) => {
    const r = checkCountryListMatches(proof, want as never);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(message);
  });

  it('the issuer check runs it when a condition is passed, and not otherwise', async () => {
    const real = FIXTURE.action.publicInputs;
    expect(await checkProofIssuer('coinbase_country_attestation', real)).toEqual({ ok: true });
    expect((await checkProofIssuer('coinbase_country_attestation', real, { countryCondition: { countryList: ['JP'], isIncluded: true } })).ok).toBe(false);
  });
});

describe('the SDK holds a response to the request it answers', () => {
  const REQUEST_ID = 'req-country-1';
  const resp = (p: FixtureProof, requestId = REQUEST_ID): ProofResponse => ({
    requestId, circuit: 'coinbase_country_attestation', status: 'completed', proof: p.proof, publicInputs: p.publicInputs,
  });
  const sdkWithVerifier = () => new ProofportSDK({ verifiers: { coinbase_country_attestation: TARGET } } as never);

  it('refuses a response it cannot place, before any contract (on-chain)', async () => {
    const r = await sdkWithVerifier().verifyResponseOnChain(resp(FIXTURE.action), {});
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/^No Coinbase Country request "req-country-1" was created by this SDK instance/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('refuses a response it cannot place, before any key (off-chain)', async () => {
    const r = await sdkWithVerifier().verifyResponseOffChain(resp(FIXTURE.action), { verificationKey: VK });
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/Pass \{ countryCondition: \{ countryList, isIncluded \} \}/) });
  });

  it('uses an explicit condition: a match reaches the contract, a mismatch does not', async () => {
    const sdk = sdkWithVerifier();
    expect(await sdk.verifyResponseOnChain(resp(FIXTURE.action), {}, { countryCondition: { countryList: ['US', 'KR'], isIncluded: true } })).toEqual({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
    const r = await sdk.verifyResponseOnChain(resp(FIXTURE.action), {}, { countryCondition: { countryList: ['US', 'KR'], isIncluded: false } });
    expect(r).toEqual({ valid: false, error: 'The proof is an inclusion check, but the request asked for exclusion.' });
    expect(Contract).toHaveBeenCalledTimes(1);
  });

  async function sdkWithRelayRequest(inputs: Record<string, unknown>) {
    const sdk = new ProofportSDK({ relayUrl: 'https://relay.example', verifiers: { coinbase_country_attestation: TARGET } } as never);
    sdk.setSigner({ signMessage: async () => '0x' + '22'.repeat(65), getAddress: async () => '0x' + '33'.repeat(20) } as never);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/challenge')) {
        return { ok: true, json: async () => ({ requestId: REQUEST_ID, challenge: '0x' + '11'.repeat(32), expiresAt: Date.now() + 60000 }) };
      }
      if (String(url).includes('/proof/request')) {
        return { ok: true, json: async () => ({ requestId: REQUEST_ID, deepLink: 'zkproofport://x', status: 'pending', pollUrl: '/p' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    global.fetch = fetchMock as never;
    await sdk.createRelayRequest('coinbase_country_attestation', inputs as never);
    return { sdk, fetchMock };
  }

  it('remembers a relay request it created: list and direction', async () => {
    const { sdk } = await sdkWithRelayRequest({ scope: 'myapp.com', countryList: ['KR', 'US'], isIncluded: true });
    expect(await sdk.verifyResponseOnChain(resp(FIXTURE.action), {})).toEqual({ valid: true });
    const off = await sdk.verifyResponseOffChain(resp(FIXTURE.action), { verificationKey: VK });
    expect(off.error).toBeUndefined();
    expect(off.valid).toBe(true);
  }, 120_000);

  it('refuses a proof against another list than the relay request it created', async () => {
    const { sdk } = await sdkWithRelayRequest({ scope: 'myapp.com', countryList: ['US'], isIncluded: false });
    expect(await sdk.verifyResponseOnChain(resp(FIXTURE.action), {})).toEqual({
      valid: false,
      error: 'The proof is an inclusion check, but the request asked for exclusion.',
    });
    expect(Contract).not.toHaveBeenCalled();
    expect(await sdk.verifyResponseOnChain(resp(FIXTURE.serverExclusion), {})).toEqual({ valid: true });
  });

  it('reads a pending deep-link request', async () => {
    const sdk = sdkWithVerifier();
    const request = (sdk as any).createProofRequest('coinbase_country_attestation', { scope: 'myapp.com', countryList: ['JP'], isIncluded: true });
    const r = await sdk.verifyResponseOnChain(resp(FIXTURE.action, request.requestId), {});
    expect(r).toEqual({ valid: false, error: "The proof's country list [US, KR] is not the requested [JP]." });
    expect(Contract).not.toHaveBeenCalled();
  });

  it.each([
    ['eleven entries', ['US', 'KR', 'JP', 'DE', 'FR', 'GB', 'CA', 'AU', 'SG', 'BR', 'NL'], /at most 10/],
    ['lower case', ['kr'], /upper-case/],
  ])('createRelayRequest refuses %s before a challenge is spent', async (_label, countryList, message) => {
    const sdk = new ProofportSDK({ relayUrl: 'https://relay.example' } as never);
    sdk.setSigner({ signMessage: async () => '0x', getAddress: async () => '0x' + '33'.repeat(20) } as never);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    await expect(sdk.createRelayRequest('coinbase_country_attestation', { scope: 'x', countryList, isIncluded: true } as never)).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
