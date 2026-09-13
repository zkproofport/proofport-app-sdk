/**
 * Checking the EIP-712 action an `arc_eligibility` proof binds to.
 *
 * Three places need this answer and they have to agree: a dapp building the
 * request, this SDK validating a deep link, and the mobile app before it asks
 * a wallet to sign. The check lived in the mobile app's demo screen and
 * nowhere else, so an action arriving from a dapp reached the prover
 * unexamined — and that is the path that ships.
 *
 * The circuit hashes the domain and the struct and proves the wallet signed
 * them. It never learns what the action says, so a malformed one does not
 * fail: it produces a valid proof of the wrong thing.
 */
import type { TypedAction } from './types';

export type { TypedAction };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The reason the value is not a usable action, or `null` when it is one.
 *
 * Structural validation only, not application authorization policy. Consumers
 * (e.g. EligibilityGate) must independently enforce the expected chain, verifying
 * contract, actor, action parameters, nonce and deadline as applicable.
 * EIP-712 signs only fields declared in types, not extra message properties.
 *
 * A string rather than a boolean because every caller shows it to somebody —
 * a dapp developer reading a validation error, or a person looking at the
 * mobile app's demo screen.
 */
export function validateTypedAction(value: unknown): string | null {
  if (value === undefined || value === null) {
    return 'action is required for arc_eligibility. The circuit proves that a wallet authorised ONE EIP-712 action; there is nothing to prove without it.';
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'action must be an object.';
  }
  const a = value as Partial<TypedAction>;

  const d = a.domain;
  if (!d || typeof d !== 'object') {
    return 'action.domain is required.';
  }
  for (const k of ['name', 'version', 'verifyingContract'] as const) {
    if (typeof d[k] !== 'string' || !d[k]) {
      return `action.domain.${k} must be a non-empty string.`;
    }
  }
  if (typeof d.chainId !== 'number' || !Number.isInteger(d.chainId)) {
    return 'action.domain.chainId must be an integer.';
  }
  if (!ADDRESS.test(d.verifyingContract)) {
    return 'action.domain.verifyingContract must be a 20-byte hex address.';
  }

  if (!a.types || typeof a.types !== 'object' || Array.isArray(a.types)) {
    return 'action.types is required.';
  }
  if (typeof a.primaryType !== 'string' || !a.primaryType) {
    return 'action.primaryType is required.';
  }
  if (!(a.primaryType in a.types)) {
    return `action.primaryType '${a.primaryType}' is not one of the structs in action.types.`;
  }
  if (!a.message || typeof a.message !== 'object' || Array.isArray(a.message)) {
    return 'action.message is required.';
  }

  // Every field the struct declares must be present, or the wallet signs a
  // different message than the one the caller described.
  const fields = a.types[a.primaryType];
  if (!Array.isArray(fields) || fields.length === 0) {
    return `action.types.${a.primaryType} declares no fields.`;
  }
  const missing = fields
    .map(f => f?.name)
    .filter(n => typeof n === 'string' && !(n in (a.message as object)));
  if (missing.length) {
    return `action.message is missing: ${missing.join(', ')}`;
  }

  return null;
}

/** The action, or the reason it is not one. For text a person typed. */
export function parseTypedAction(text: string): { action: TypedAction } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
  const error = validateTypedAction(raw);
  return error ? { error } : { action: raw as TypedAction };
}
