/**
 * The circuit hashes the action without reading it, so a malformed action does
 * not fail — it produces a valid proof of the wrong thing.
 *
 * `arc_eligibility` commits to the EIP-712 domain separator and struct hash and
 * nothing else. Whoever defined the action recomputes those two values and
 * compares; if the action was missing a field the wallet never showed, the
 * proof is still valid and says something nobody meant.
 *
 * The check lived only in the mobile app's demo screen until 2026-09-11, so an
 * action arriving from a dapp through the deep link reached the prover
 * unexamined — and that is the path that ships.
 */
import { describe, it, expect } from 'vitest';
import { validateTypedAction, parseTypedAction } from '../typedAction';

const GOOD = {
  domain: {
    name: 'MyVault',
    version: '1',
    chainId: 5042002,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: {
    Deposit: [
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'Deposit',
  message: { amount: '1000000', nonce: '1' },
};

/** The same action with one thing changed. */
const without = (path: string) => {
  const copy = JSON.parse(JSON.stringify(GOOD));
  const parts = path.split('.');
  let cur = copy;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  delete cur[parts[parts.length - 1]];
  return copy;
};

describe('an action is checked before it is signed', () => {
  it('accepts a complete action', () => {
    expect(validateTypedAction(GOOD)).toBeNull();
  });

  it('refuses a missing action, naming what the circuit proves', () => {
    expect(validateTypedAction(undefined)).toMatch(/required for arc_eligibility/);
    expect(validateTypedAction(null)).toMatch(/required for arc_eligibility/);
  });

  it('refuses anything that is not an object', () => {
    expect(validateTypedAction('deposit 1 USDC')).toMatch(/must be an object/);
    expect(validateTypedAction([GOOD])).toMatch(/must be an object/);
    expect(validateTypedAction(42)).toMatch(/must be an object/);
  });

  it.each([
    ['domain', 'domain'],
    ['domain.name', 'domain.name'],
    ['domain.version', 'domain.version'],
    ['domain.verifyingContract', 'domain.verifyingContract'],
    ['domain.chainId', 'domain.chainId'],
    ['types', 'types'],
    ['primaryType', 'primaryType'],
    ['message', 'message'],
  ])('refuses an action with no %s', (path, named) => {
    const reason = validateTypedAction(without(path));
    expect(reason).toBeTruthy();
    expect(reason).toContain(named);
  });

  it('refuses a verifyingContract that is not a 20-byte address', () => {
    for (const bad of ['0x123', 'not-an-address', '0x' + 'f'.repeat(41), '']) {
      const a = { ...GOOD, domain: { ...GOOD.domain, verifyingContract: bad } };
      expect(validateTypedAction(a)).toBeTruthy();
    }
  });

  it('refuses a chainId that is not a whole number', () => {
    for (const bad of ['5042002', 5042002.5, NaN]) {
      const a = { ...GOOD, domain: { ...GOOD.domain, chainId: bad } };
      expect(validateTypedAction(a)).toMatch(/chainId must be an integer/);
    }
  });

  it('refuses a primaryType that names no struct in types', () => {
    const a = { ...GOOD, primaryType: 'Withdraw' };
    expect(validateTypedAction(a)).toMatch(/'Withdraw' is not one of the structs/);
  });

  it('refuses a struct that declares no fields', () => {
    const a = { ...GOOD, types: { Deposit: [] } };
    expect(validateTypedAction(a)).toMatch(/declares no fields/);
  });

  /**
   * The one that matters most: the wallet renders only the fields present in
   * `message`, so a field declared and not supplied is a field the person never
   * saw and the signature still covers.
   */
  it('refuses a message missing a field the struct declares, and names it', () => {
    const a = { ...GOOD, message: { amount: '1000000' } };
    expect(validateTypedAction(a)).toMatch(/message is missing: nonce/);
  });

  it('reads an action a person typed, and says why when it is not JSON', () => {
    expect(parseTypedAction(JSON.stringify(GOOD))).toEqual({ action: GOOD });
    const bad = parseTypedAction('{ nope');
    expect('error' in bad && bad.error).toMatch(/Not valid JSON/);
  });

  it('gives a reason a person can act on, never a bare false', () => {
    // Every refusal is a sentence, because every caller shows it to somebody:
    // a dapp developer reading a validation error, or a person looking at the
    // mobile app's action screen.
    for (const bad of [undefined, 'x', without('types'), { ...GOOD, message: {} }]) {
      const reason = validateTypedAction(bad);
      expect(typeof reason).toBe('string');
      expect((reason as string).length).toBeGreaterThan(10);
    }
  });
});
