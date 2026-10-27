/**
 * What an `oidc_domain_attestation` v2 proof must say about its ID token
 * before any verify function in this package or the SDK calls it valid.
 *
 * The v2 circuit (circuits `oidc-domain-attestation`, 214 public inputs) proves
 * the token's `aud`, `iss`, `iat`/`exp` and, on the app path, its `nonce`, but
 * it exposes them as values a verifier still has to judge:
 *
 *   148-179  aud_hash       keccak256 of the token's `aud` string
 *   180      nonce_mode     1 = the token's nonce is hex(nonce_binding), 0 = none
 *   181-212  nonce_binding  32 bytes; all zero when nonce_mode is 0
 *   213      now            unix seconds; the circuit proves iat <= now < exp
 *
 * The circuit accepts ANY audience and ANY `now`. Without this check a token
 * Google issued to some other website, or one that expired last year with a
 * `now` picked from inside its lifetime, makes a proof every verifier contract
 * accepts. So this runs on every verify path, before the provider-key check
 * and before the contract or Barretenberg is asked.
 *
 * Policy (decided 2026-10-27, circuits-dev.md "Fix list" item 2):
 *  - `aud` must be one of our own OAuth clients, listed per provider below.
 *  - The app signs in with a nonce derived from the request (nonce_mode 1).
 *    The CLI/AI device flow cannot carry a nonce and proves with nonce_mode 0
 *    and an all-zero binding; Google's device client is accepted ONLY in mode
 *    0 and Google's web client ONLY in mode 1. Microsoft uses one client id for
 *    both paths, so it is accepted in either mode.
 *  - When the caller supplies the request the proof answers (scope +
 *    requestId), a mode-1 proof's binding must equal
 *    keccak256(utf8("zkproofport-oidc-v1") || keccak256(utf8(scope)) || utf8(requestId)),
 *    which is what the app derives (proofport-app src/oidc/oidcNonce.ts), and
 *    the proof's scope must be keccak256(utf8(scope)).
 *  - `now` may be at most {@link OIDC_NOW_MAX_AGE_SECONDS} behind and
 *    {@link OIDC_NOW_MAX_FUTURE_SECONDS} ahead of the verifier's clock.
 *
 * Anything else, including a value this table does not list, is refused.
 */
import { ethers } from 'ethers';
import { OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as LAYOUT } from './chain';
import type { IssuerCheckResult } from './oidcProviderKeys';

/** Public inputs of the v2 circuit. */
export const OIDC_V2_PUBLIC_INPUT_COUNT = 214;
/** Public inputs of the v1 circuit, which bound no audience, expiry or nonce. */
export const OIDC_V1_PUBLIC_INPUT_COUNT = 148;

/** Domain tag of the request nonce. Shared with the app's oidcNonce.ts and the circuits reference builder. */
export const OIDC_NONCE_DOMAIN = 'zkproofport-oidc-v1';

/** Same cap the app applies before hashing a scope (proofport-app src/oidc/oidcNonce.ts). */
export const OIDC_MAX_SCOPE_BYTES = 4096;

/**
 * How far `now` may lag the verifier's clock. Covers on-device proving of the
 * 2^19 circuit, relay delivery and a dApp that polls rather than listens.
 * A stored proof re-verified later than this is refused: the circuit only
 * shows the token was valid at `now`, and a stale `now` says nothing about
 * the present.
 */
export const OIDC_NOW_MAX_AGE_SECONDS = 15 * 60;

/** How far `now` may run ahead of the verifier's clock (a phone clock set fast). */
export const OIDC_NOW_MAX_FUTURE_SECONDS = 5 * 60;

export type OidcNonceMode = 0 | 1;

export interface OidcAudience {
  /** The OAuth client id, exactly as the token's `aud` carries it. */
  clientId: string;
  /** Which of our sign-in paths gets tokens for it. For messages. */
  label: string;
  /** The nonce modes a token for this client may be proved in. */
  nonceModes: readonly OidcNonceMode[];
}

/**
 * Our OAuth clients, keyed by the circuit's `provider` public input
 * (0 Google, 1 Microsoft). Sources: proofport-app src/config/GoogleAuthConfig.ts
 * (GOOGLE_WEB_CLIENT_ID) and MicrosoftAuthConfig.ts (MICROSOFT_CLIENT_ID);
 * proofport-ai packages/mcp/src/prove.ts (device-flow GOOGLE_CLIENT_ID and
 * MICROSOFT_CLIENT_ID).
 */
export const OIDC_ALLOWED_AUDIENCES: Readonly<Record<string, readonly OidcAudience[]>> = Object.freeze({
  '0': Object.freeze([
    Object.freeze({
      clientId: '491923400813-5bb3up7dhejns2unvbrt6mku520hrr5g.apps.googleusercontent.com',
      label: 'Google web client (ZKProofport app, nonce bound)',
      nonceModes: Object.freeze([1] as const),
    }),
    Object.freeze({
      clientId: '491923400813-pr17m6kpin2rsbbes18jpb60j1s3qmv4.apps.googleusercontent.com',
      label: 'Google device client (CLI / AI device flow, no nonce)',
      nonceModes: Object.freeze([0] as const),
    }),
  ]),
  '1': Object.freeze([
    Object.freeze({
      clientId: '8b09c842-d7a8-4d9c-a6ea-46c797412bac',
      label: 'Microsoft client (app with nonce, device flow without)',
      nonceModes: Object.freeze([0, 1] as const),
    }),
  ]),
});

/** The request a proof answers. Only the app path (nonce_mode 1) binds it. */
export interface OidcRequestContext {
  /** The scope string the dApp asked for (not its hash). */
  scope: string;
  /** The relay-issued request id: a canonical lowercase UUID. */
  requestId: string;
}

export interface OidcPolicyOptions {
  /** When given, a mode-1 proof must be bound to exactly this request. */
  request?: OidcRequestContext;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const U64_MAX = (1n << 64n) - 1n;

const _ethers = ethers as any;

function keccakHex(data: Uint8Array): string {
  if (typeof _ethers.keccak256 === 'function') return _ethers.keccak256(data);
  if (_ethers.utils?.keccak256) return _ethers.utils.keccak256(data);
  throw new Error('No keccak256 found in ethers');
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** keccak256(utf8(value)) as lowercase hex without `0x`. */
export function oidcAudienceHash(clientId: string): string {
  return keccakHex(utf8(clientId)).slice(2).toLowerCase();
}

function requestError(request: unknown): string | null {
  if (!request || typeof request !== 'object') return 'The OIDC request must be an object { scope, requestId }.';
  const { scope, requestId } = request as Record<string, unknown>;
  if (typeof scope !== 'string') {
    return `The OIDC request's scope must be a string, got ${scope === null ? 'null' : typeof scope}.`;
  }
  if (scope.trim() === '') return 'The OIDC request\'s scope is empty.';
  const scopeBytes = utf8(scope).length;
  if (scopeBytes > OIDC_MAX_SCOPE_BYTES) {
    return `The OIDC request's scope is ${scopeBytes} bytes; the limit is ${OIDC_MAX_SCOPE_BYTES}.`;
  }
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    return `The OIDC request's requestId must be a lowercase UUID (8-4-4-4-12 hex), got ${JSON.stringify(requestId)}.`;
  }
  return null;
}

/**
 * The 32-byte nonce binding for a request, as lowercase hex without `0x`.
 * The token's `nonce` claim is exactly this string.
 *
 * @throws Error when the scope or requestId is not acceptable (see {@link OidcRequestContext}).
 */
export function deriveOidcNonceBinding(scope: string, requestId: string): string {
  const error = requestError({ scope, requestId });
  if (error) throw new Error(error);
  const scopeHash = hexToBytes(keccakHex(utf8(scope)));
  return keccakHex(concat(utf8(OIDC_NONCE_DOMAIN), scopeHash, utf8(requestId))).slice(2).toLowerCase();
}

type Parsed<T> = { value: T } | { error: string };

function readField(publicInputs: readonly string[], index: number, name: string, max: bigint): Parsed<bigint> {
  let v: bigint;
  try {
    v = BigInt(publicInputs[index]);
  } catch {
    return { error: `Public input ${index} (${name}) is not a number.` };
  }
  if (v < 0n || v > max) return { error: `Public input ${index} (${name}) is out of range: ${v}.` };
  return { value: v };
}

function readBytes(publicInputs: readonly string[], start: number, end: number, name: string): Parsed<string> {
  let hex = '';
  for (let i = start; i <= end; i++) {
    const b = readField(publicInputs, i, `${name} byte ${i - start}`, 255n);
    if ('error' in b) return b;
    hex += b.value.toString(16).padStart(2, '0');
  }
  return { value: hex };
}

/**
 * Check an `oidc_domain_attestation` proof's audience, nonce mode, nonce
 * binding and `now` against the policy above.
 *
 * Never throws for anything the proof's sender controls: every refusal is
 * `{ ok: false, error }` naming the value that failed. A v1 proof (148 public
 * inputs) is refused with its own message, because the v1 circuit bound none
 * of these claims.
 */
export function checkOidcPolicy(
  publicInputs: readonly string[],
  options: OidcPolicyOptions = {},
): IssuerCheckResult {
  if (!Array.isArray(publicInputs)) {
    return { ok: false, error: `OIDC public inputs must be an array, got ${typeof publicInputs}.` };
  }
  if (publicInputs.length === OIDC_V1_PUBLIC_INPUT_COUNT) {
    return {
      ok: false,
      error:
        `This is a v1 oidc_domain_attestation proof (${OIDC_V1_PUBLIC_INPUT_COUNT} public inputs). v1 binds no ` +
        `audience, expiry or nonce, so any Google or Microsoft ID token for the same email proves it; it is no ` +
        `longer accepted. Generate a new proof with the v2 circuit (${OIDC_V2_PUBLIC_INPUT_COUNT} public inputs).`,
    };
  }
  if (publicInputs.length !== OIDC_V2_PUBLIC_INPUT_COUNT) {
    return {
      ok: false,
      error: `An oidc_domain_attestation proof has ${OIDC_V2_PUBLIC_INPUT_COUNT} public inputs; got ${publicInputs.length}.`,
    };
  }

  const provider = readField(publicInputs, LAYOUT.PROVIDER, 'provider', 255n);
  if ('error' in provider) return { ok: false, error: provider.error };
  const providerId = provider.value.toString();
  if (!Object.prototype.hasOwnProperty.call(OIDC_ALLOWED_AUDIENCES, providerId)) {
    return {
      ok: false,
      error: `Unknown OIDC provider ${providerId}. Known: ${Object.keys(OIDC_ALLOWED_AUDIENCES).join(', ')}.`,
    };
  }

  const mode = readField(publicInputs, LAYOUT.NONCE_MODE, 'nonce_mode', 255n);
  if ('error' in mode) return { ok: false, error: mode.error };
  if (mode.value !== 0n && mode.value !== 1n) {
    return { ok: false, error: `Unknown OIDC nonce_mode ${mode.value}. Known: 0 (no nonce), 1 (request-bound nonce).` };
  }
  const nonceMode = Number(mode.value) as OidcNonceMode;

  const aud = readBytes(publicInputs, LAYOUT.AUD_HASH_START, LAYOUT.AUD_HASH_END, 'aud_hash');
  if ('error' in aud) return { ok: false, error: aud.error };
  const audiences = OIDC_ALLOWED_AUDIENCES[providerId];
  const audience = audiences.find(a => oidcAudienceHash(a.clientId) === aud.value);
  if (!audience) {
    return {
      ok: false,
      error:
        `The ID token's audience (aud_hash 0x${aud.value}) is not a ZKProofport client for provider ${providerId}. ` +
        `Accepted: ${audiences.map(a => a.clientId).join(', ')}.`,
    };
  }
  if (!audience.nonceModes.includes(nonceMode)) {
    return {
      ok: false,
      error:
        `nonce_mode ${nonceMode} is not accepted for ${audience.label} (${audience.clientId}); ` +
        `it is accepted only in nonce_mode ${audience.nonceModes.join(' or ')}.`,
    };
  }

  const binding = readBytes(publicInputs, LAYOUT.NONCE_BINDING_START, LAYOUT.NONCE_BINDING_END, 'nonce_binding');
  if ('error' in binding) return { ok: false, error: binding.error };
  if (nonceMode === 0 && binding.value !== '00'.repeat(32)) {
    return { ok: false, error: 'nonce_mode is 0 but nonce_binding is not all zero.' };
  }

  if (options.request !== undefined) {
    const invalid = requestError(options.request);
    if (invalid) return { ok: false, error: invalid };
    const { scope, requestId } = options.request;
    const proofScope = readBytes(publicInputs, LAYOUT.SCOPE_START, LAYOUT.SCOPE_END, 'scope');
    if ('error' in proofScope) return { ok: false, error: proofScope.error };
    const expectedScope = keccakHex(utf8(scope)).slice(2).toLowerCase();
    if (proofScope.value !== expectedScope) {
      return {
        ok: false,
        error: `The proof's scope 0x${proofScope.value} is not keccak256 of the requested scope ${JSON.stringify(scope)} (0x${expectedScope}).`,
      };
    }
    if (nonceMode === 1) {
      const expected = deriveOidcNonceBinding(scope, requestId);
      if (binding.value !== expected) {
        return {
          ok: false,
          error: `The ID token's nonce is bound to 0x${binding.value}, not to request ${requestId} (expected 0x${expected}).`,
        };
      }
    }
  }

  const now = readField(publicInputs, LAYOUT.NOW, 'now', U64_MAX);
  if ('error' in now) return { ok: false, error: now.error };
  const clock = BigInt(Math.floor(Date.now() / 1000));
  if (now.value > clock + BigInt(OIDC_NOW_MAX_FUTURE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's now (${now.value}) is ${now.value - clock}s ahead of this verifier's clock (${clock}); at most ${OIDC_NOW_MAX_FUTURE_SECONDS}s is accepted.`,
    };
  }
  if (now.value < clock - BigInt(OIDC_NOW_MAX_AGE_SECONDS)) {
    return {
      ok: false,
      error: `The proof's now (${now.value}) is ${clock - now.value}s behind this verifier's clock (${clock}); at most ${OIDC_NOW_MAX_AGE_SECONDS}s is accepted.`,
    };
  }

  return { ok: true };
}
