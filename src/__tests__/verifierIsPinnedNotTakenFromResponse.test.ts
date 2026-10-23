/**
 * A proof is judged by a contract this SDK pinned or the dApp configured --
 * never by the address a proof response carries. Before this, a response with
 * a verifierAddress and no dApp configuration was verified against that
 * address, so the sender chose its own judge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import { VERIFICATION_CHAINS } from '../constants';
import {
  verifyProofOnChain,
  getPinnedVerifier,
  PINNED_VERIFIERS,
  ALL_CIRCUIT_IDS,
  VERIFIER_ABI,
} from '../verifier';
import type { ProofResponse } from '../types';
import { attestationInputs } from './helpers/signerFixtures';

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const ATTACKER = '0x000000000000000000000000000000000000dEaD';
const PINNED_BASE_SEPOLIA_KYC = PINNED_VERIFIERS.coinbase_attestation[84532].address;
const provider = {};
const parsed = { proofHex: '0x' + 'ab'.repeat(64), publicInputsHex: attestationInputs('coinbase_attestation'), numPublicInputs: 128 };

const response = (over: Partial<ProofResponse> = {}): ProofResponse => ({
  requestId: 'r1',
  circuit: 'coinbase_attestation',
  status: 'completed',
  proof: parsed.proofHex,
  publicInputs: parsed.publicInputsHex,
  ...over,
});

const calledAddresses = () => Contract.mock.calls.map(c => String(c[0]).toLowerCase());

beforeEach(() => {
  Contract.mockClear();
});

describe('core verifyProofOnChain', () => {
  it('refuses a response-only verifier: the old fallback is gone', async () => {
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, undefined, {
      verifierAddress: ATTACKER,
      chainId: 84532,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No verifier chosen/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('uses the pinned deployment when given a chain', async () => {
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 84532 });
    expect(result.valid).toBe(true);
    expect(calledAddresses()).toEqual([PINNED_BASE_SEPOLIA_KYC]);
  });

  it('refuses when the response names a different address than the pinned one', async () => {
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 84532 }, {
      verifierAddress: ATTACKER,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Refusing rather than trusting the response/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('accepts the pinned address in checksum case', async () => {
    const checksummed = '0x42D165A48256ae184E1de4E7e6372e870E2Bc883';
    expect(checksummed.toLowerCase()).toBe(PINNED_BASE_SEPOLIA_KYC);
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 84532 }, {
      verifierAddress: checksummed,
      chainId: 84532,
    });
    expect(result.valid).toBe(true);
  });

  it.each([[''], ['not-an-address'], ['0x1234'], ['<script>']])('refuses a claimed address %j', async claimed => {
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 84532 }, {
      verifierAddress: claimed,
    });
    expect(result.valid).toBe(false);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('refuses when the response names a different chain', async () => {
    const result = await verifyProofOnChain('coinbase_attestation', parsed, provider, { chainId: 84532 }, {
      chainId: 8453,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/names chain 8453/);
  });

  it('a dApp-configured verifier is used, and a differing response address is still refused', async () => {
    const configured = { address: '0x1111111111111111111111111111111111111111', chainId: 84532, abi: VERIFIER_ABI };
    expect((await verifyProofOnChain('coinbase_attestation', parsed, provider, configured)).valid).toBe(true);
    expect(calledAddresses()).toEqual([configured.address]);
    const refused = await verifyProofOnChain('coinbase_attestation', parsed, provider, configured, {
      verifierAddress: ATTACKER,
    });
    expect(refused.valid).toBe(false);
  });

  it('names the chain and the chains that have one when a circuit has no deployment there', async () => {
    const result = await verifyProofOnChain('giwa_attestation', parsed, provider, { chainId: 8453 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('No giwa_attestation verifier is deployed on chain 8453. Chains with one: 91342.');
  });

  it.each([['arc_eligibility'], ['coinbase-kyc'], [''], ['__proto__']])('names unknown circuit %j', async circuit => {
    const result = await verifyProofOnChain(circuit as never, parsed, provider, { chainId: 84532 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`Unknown circuit '${circuit}'`);
    expect(Contract).not.toHaveBeenCalled();
  });
});

describe('getPinnedVerifier', () => {
  it.each([[0], [-1], [Number.NaN], [2 ** 53], [11155112]])('throws for chain %s', chain => {
    expect(() => getPinnedVerifier('coinbase_attestation', chain)).toThrow(/No coinbase_attestation verifier is deployed on chain/);
  });

  it('throws naming an unknown circuit', () => {
    expect(() => getPinnedVerifier('nope', 84532)).toThrow("Unknown circuit 'nope'. Known: ");
  });

  it('every address in the table is a lowercase 20-byte address', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      for (const v of Object.values(PINNED_VERIFIERS[id])) {
        expect(v.address).toMatch(/^0x[0-9a-f]{40}$/);
        expect(v.record).toMatch(/^broadcast\/Deploy[A-Za-z]+\.s\.sol\/\d+\/run-latest\.json$/);
      }
    }
  });

  it('every environment has a pinned verifier for every circuit on the chain it verifies that circuit on', () => {
    for (const [env, chains] of Object.entries(VERIFICATION_CHAINS)) {
      for (const id of ALL_CIRCUIT_IDS) {
        const chain = (chains as Record<string, number>)[id];
        expect(() => getPinnedVerifier(id, chain), `${env} ${id} on ${chain}`).not.toThrow();
      }
    }
  });
});

describe('ProofportSDK.verifyResponseOnChain', () => {
  it('staging verifies on the pinned Base Sepolia contract, ignoring nothing but trusting nothing', async () => {
    const sdk = ProofportSDK.create('staging');
    const result = await sdk.verifyResponseOnChain(response({ verifierAddress: PINNED_BASE_SEPOLIA_KYC, chainId: 84532 }), provider);
    expect(result.valid).toBe(true);
    expect(calledAddresses()).toEqual([PINNED_BASE_SEPOLIA_KYC]);
  });

  it('refuses a response pointing at another contract', async () => {
    const sdk = ProofportSDK.create('staging');
    const result = await sdk.verifyResponseOnChain(response({ verifierAddress: ATTACKER, chainId: 84532 }), provider);
    expect(result.valid).toBe(false);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('a response with no verifier fields is verified on the pinned contract', async () => {
    const sdk = ProofportSDK.create('staging');
    expect((await sdk.verifyResponseOnChain(response(), provider)).valid).toBe(true);
    expect(calledAddresses()).toEqual([PINNED_BASE_SEPOLIA_KYC]);
  });

  it('production verifies Coinbase KYC on Base and GIWA on GIWA Sepolia', async () => {
    const sdk = ProofportSDK.create();
    await sdk.verifyResponseOnChain(response(), provider);
    await sdk.verifyResponseOnChain(response({ circuit: 'giwa_attestation', publicInputs: attestationInputs('giwa_attestation') }), provider);
    expect(calledAddresses()).toEqual([
      PINNED_VERIFIERS.coinbase_attestation[8453].address,
      PINNED_VERIFIERS.giwa_attestation[91342].address,
    ]);
  });

  it('a custom-config SDK with no verifiers refuses rather than reading the response', async () => {
    const sdk = new ProofportSDK({ relayUrl: 'https://relay.example' });
    const result = await sdk.verifyResponseOnChain(response({ verifierAddress: ATTACKER, chainId: 84532 }), provider);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No verifier chosen/);
    expect(Contract).not.toHaveBeenCalled();
  });

  it('an unknown circuit in the response is a named error, not a throw', async () => {
    const sdk = ProofportSDK.create('staging');
    const result = await sdk.verifyResponseOnChain(response({ circuit: 'arc_eligibility' as never }), provider);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unknown circuit 'arc_eligibility'");
  });

  it('getVerifierAddress reports the pinned address for a preset SDK', () => {
    expect(ProofportSDK.create('staging').getVerifierAddress('oidc_domain_attestation')).toBe(
      PINNED_VERIFIERS.oidc_domain_attestation[84532].address,
    );
    expect(ProofportSDK.create('staging').getVerifierChainId('dojang_playground')).toBe(91342);
  });
});

describe('an explicit environment with a custom relay', () => {
  it('verifies on that environment\'s pinned chain', async () => {
    const sdk = new ProofportSDK({ relayUrl: 'http://192.168.0.10:4001', environment: 'local' });
    expect((await sdk.verifyResponseOnChain(response(), provider)).valid).toBe(true);
    expect(calledAddresses()).toEqual([PINNED_BASE_SEPOLIA_KYC]);
  });

  it.each([['prod'], ['PRODUCTION'], [''], ['__proto__'], ['toString']])('throws naming unknown environment %j', env => {
    expect(() => new ProofportSDK({ environment: env as never })).toThrow(`Unknown environment '${env}'. Known: production, staging, local.`);
  });

  it('every demo page that builds its own SDK names an environment or verifiers', async () => {
    const { readdirSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const dir = join(process.cwd(), 'demo');
    const constructions = readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .flatMap(f => (readFileSync(join(dir, f), 'utf8').match(/new ProofportSDK\(\{[^}]*\}\)/g) ?? []).map(c => [f, c]));
    expect(constructions.length).toBeGreaterThan(0);
    for (const [file, call] of constructions) {
      expect(call, file).toMatch(/environment:|verifiers:/);
    }
  });
});
