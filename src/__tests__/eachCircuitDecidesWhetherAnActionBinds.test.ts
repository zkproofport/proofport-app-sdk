/**
 * Whether a request may carry an EIP-712 action is the CIRCUIT's property,
 * looked up once, not a chain of `circuit === '...'` tests.
 *
 * It was that chain. The deep-link validator and `createRelayRequest` each
 * spelled out `arc_eligibility`, which was fine while exactly one circuit
 * bound an action. `giwa_attestation` became the second on 2026-09-22 — and
 * unlike Arc it binds one OPTIONALLY, because its circuit branches: with an
 * action the wallet signs the typed data, without one it personal_signs the
 * signal hash. Two circuits with three behaviours between them is precisely
 * the shape that ends on whichever branch happens to be last.
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
    expect(canBind.sort()).toEqual(['arc_eligibility', 'giwa_attestation']);
    // Both optional since 2026-09-22, when Arc's circuit gained the branch it
    // had been missing. Nothing is 'required' today; the value stays in the
    // union because a circuit with only an EIP-712 path is a legitimate thing
    // to build, and the callers already handle it.
    expect(CIRCUIT_ACTION_BINDING.arc_eligibility).toBe('optional');
    expect(CIRCUIT_ACTION_BINDING.giwa_attestation).toBe('optional');
  });

  it('refuses a circuit it has never heard of instead of assuming none', () => {
    expect(() => circuitActionBinding('solana_thing')).toThrow(/Unknown circuit/);
    // A quiet 'none' here would drop an action a dapp meant to bind, and the
    // proof would come back looking valid.
    expect(() => circuitActionBinding('coinbase-kyc')).toThrow(/Unknown circuit/);
  });
});

describe('a deep link, per circuit', () => {
  it('accepts arc_eligibility with no action, now that its circuit branches', () => {
    expect(validateProofRequest(request('arc_eligibility', { scope: 'x' })).valid).toBe(true);
  });

  it('accepts arc_eligibility with an action', () => {
    expect(
      validateProofRequest(request('arc_eligibility', { scope: 'x', action: ACTION })).valid,
    ).toBe(true);
  });

  it('still refuses a malformed action on arc_eligibility', () => {
    const broken = { ...ACTION, primaryType: 'NotInTypes' };
    const r = validateProofRequest(request('arc_eligibility', { scope: 'x', action: broken }));
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

  it('refuses an action on a circuit that cannot prove one', () => {
    // Dropping it silently is the failure that matters: the dapp would believe
    // the proof authorized something the circuit never saw.
    const r = validateProofRequest(request('coinbase_attestation', { scope: 'x', action: ACTION }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/no action inputs/i);
  });
});
