/**
 * Coinbase Country is judged by the v2 layout on every verify path: 215 public
 * inputs, the signer root at 96-127, the country list at 128-149, scope and
 * nullifier at 150-213, and `attested_at` (214) held to the verifier's clock.
 * The circuit has no clock of its own, so without the last check a proof whose
 * attestation was unrevoked once would verify forever.
 *
 * Matrix (drawn up before the code):
 *   count        150 (v1) refused by name, also on a REAL v1 proof; 193 (a KYC
 *                v2 proof sent as Country) refused; 0, 214, 216 refused; not an
 *                array
 *   layout       every offset; scope and nullifier read at 150/182; the
 *                nullifier is keccak(keccak(wallet ++ keccak(id)) ++ scope)
 *   root         published root accepted; another refused; the right root at
 *                v1's offset (32) refused
 *   attested_at  15 min behind accepted, +1 s refused; 5 min ahead accepted,
 *                +1 s refused; zero; not a number; negative; above u64
 *   wiring       the issuer table runs this check; on-chain verify refuses a
 *                stale proof before any contract; off-chain before any key
 *                fetch; with a fresh proof on-chain reaches the PINNED contract
 *   variant      a 10,688-byte proof with no claimed variant is refused (two
 *                2^21 packages); 'android' / 'android_factory' resolve; an
 *                unknown variant is refused by name
 *   request      list of 1 and 10 accepted, 0 and 11 refused; lower case,
 *                three letters, one letter, empty, whitespace, emoji, HTML,
 *                ilike wildcards, non-string refused; a duplicate accepted (the
 *                circuit allows it); action optional, a present one checked,
 *                at both doors (createProofRequest, deep-link validation)
 *   authz/race   N/A: pure functions over public inputs, no caller identity
 *                and no async path beyond the ones under "wiring"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';
import {
  CIRCUIT_ISSUER_CHECKS,
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  COINBASE_ATTESTED_AT_MAX_AGE_SECONDS,
  COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS,
  COINBASE_COUNTRY_LIST_MAX,
  checkCoinbaseCountryAttestationProof,
  checkCoinbaseCountryProof,
  checkProofIssuer,
  countryListError,
  extractNullifierFromPublicInputs,
  extractScopeFromPublicInputs,
  resolveSignerVariant,
  verifyProofOnChain,
  VERIFIER_ABI,
  getPinnedVerifier,
  getPinnedVariantVerifier,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { ProofportSDK } from '../ProofportSDK';
import { validateProofRequest } from '../deeplink';
import { attestationInputs } from './helpers/signerFixtures';

vi.mock('@aztec/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: any) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const NOW = 1_800_000_000;
const L = COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT;
const AT = L.ATTESTED_AT;
const field = (v: bigint | number) => '0x' + BigInt(v).toString(16).padStart(64, '0');

function withAttestedAt(value: string): string[] {
  const inputs = attestationInputs('coinbase_country_attestation');
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
  it('the layout is 215 fields, in the circuit\'s order', () => {
    expect(COINBASE_COUNTRY_PUBLIC_INPUT_COUNT).toBe(215);
    expect(L).toEqual({
      SIGNAL_HASH_START: 0, SIGNAL_HASH_END: 31,
      DOMAIN_SEPARATOR_START: 32, DOMAIN_SEPARATOR_END: 63,
      ACTION_HASH_START: 64, ACTION_HASH_END: 95,
      MERKLE_ROOT_START: 96, MERKLE_ROOT_END: 127,
      COUNTRY_LIST_START: 128, COUNTRY_LIST_END: 147,
      COUNTRY_LIST_LENGTH: 148, IS_INCLUDED: 149,
      SCOPE_START: 150, SCOPE_END: 181,
      NULLIFIER_START: 182, NULLIFIER_END: 213,
      ATTESTED_AT: 214,
    });
    expect(L.COUNTRY_LIST_END - L.COUNTRY_LIST_START + 1).toBe(2 * COINBASE_COUNTRY_LIST_MAX);
  });

  it('refuses a v1 proof (150 inputs) naming what it is', async () => {
    const r = await checkCoinbaseCountryAttestationProof(Array.from({ length: 150 }, () => field(0)));
    expect(r).toEqual({
      ok: false,
      error:
        'This is a Coinbase Country v1 proof (150 public inputs). Only Coinbase Country v2 proofs (215 public inputs) ' +
        'are accepted; generate the proof again with a current ZKProofport app or prover.',
    });
  });

  const v1Proof = join(process.cwd(), '..', 'circuits', 'coinbase-country-attestation', 'target', 'proof', 'public_inputs');
  it.skipIf(!existsSync(v1Proof))('refuses a REAL v1 proof the v1 build wrote, by name', async () => {
    const bytes = readFileSync(v1Proof);
    const inputs: string[] = [];
    for (let i = 0; i < bytes.length; i += 32) inputs.push('0x' + bytes.subarray(i, i + 32).toString('hex'));
    expect(inputs.length).toBe(150);
    const r = await checkProofIssuer('coinbase_country_attestation', inputs);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^This is a Coinbase Country v1 proof/) });
  });

  it('refuses a Coinbase KYC v2 proof (193 inputs) sent as Country', async () => {
    const r = await checkCoinbaseCountryAttestationProof(attestationInputs('coinbase_attestation'));
    expect(r).toEqual({ ok: false, error: 'Expected 215 public inputs; got 193.' });
  });

  it.each([[0], [214], [216]])('refuses %i inputs by count', async n => {
    const r = await checkCoinbaseCountryAttestationProof(Array.from({ length: n }, () => field(0)));
    expect(r).toEqual({ ok: false, error: `Expected 215 public inputs; got ${n}.` });
  });

  it('refuses something that is not an array', async () => {
    const r = await checkCoinbaseCountryAttestationProof('0x01' as unknown as string[]);
    expect(r).toEqual({ ok: false, error: 'Expected 215 public inputs; got string.' });
  });
});

describe('scope and nullifier are read where the circuit writes them', () => {
  it('reads scope at 150-181 and the wallet + circuit-tag nullifier at 182-213', async () => {
    // The setup file mocks ethers' Contract; the hashing here needs the real module.
    const { ethers } = await vi.importActual<typeof import('ethers')>('ethers');
    const wallet = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';
    const scope = ethers.keccak256(ethers.toUtf8Bytes('myapp.com'));
    const tag = ethers.keccak256(ethers.toUtf8Bytes('coinbase_country_attestation'));
    const nullifier = ethers.keccak256(ethers.concat([ethers.keccak256(ethers.concat([wallet, tag])), scope]));
    const inputs = attestationInputs('coinbase_country_attestation');
    ethers.getBytes(scope).forEach((b, i) => (inputs[L.SCOPE_START + i] = field(b)));
    ethers.getBytes(nullifier).forEach((b, i) => (inputs[L.NULLIFIER_START + i] = field(b)));
    expect(extractScopeFromPublicInputs(inputs, 'coinbase_country_attestation')).toBe(scope);
    expect(extractNullifierFromPublicInputs(inputs, 'coinbase_country_attestation')).toBe(nullifier);
    // A v1-length array has no v2 nullifier to read.
    expect(extractNullifierFromPublicInputs(inputs.slice(0, 150), 'coinbase_country_attestation')).toBeNull();
  });
});

describe('root', () => {
  it('accepts the published root with a fresh attested_at', async () => {
    expect(await checkCoinbaseCountryAttestationProof(withAttestedAt(field(NOW)))).toEqual({ ok: true });
  });

  it('refuses another root before reading attested_at', async () => {
    const inputs = attestationInputs('coinbase_country_attestation', '0x' + '11'.repeat(32));
    const r = await checkCoinbaseCountryAttestationProof(inputs);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/is not the root of Coinbase's published signers/) });
  });

  it("refuses the right root at v1's offset (32-63), zeros at 96", async () => {
    const good = attestationInputs('coinbase_country_attestation');
    const moved = attestationInputs('coinbase_country_attestation', '0x' + '00'.repeat(32));
    for (let i = 0; i < 32; i++) moved[32 + i] = good[96 + i];
    expect((await checkCoinbaseCountryAttestationProof(moved)).ok).toBe(false);
  });
});

describe('attested_at', () => {
  it('accepts exactly 15 minutes behind, refuses one second more', async () => {
    expect(await checkCoinbaseCountryAttestationProof(withAttestedAt(field(NOW - COINBASE_ATTESTED_AT_MAX_AGE_SECONDS)))).toEqual({ ok: true });
    const r = await checkCoinbaseCountryAttestationProof(withAttestedAt(field(NOW - COINBASE_ATTESTED_AT_MAX_AGE_SECONDS - 1)));
    expect(r).toEqual({ ok: false, error: `The proof's attested_at (${NOW - 901}) is 901s behind this verifier's clock (${NOW}); at most 900s is accepted.` });
  });

  it('accepts exactly 5 minutes ahead, refuses one second more', async () => {
    expect(await checkCoinbaseCountryAttestationProof(withAttestedAt(field(NOW + COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS)))).toEqual({ ok: true });
    const r = await checkCoinbaseCountryAttestationProof(withAttestedAt(field(NOW + COINBASE_ATTESTED_AT_MAX_FUTURE_SECONDS + 1)));
    expect(r).toEqual({ ok: false, error: `The proof's attested_at (${NOW + 301}) is 301s ahead of this verifier's clock (${NOW}); at most 300s is accepted.` });
  });

  it('refuses zero (a statement never signed)', async () => {
    expect((await checkCoinbaseCountryAttestationProof(withAttestedAt(field(0)))).ok).toBe(false);
  });

  it.each([
    ['not a number', '0xzz', /Public input 214 \(attested_at\) is not a number\./],
    ['negative', '-1', /Public input 214 \(attested_at\) is out of range: -1\./],
    ['above u64', field(1n << 64n), /Public input 214 \(attested_at\) is out of range/],
  ])('refuses a value that is %s', async (_label, value, message) => {
    const r = await checkCoinbaseCountryAttestationProof(withAttestedAt(value));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(message) });
  });

  it("reads attested_at at 214, not at KYC's 192", async () => {
    const inputs = withAttestedAt(field(0));
    inputs[192] = field(NOW);
    expect((await checkCoinbaseCountryAttestationProof(inputs)).ok).toBe(false);
  });
});

describe('wiring', () => {
  it('the issuer table runs this check for coinbase_country_attestation', async () => {
    expect(CIRCUIT_ISSUER_CHECKS.coinbase_country_attestation).toBe(checkCoinbaseCountryProof);
    expect((await checkProofIssuer('coinbase_country_attestation', withAttestedAt(field(NOW - 3600)))).ok).toBe(false);
  });

  it('on-chain verify refuses a stale proof before calling any contract', async () => {
    const stale = withAttestedAt(field(NOW - 3600));
    const target = { address: '0x' + '42'.repeat(20), chainId: 84532, abi: VERIFIER_ABI };
    const r = await verifyProofOnChain('coinbase_country_attestation', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: stale, numPublicInputs: 215 }, {}, target);
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(Contract).not.toHaveBeenCalled();
  });

  it('on-chain verify reaches the pinned contract with a fresh proof', async () => {
    const fresh = withAttestedAt(field(NOW));
    const r = await verifyProofOnChain('coinbase_country_attestation', { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: fresh, numPublicInputs: 215 }, {}, { chainId: 84532 });
    expect(r).toEqual({ valid: true });
    expect(Contract).toHaveBeenCalledTimes(1);
  });

  it('off-chain verify refuses a stale proof before fetching a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await verifyProofOffChain('coinbase_country_attestation', '0x' + 'ab'.repeat(64), withAttestedAt(field(NOW - 3600)));
    expect(r).toEqual({ valid: false, error: expect.stringMatching(/behind this verifier's clock/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pinned verifiers', () => {
  // From circuits fc629d0 (deploy records of 2026-10-30). Ethereum mainnet
  // (chain 1) has the standard and android contracts; android_factory is not
  // deployed there yet and must throw by name, never fall back to another
  // chain, another variant or v1's contract. Update this table when its
  // record lands and the pinned table is regenerated.
  const DEPLOYED = {
    standard: { 84532: '0xc5363d7587bd580148373d0d8b7909be423242cb', 11155111: '0x99489796751b4939879dcaf5db35eb4964c58f6c', 8453: '0x509dee10cc1578361b450fed7475ea3bd69c6e8d', 1: '0xcd23a61d194d3b00906c49457774cb7e207ccc7b' },
    android: { 84532: '0x98013abb7ac83b6c985dcfbd5748ad2ae04c8c12', 11155111: '0x00f5ab7c6450a6ea91d2db8a91409c1b7504f3cc', 8453: '0xb57182062141f59ddbb98da73764ec1676689832', 1: '0xc0255ef1eb2a77e441a4745df9b61859e586ae83' },
    android_factory: { 84532: '0xd7bfd6d7bcc6c627da12cfcdf39fca6f64fdc0b9', 11155111: '0x81a7bb9c81d244d80f98ebeec455f252ee585911', 8453: '0x1f2975abd0711cf6b98084829e04712ee105d8f7' },
  } as const;
  it.each(Object.entries(DEPLOYED.standard))('standard on chain %s', (chain, address) => {
    expect(getPinnedVerifier('coinbase_country_attestation', Number(chain)).address).toBe(address);
  });
  it.each([
    ...Object.entries(DEPLOYED.android).map(([c, a]) => ['android', c, a] as const),
    ...Object.entries(DEPLOYED.android_factory).map(([c, a]) => ['android_factory', c, a] as const),
  ])('%s on chain %s', (variant, chain, address) => {
    expect(getPinnedVariantVerifier('coinbase_country_attestation', variant, Number(chain)).address).toBe(address);
  });
  it("v1's Country contracts are not pinned anywhere", () => {
    for (const v1 of ['0x2eb64d21fb29f26cd58901767ad232841a945d46', '0x8e89f11e65f219203f5be9d6a69a4da084630c56', '0x9deea2189ae694d7a36f65fb7d7dbe9f75abddce', '0x0b3af3dfc67dc65e0145c37ee00230139d579f64']) {
      for (const chain of [1, 8453, 84532, 11155111]) {
        let address: string | undefined;
        try { address = getPinnedVerifier('coinbase_country_attestation', chain).address; } catch { /* not pinned */ }
        expect(address).not.toBe(v1);
      }
    }
  });
  it('android_factory on chain 1 throws by name until its verifier is deployed', () => {
    expect(() => getPinnedVariantVerifier('coinbase_country_attestation', 'android_factory', 1)).toThrow(/coinbase_country_attestation/);
  });
});

describe('signer variant', () => {
  const proofOf = (bytes: number) => '0x' + 'ab'.repeat(bytes);
  it('a 2^21 proof with no claimed variant is refused: two packages share that length', () => {
    const r = resolveSignerVariant('coinbase_country_attestation', undefined, proofOf(10688));
    expect('error' in r && r.error).toMatch(/'android' or 'android_factory' proof/);
  });
  it('a 2^20 proof with no claimed variant is the standard package', () => {
    expect(resolveSignerVariant('coinbase_country_attestation', undefined, proofOf(10304))).toEqual({ variant: 'standard' });
  });
  it.each(['android', 'android_factory'] as const)('a claimed %s resolves to it', v => {
    expect(resolveSignerVariant('coinbase_country_attestation', v, proofOf(10688))).toEqual({ variant: v });
  });
  it.each([['ios'], ['ANDROID'], [''], ['__proto__']])('an unknown variant %j is refused by name', v => {
    const r = resolveSignerVariant('coinbase_country_attestation', v, proofOf(10688));
    expect('error' in r && r.error).toBe(
      `Circuit 'coinbase_country_attestation' has no ${JSON.stringify(v)} signer variant. Known for coinbase_country_attestation: standard, android, android_factory.`,
    );
  });
});

describe('the requested country list', () => {
  const ten = ['US', 'KR', 'JP', 'DE', 'FR', 'GB', 'CA', 'AU', 'SG', 'BR'];
  it.each([[['KR']], [ten], [['KR', 'KR']]])('accepts %j', list => {
    expect(countryListError(list)).toBeUndefined();
  });
  it.each([
    ['empty', [], /non-empty array/],
    ['eleven', [...ten, 'NL'], /has 11 entries; a Coinbase Country proof holds at most 10/],
    ['not an array', 'US', /non-empty array/],
    ['null', null, /non-empty array/],
    ['lower case', ['us'], /countryList\[0\] is "us"/],
    ['three letters', ['USA'], /upper-case ISO 3166-1 alpha-2/],
    ['one letter', ['U'], /upper-case/],
    ['empty string', [''], /upper-case/],
    ['whitespace', [' U'], /upper-case/],
    ['trailing newline', ['US\n'], /upper-case/],
    ['emoji', ['🇺🇸'], /upper-case/],
    ['Korean', ['한국'], /upper-case/],
    ['HTML', ['<s'], /upper-case/],
    ['wildcards', ['%_'], /upper-case/],
    ['non-string', [42], /only strings/],
  ])('refuses a list that is %s', (_label, list, message) => {
    expect(countryListError(list)).toMatch(message);
  });

  const create = (inputs: Record<string, unknown>) =>
    (ProofportSDK.create('staging') as any).createProofRequest('coinbase_country_attestation', inputs);
  const ACTION = {
    domain: { name: 'Country Demo', version: '1', chainId: 8453, verifyingContract: '0x6646d970499BBeD728636823A5A7e551E811b414' },
    types: { Join: [{ name: 'member', type: 'address' }] },
    primaryType: 'Join',
    message: { member: '0x6646d970499BBeD728636823A5A7e551E811b414' },
  };

  it('createProofRequest takes an action or none, and refuses a broken one', () => {
    const base = { scope: 'myapp.com', countryList: ['KR'], isIncluded: false };
    expect(create(base).inputs.countryList).toEqual(['KR']);
    expect(create({ ...base, action: ACTION }).inputs.action).toEqual(ACTION);
    expect(() => create({ ...base, action: { ...ACTION, message: {} } })).toThrow(/coinbase_country_attestation/);
  });

  it('createProofRequest refuses an eleven-entry or lower-case list before any request exists', () => {
    expect(() => create({ scope: 'myapp.com', countryList: [...ten, 'NL'], isIncluded: true })).toThrow(/at most 10/);
    expect(() => create({ scope: 'myapp.com', countryList: ['kr'], isIncluded: true })).toThrow(/upper-case/);
  });

  it('the deep-link validator refuses the same lists', () => {
    const req = (countryList: unknown) => ({
      requestId: 'r', circuit: 'coinbase_country_attestation', callbackUrl: 'https://example.com/cb',
      inputs: { scope: 'x', countryList, isIncluded: true }, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    expect(validateProofRequest(req(['KR']) as any).valid).toBe(true);
    expect(validateProofRequest(req([...ten, 'NL']) as any)).toEqual({ valid: false, error: expect.stringMatching(/at most 10/) });
    expect(validateProofRequest(req(['kr']) as any)).toEqual({ valid: false, error: expect.stringMatching(/upper-case/) });
  });
});
