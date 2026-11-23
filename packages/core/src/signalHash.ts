/**
 * The `signal_hash` a wallet credential proof carries when no EIP-712 action is
 * bound, and the check a relying party runs on it.
 *
 *   signal_hash = keccak256(abi.encodePacked(string scope, string circuitId, string requestId))
 *               = keccak256(utf8(scope) ++ utf8(circuitId) ++ utf8(requestId))
 *
 * `signal_hash` is a PUBLIC input. Until 2026-11-17 its preimage began with the
 * user's wallet address, because the old nullifier was derived from it; anyone
 * could then try every address in the public attestation set and recover the
 * prover. The nullifier now comes from the OPRF (circuits-dev.md, "OPRF
 * nullifier in every wallet credential circuit") and no circuit reads the
 * preimage, so the address left it and the request id took its place: the
 * hash is now fresh per request, and the relying party that issued the request
 * can recompute it and refuse a proof made for another request.
 *
 * `requestId` is the id of the request the proof answers: the relay's request
 * id (a lowercase UUID), the SDK's deep-link request id, or one the prover
 * minted for a proof nobody asked for. It may hold only ASCII letters, digits
 * and '-'. Every circuit id contains '_' and a request id never does, so for a
 * known circuit the packed bytes split back into exactly one (scope, requestId)
 * pair -- the encoding is unambiguous without a length prefix.
 *
 * With an EIP-712 action the wallet signs the action and `signal_hash` is all
 * zeros (the circuit refuses a proof that carries both), so the action itself
 * is what ties that proof to a request.
 *
 * A request with no dApp action is signed as the PROOF REQUEST itself, a
 * readable EIP-712 struct (see {@link PROOF_REQUEST_TYPE}), since app 1.7.3:
 * a wallet showed the 32 bytes of a personal_sign request as unreadable text.
 * Its fields are exactly this hash's preimage, so {@link checkSignalHash}
 * rebuilds the struct hash from the same request and refuses a proof made for
 * another one. A proof carrying the plain signal_hash (the AI server, older
 * apps) is still accepted.
 *
 * Mirrored, until this package's next release reaches them, by
 * proofport-app `src/utils/signalHash.ts`, proofport-ai
 * `packages/sdk/src/signalHash.ts` and circuits `scripts/lib/signal-hash.js`.
 * All four read `signal-hash-vectors.json` (kept byte-identical; the parent
 * repository's `scripts/check-signal-hash-vectors.sh` compares the copies).
 */
import { ethers } from 'ethers';
import { ALL_CIRCUIT_IDS, isCircuitId, type CircuitId } from './circuits';
import type { IssuerCheckResult } from './oidcProviderKeys';

/** Scope cap in UTF-8 bytes; the same cap the OIDC request binding uses. */
export const SIGNAL_HASH_MAX_SCOPE_BYTES = 4096;

/** Request id cap in characters. A UUID is 36, the SDK's deep-link id about 20. */
export const SIGNAL_HASH_MAX_REQUEST_ID_LENGTH = 128;

const REQUEST_ID = /^[A-Za-z0-9-]+$/;

/** Where a circuit's signal_hash and action_hash sit, one byte per field. */
export interface SignalHashLayout {
  signalStart: number;
  actionHashStart: number;
}

const FIRST_THREE: SignalHashLayout = Object.freeze({ signalStart: 0, actionHashStart: 64 });

/**
 * Per circuit, read off its `fn main`: every wallet credential circuit puts
 * signal_hash, domain_separator and action_hash first. `null` means the circuit
 * has no signal_hash at all.
 */
export const SIGNAL_HASH_LAYOUTS = Object.freeze({
  coinbase_attestation: FIRST_THREE,
  coinbase_country_attestation: FIRST_THREE,
  // An ID token, not a wallet signature; its request binding is the OIDC nonce (./oidcPolicy).
  oidc_domain_attestation: null,
  giwa_attestation: FIRST_THREE,
  dojang_playground: FIRST_THREE,
  human_passport_score: FIRST_THREE,
} satisfies Record<CircuitId, SignalHashLayout | null>);

/** The circuits whose proofs carry a signal_hash. */
export const SIGNAL_HASH_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter(id => SIGNAL_HASH_LAYOUTS[id] !== null),
);

/** The request a proof answers. */
export interface SignalHashRequest {
  /** The scope string asked for (not its hash). */
  scope: string;
  /** The id of the request the proof answers. */
  requestId: string;
}

const _ethers = ethers as any;

function keccakHex(data: Uint8Array): string {
  if (typeof _ethers.keccak256 === 'function') return _ethers.keccak256(data);
  if (_ethers.utils?.keccak256) return _ethers.utils.keccak256(data);
  throw new Error('No keccak256 found in ethers');
}

/** Index of the first unpaired UTF-16 surrogate, or -1. TextEncoder would replace it silently. */
function loneSurrogateAt(value: string): number {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return i;
  }
  return -1;
}

function layoutOf(circuitId: unknown): SignalHashLayout {
  if (!isCircuitId(circuitId)) {
    throw new Error(`Unknown circuit '${String(circuitId)}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  const layout = SIGNAL_HASH_LAYOUTS[circuitId];
  if (layout === null) {
    throw new Error(
      `${circuitId} has no signal_hash. Circuits that do: ${SIGNAL_HASH_CIRCUIT_IDS.join(', ')}.`,
    );
  }
  return layout;
}

/** Why this scope cannot be hashed, or null. */
export function signalHashScopeError(scope: unknown): string | null {
  if (typeof scope !== 'string') return `scope must be a string, got ${scope === null ? 'null' : typeof scope}.`;
  if (scope.trim() === '') return 'scope is empty.';
  const at = loneSurrogateAt(scope);
  if (at >= 0) return `scope is not valid Unicode text: unpaired surrogate at index ${at}.`;
  const bytes = new TextEncoder().encode(scope).length;
  if (bytes > SIGNAL_HASH_MAX_SCOPE_BYTES) {
    return `scope is ${bytes} bytes; the limit is ${SIGNAL_HASH_MAX_SCOPE_BYTES}.`;
  }
  return null;
}

/** Why this request id cannot be hashed, or null. */
export function signalHashRequestIdError(requestId: unknown): string | null {
  if (typeof requestId !== 'string') {
    return `requestId must be a string, got ${requestId === null ? 'null' : typeof requestId}.`;
  }
  if (requestId.length === 0) return 'requestId is empty.';
  if (requestId.length > SIGNAL_HASH_MAX_REQUEST_ID_LENGTH) {
    return `requestId is ${requestId.length} characters; the limit is ${SIGNAL_HASH_MAX_REQUEST_ID_LENGTH}.`;
  }
  if (!REQUEST_ID.test(requestId)) {
    return `requestId may hold only ASCII letters, digits and '-', got ${JSON.stringify(requestId)}.`;
  }
  return null;
}

/**
 * The signal_hash a proof without an EIP-712 action carries for this request,
 * as 0x-prefixed lowercase hex (32 bytes).
 *
 * @throws Error naming the problem: an unknown circuit id, a circuit with no
 *   signal_hash, or a scope / requestId outside the rules above.
 */
export function computeSignalHash(request: { scope: string; circuitId: string; requestId: string }): string {
  layoutOf(request.circuitId);
  const scopeError = signalHashScopeError(request.scope);
  if (scopeError) throw new Error(scopeError);
  const idError = signalHashRequestIdError(request.requestId);
  if (idError) throw new Error(idError);
  const encoder = new TextEncoder();
  const parts = [encoder.encode(request.scope), encoder.encode(request.circuitId), encoder.encode(request.requestId)];
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    packed.set(p, at);
    at += p.length;
  }
  return keccakHex(packed).toLowerCase();
}

function readBytesHex(publicInputs: readonly string[], start: number, name: string): string | { error: string } {
  let hex = '0x';
  for (let i = start; i < start + 32; i++) {
    let value: bigint;
    try {
      value = BigInt(publicInputs[i]);
    } catch {
      return { error: `Public input ${i} (${name} byte ${i - start}) is not a number.` };
    }
    if (value < 0n || value > 255n) {
      return { error: `Public input ${i} (${name} byte ${i - start}) is out of range: ${value}.` };
    }
    hex += value.toString(16).padStart(2, '0');
  }
  return hex;
}

const ZERO32 = '0x' + '00'.repeat(32);

/** The EIP-712 domain a request with no dApp action is signed under. No chainId: the request names no chain. */
export const PROOF_REQUEST_DOMAIN = Object.freeze({ name: 'ZKProofport', version: '1' });
/** The struct a wallet signs for a request with no dApp action. */
export const PROOF_REQUEST_TYPE = 'ProofRequest(string statement,string scope,string proof,string requestId)';
/** The fixed first field: what the person is approving. */
export const PROOF_REQUEST_STATEMENT = 'Approve this proof request in ZKProofport';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function keccakOfWords(words: string[]): string {
  const packed = new Uint8Array(words.length * 32);
  words.forEach((w, i) => packed.set(hexBytes(w), i * 32));
  return keccakHex(packed).toLowerCase();
}

/** keccak256(abi.encode(typeHash(EIP712Domain(string name,string version)), keccak(name), keccak(version))). */
export const PROOF_REQUEST_DOMAIN_SEPARATOR: string = keccakOfWords([
  keccakHex(utf8('EIP712Domain(string name,string version)')),
  keccakHex(utf8(PROOF_REQUEST_DOMAIN.name)),
  keccakHex(utf8(PROOF_REQUEST_DOMAIN.version)),
]);

/**
 * The EIP-712 struct hash of the proof request a wallet signs when the dApp
 * bound no action: the `action_hash` public input of such a proof.
 *
 * @throws Error naming the problem, under the same rules as {@link computeSignalHash}.
 */
export function computeProofRequestHash(request: { scope: string; circuitId: string; requestId: string }): string {
  computeSignalHash(request);
  return keccakOfWords([
    keccakHex(utf8(PROOF_REQUEST_TYPE)),
    keccakHex(utf8(PROOF_REQUEST_STATEMENT)),
    keccakHex(utf8(request.scope)),
    keccakHex(utf8(request.circuitId)),
    keccakHex(utf8(request.requestId)),
  ]);
}

/**
 * Check a proof's signal_hash against the request the relying party issued.
 *
 * - An action-bound proof (action_hash not zero) must carry a zero
 *   signal_hash; the action is then what the relying party checks.
 * - Any other proof must carry exactly {@link computeSignalHash} of this
 *   request -- a proof made for another request, another scope or another
 *   circuit is refused.
 *
 * Never throws: everything here arrives from the proof's sender.
 */
export function checkSignalHash(
  circuitId: string,
  publicInputs: readonly string[],
  request: SignalHashRequest,
): IssuerCheckResult {
  let layout: SignalHashLayout;
  let expected: string;
  try {
    layout = layoutOf(circuitId);
    if (!request || typeof request !== 'object') throw new Error('The request must be an object { scope, requestId }.');
    expected = computeSignalHash({ scope: request.scope, circuitId, requestId: request.requestId });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!Array.isArray(publicInputs) || publicInputs.length < layout.actionHashStart + 32) {
    return { ok: false, error: `Too few public inputs to hold signal_hash and action_hash for ${circuitId}.` };
  }
  const signal = readBytesHex(publicInputs, layout.signalStart, 'signal_hash');
  if (typeof signal !== 'string') return { ok: false, error: signal.error };
  const action = readBytesHex(publicInputs, layout.actionHashStart, 'action_hash');
  if (typeof action !== 'string') return { ok: false, error: action.error };
  if (action !== ZERO32) {
    if (signal !== ZERO32) {
      return { ok: false, error: `The proof carries both an action and signal_hash ${signal}; an action-bound proof has none.` };
    }
    const domain = readBytesHex(publicInputs, layout.signalStart + 32, 'domain_separator');
    if (typeof domain !== 'string') return { ok: false, error: domain.error };
    if (domain === PROOF_REQUEST_DOMAIN_SEPARATOR) {
      // Signed as this SDK's proof request: it must be THIS request.
      const expectedAction = computeProofRequestHash({ scope: request.scope, circuitId, requestId: request.requestId });
      if (action !== expectedAction) {
        return {
          ok: false,
          error: `The proof's signed request ${action} is not the one for request ${request.requestId} ` +
            `(expected ${expectedAction}), so it was made for another request, scope or circuit.`,
        };
      }
    }
    return { ok: true };
  }
  if (signal !== expected) {
    return {
      ok: false,
      error: `The proof's signal_hash ${signal} is not the one for request ${request.requestId} ` +
        `(expected ${expected}), so it was made for another request, scope or circuit.`,
    };
  }
  return { ok: true };
}
