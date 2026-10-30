/**
 * Whether a request may carry an EIP-712 action is the CIRCUIT's property,
 * looked up once, not a chain of `circuit === '...'` tests.
 *
 * It was that chain. The deep-link validator and `createRelayRequest` each
 * spelled out one circuit id. `giwa_attestation` binds an action OPTIONALLY,
 * because its circuit branches: with an action the wallet signs the typed
 * data, without one it personal_signs the signal hash. Three behaviours across
 * circuits is precisely the shape that ends on whichever branch happens to be
 * last.
 *
 * What is held here: every circuit is classified, an unclassified id is an
 * error rather than a quiet 'none', and each of the three behaviours actually
 * happens at both doors a dapp can knock on.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_ACTION_BINDING,
  circuitActionBinding,
} from '../circuits';
import { validateProofRequest } from '../deeplink';

/** A well-formed action; the shape a wallet can render and a verifier rehash. */
const ACTION = {
  domain: {
    name: 'GIWA Attestation Demo',
    version: '1',
    chainId: 91342,
    verifyingContract: '0x6646d970499BBeD728636823A5A7e551E811b414',
  },
  types: {
    CredentialDelegation: [
      { name: 'delegate', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  primaryType: 'CredentialDelegation',
  message: {
    delegate: '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c',
    amount: '1000000',
  },
};

function request(circuit: string, inputs: Record<string, unknown>) {
  return {
    requestId: 'req_test',
    circuit,
    inputs,
    // Required by the validator before it ever looks at the action. Leaving
    // it out made "refuses a malformed action" pass on "Missing callbackUrl"
    // -- green for a reason that had nothing to do with the action.
    callbackUrl: 'https://example.com/callback',
    dappName: 'Test',
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  } as Parameters<typeof validateProofRequest>[0];
}

describe('the table itself', () => {
  it('classifies every circuit the SDK knows', () => {
    const unclassified = ALL_CIRCUIT_IDS.filter(
      id => !(id in CIRCUIT_ACTION_BINDING),
    );
    expect(unclassified).toEqual([]);
  });

  it('names the circuits that can bind an action, so a change here is visible', () => {
    const canBind = ALL_CIRCUIT_IDS.filter(
      id => CIRCUIT_ACTION_BINDING[id] !== 'none',
    );
    expect(canBind.sort()).toEqual(['coinbase_attestation', 'coinbase_country_attestation', 'dojang_playground', 'giwa_attestation']);
    // Nothing is 'required' today; the value stays in the union because a
    // circuit with only an EIP-712 path is a legitimate thing to build, and
    // the callers already handle it.
    expect(CIRCUIT_ACTION_BINDING.giwa_attestation).toBe('optional');
    expect(CIRCUIT_ACTION_BINDING.dojang_playground).toBe('optional');
    // Coinbase KYC v2 branches in-circuit exactly like GIWA.
    expect(CIRCUIT_ACTION_BINDING.coinbase_attestation).toBe('optional');
    // Coinbase Country v2 takes the same branch.
    expect(CIRCUIT_ACTION_BINDING.coinbase_country_attestation).toBe('optional');
  });

  it('refuses a circuit it has never heard of instead of assuming none', () => {
    expect(() => circuitActionBinding('solana_thing')).toThrow(/Unknown circuit/);
    // A quiet 'none' here would drop an action a dapp meant to bind, and the
    // proof would come back looking valid.
    expect(() => circuitActionBinding('coinbase-kyc')).toThrow(/Unknown circuit/);
  });
});

describe('a deep link, per circuit', () => {
  // Arc was removed from the SDK on 2026-10-13. A link naming it is an
  // unknown circuit, refused with the id and the known list -- with or without
  // an action, and never routed to another circuit's rules.
  it('refuses arc_eligibility as an unknown circuit type', () => {
    for (const inputs of [{ scope: 'x' }, { scope: 'x', action: ACTION }]) {
      const r = validateProofRequest(request('arc_eligibility', inputs));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Invalid circuit type: arc_eligibility\. Expected one of: .*giwa_attestation/);
    }
    expect(() => circuitActionBinding('arc_eligibility')).toThrow(/Unknown circuit 'arc_eligibility'/);
  });

  it('still refuses a malformed primaryType on giwa_attestation', () => {
    const broken = { ...ACTION, primaryType: 'NotInTypes' };
    const r = validateProofRequest(request('giwa_attestation', { scope: 'x', action: broken }));
    expect(r.valid).toBe(false);
  });

  it('accepts giwa_attestation with no action -- the circuit signs its signal hash', () => {
    expect(validateProofRequest(request('giwa_attestation', { scope: 'x' })).valid).toBe(true);
  });

  it('accepts giwa_attestation with an action', () => {
    expect(
      validateProofRequest(request('giwa_attestation', { scope: 'x', action: ACTION })).valid,
    ).toBe(true);
  });

  it('refuses a malformed action on giwa_attestation rather than ignoring it', () => {
    const broken = { ...ACTION, message: { delegate: '0x00' } };
    const r = validateProofRequest(request('giwa_attestation', { scope: 'x', action: broken }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/missing/i);
  });

  it('treats dojang_playground the way it treats giwa_attestation', () => {
    expect(validateProofRequest(request('dojang_playground', { scope: 'x' })).valid).toBe(true);
    expect(validateProofRequest(request('dojang_playground', { scope: 'x', action: ACTION })).valid).toBe(true);
    const broken = { ...ACTION, message: { delegate: '0x00' } };
    const r = validateProofRequest(request('dojang_playground', { scope: 'x', action: broken }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/missing/i);
  });

  it('refuses an action on a circuit that cannot prove one', () => {
    // Dropping it silently is the failure that matters: the dapp would believe
    // the proof authorized something the circuit never saw.
    const r = validateProofRequest(request('oidc_domain_attestation', { scope: 'x', domain: 'example.com', action: ACTION }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/no action inputs/i);
  });

  it('Coinbase Country takes an action or none, and checks a present one', () => {
    const base = { scope: 'x', countryList: ['US'], isIncluded: true };
    expect(validateProofRequest(request('coinbase_country_attestation', base)).valid).toBe(true);
    expect(validateProofRequest(request('coinbase_country_attestation', { ...base, action: ACTION })).valid).toBe(true);
    const broken = { ...ACTION, message: { delegate: '0x00' } };
    const r = validateProofRequest(request('coinbase_country_attestation', { ...base, action: broken }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/missing/i);
  });

  it('Coinbase KYC takes an action or none, and checks a present one', () => {
    expect(validateProofRequest(request('coinbase_attestation', { scope: 'x' })).valid).toBe(true);
    expect(validateProofRequest(request('coinbase_attestation', { scope: 'x', action: ACTION })).valid).toBe(true);
    const broken = { ...ACTION, message: { delegate: '0x00' } };
    const r = validateProofRequest(request('coinbase_attestation', { scope: 'x', action: broken }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/missing/i);
  });
});
