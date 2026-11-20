/**
 * createProofRequest used to send every circuit that was not the country
 * circuit to the Coinbase KYC builder, which wrote the literal
 * 'coinbase_attestation' into the request: a GIWA, Dojang or OIDC request
 * became a Coinbase KYC request without a word.
 */
import { describe, it, expect } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { ALL_CIRCUIT_IDS } from '../circuits';

const create = (circuit: string, inputs: Record<string, unknown>) =>
  (ProofportSDK.create('staging') as any).createProofRequest(circuit, inputs);

const INPUTS: Record<string, Record<string, unknown>> = {
  coinbase_attestation: { scope: 'myapp.com', oprfDomain: 'myapp.com' },
  coinbase_country_attestation: { scope: 'myapp.com', oprfDomain: 'myapp.com', countryList: ['US'], isIncluded: true },
  oidc_domain_attestation: { scope: 'myapp.com', domain: 'example.com' },
  giwa_attestation: { scope: 'myapp.com', oprfDomain: 'myapp.com' },
  dojang_playground: { scope: 'myapp.com', oprfDomain: 'myapp.com' },
  human_passport_score: { scope: 'myapp.com', oprfDomain: 'myapp.com', minScore: 20 },
};

describe('a request keeps the circuit it was asked for', () => {
  it.each(['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation', 'giwa_attestation', 'dojang_playground', 'human_passport_score'])(
    '%s',
    circuit => {
      expect(create(circuit, INPUTS[circuit]).circuit).toBe(circuit);
    },
  );

  it('the fixture covers every circuit id', () => {
    expect(Object.keys(INPUTS).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it.each([['arc_eligibility'], ['coinbase-kyc'], ['COINBASE_ATTESTATION'], [''], ['__proto__'], ['toString']])(
    'throws naming unknown circuit %j',
    circuit => {
      expect(() => create(circuit, { scope: 'myapp.com' })).toThrow(`Unknown circuit '${circuit}'. Known: `);
    },
  );

  it.each([
    ['missing', {}],
    ['empty', { scope: '' }],
    ['whitespace', { scope: '   \t\n' }],
    ['not a string', { scope: 42 }],
  ])('refuses a %s scope, naming the circuit asked for', (_label, inputs) => {
    expect(() => create('giwa_attestation', inputs)).toThrow('scope is required for giwa_attestation circuit');
  });

  it('refuses an OIDC request with no domain', () => {
    expect(() => create('oidc_domain_attestation', { scope: 'myapp.com', domain: '  ' })).toThrow(/domain is required/);
  });

  it('refuses an action on a circuit that cannot bind one', () => {
    expect(() => create('oidc_domain_attestation', { scope: 'a', domain: 'b.com', action: {} })).toThrow(/no action inputs/);
  });

  it('keeps a UTF-8 scope byte for byte', () => {
    const scope = '한국어 🚀 mixed scope';
    expect(create('dojang_playground', { scope, oprfDomain: 'myapp.com' }).inputs.scope).toBe(scope);
    // A tab is a control character the OPRF node refuses in a wallet scope.
    expect(() => create('dojang_playground', { scope: '한국어\tscope' })).toThrow(/control-character/);
  });

  it('createRelayRequest names an unknown circuit before asking anything of the relay', async () => {
    await expect(ProofportSDK.create('staging').createRelayRequest('nope' as never, { scope: 'a' } as never)).rejects.toThrow(
      "Unknown circuit 'nope'. Expected: ",
    );
  });
});
