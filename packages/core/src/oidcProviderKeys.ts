/**
 * Is the RSA key an `oidc_domain_attestation` proof was made with one the
 * named identity provider actually publishes?
 *
 * WHY THIS IS PART OF VERIFICATION AND NOT AN EXTRA. The circuit checks a JWT's
 * RSA signature against `pubkey_modulus_limbs`, and that modulus is a PUBLIC
 * INPUT -- the prover chooses it. Anyone can generate an RSA key, sign a JWT
 * claiming `alice@example.com` with it, and produce a proof that every verifier
 * contract and every verification key accepts. What makes the proof mean
 * "Google (or Microsoft) said so" is comparing that modulus with the keys the
 * provider publishes, and nothing on-chain can fetch a JWKS. So every verify
 * function this package and the SDK export runs this check itself; a dApp is
 * never asked to remember it. (Found 2026-10-23: until then only OpenStoa did.)
 *
 * The comparison follows OpenStoa's `src/lib/proof-issuer.ts`, the one
 * implementation that was already doing it: fixed JWKS URL per provider, no
 * redirects, RSA / e=AQAB / RS256 / sig, a 2048-bit modulus, and an exact match
 * of all eighteen 120-bit limbs.
 *
 * WHAT IT CANNOT DO. It knows the keys the provider lists now, plus the keys
 * this process has seen listed within {@link RECENT_KEY_RETENTION_MS}. A proof
 * made with a key the provider has since withdrawn, and that this process never
 * saw while it was listed, fails -- there is no public archive of past keys to
 * consult. It does not judge the token's audience, nonce or time: since v2
 * the circuit exposes `aud_hash`, `nonce_mode`, `nonce_binding` and `now`
 * (it checks `iat <= now < exp` and the issuer's form itself), and
 * ./oidcPolicy checks those on every verify path before this runs. The
 * token's `iss` and `tid` are still not exposed.
 *
 * Runs in browsers, React Native and Node: `fetch` and `AbortController` only,
 * no `Buffer`. Both JWKS endpoints answer CORS requests (checked 2026-10-23),
 * and `Cache-Control` is a CORS-safelisted response header, so the browser lets
 * us read the max-age.
 */
import { OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT } from './chain';

/**
 * Number of public inputs the OIDC circuit (v2) has. Anything else is not its
 * proof; a v1 proof (148) is refused by name in ./oidcPolicy.
 */
export const OIDC_PUBLIC_INPUT_COUNT = 214;

/** The circuit's RSA modulus is 18 limbs of 120 bits, least significant first. */
const LIMB_BITS = 120n;
const LIMB_COUNT = 18;
const LIMB_MASK = (1n << LIMB_BITS) - 1n;

/** RSA-2048, the only size the circuit's `JWT<...>` instantiation verifies. */
const MODULUS_BYTES = 256;

/**
 * The template issuer Microsoft attaches to keys any organisational tenant may
 * sign with. A key whose `issuer` names one tenant instead (for example
 * `9188040d-6c67-4c5b-b112-36a304b66dad`, the personal-account tenant) may only
 * be used for tokens whose `iss` is exactly that tenant. The circuit does not
 * expose `iss`, so such a key can never be checked here and is refused.
 * Source: https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens
 * ("Validate the signing key issuer").
 */
export const MICROSOFT_MULTI_TENANT_KEY_ISSUER = 'https://login.microsoftonline.com/{tenantid}/v2.0';

export interface OidcProvider {
  /** Human name, for messages. */
  name: string;
  /** Fixed JWKS URL. Not configurable: whoever picks the URL picks the keys. */
  jwksUrl: string;
  /**
   * `null`: the provider does not scope keys by issuer (Google publishes no
   * `issuer` on its keys). A string: the key's `issuer` must equal it exactly.
   */
  requiredKeyIssuer: string | null;
}

/**
 * Keyed by the circuit's `provider` public input (main.nr: 0 Google,
 * 1 Microsoft). A value not listed here is an error, never a guess.
 *
 * Microsoft uses the `organizations` endpoint because that is the authority the
 * mobile app (`MicrosoftAuthConfig.ts`) and proofport-ai's MCP device flow
 * (`MICROSOFT_TENANT = 'organizations'`) sign people in with, and the circuit
 * requires `xms_edov`, an organisational-tenant claim. Live on 2026-10-23,
 * `organizations` listed only template-issuer keys while `common` and
 * `consumers` also listed the personal-account tenant's keys. Google's URL is
 * the `jwks_uri` of https://accounts.google.com/.well-known/openid-configuration.
 */
export const OIDC_PROVIDERS: Readonly<Record<string, OidcProvider>> = Object.freeze({
  '0': {
    name: 'Google',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    requiredKeyIssuer: null,
  },
  '1': {
    name: 'Microsoft',
    jwksUrl: 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys',
    requiredKeyIssuer: MICROSOFT_MULTI_TENANT_KEY_ISSUER,
  },
});

/** Never trust a cached JWKS longer than this, whatever max-age says. */
export const MAX_JWKS_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * How long a key stays acceptable after the last JWKS that listed it. Covers a
 * proof made moments before the provider withdrew its key, and no more: a
 * withdrawn key may be a compromised one, so the window is kept short (1 hour,
 * decided 2026-10-28). Measured from the fetch that last listed the key, not
 * from the refetch that found it gone. In-memory only, so a fresh process
 * starts with nothing remembered.
 */
export const RECENT_KEY_RETENTION_MS = 60 * 60 * 1000;

/**
 * A key missing from a still-fresh cache triggers one refetch, but not more
 * often than this: otherwise every forged proof would cost a request to the
 * provider, and a flood of them would be a flood of requests.
 */
export const MIN_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/** Default fetch timeout. */
export const JWKS_FETCH_TIMEOUT_MS = 5000;

/** A JWKS is a few kilobytes. Anything this large is not one. */
const MAX_JWKS_BYTES = 256 * 1024;

export type IssuerCheckResult = { ok: true } | { ok: false; error: string };

export interface OidcKeyCheckOptions {
  /** Milliseconds before the JWKS fetch is abandoned. Default {@link JWKS_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

interface CachedJwks {
  moduli: Set<string>;
  fetchedAt: number;
  expiresAt: number;
}

const jwksCache = new Map<string, CachedJwks>();
/** provider -> modulus hex -> last time a fetched JWKS listed it. */
const recentlySeen = new Map<string, Map<string, number>>();

/** @internal Test seam: start from an empty cache and no remembered keys. */
export function clearOidcKeyCache(): void {
  jwksCache.clear();
  recentlySeen.clear();
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Strict base64url (RFC 7515: no padding, no other characters) to bytes. */
function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of value) {
    buffer = (buffer << 6) | B64URL.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * The modulus a JWK carries, as lowercase hex, if the key is one the circuit's
 * provider could have signed an ID token with. `null` for anything else.
 */
function acceptableModulus(raw: unknown, provider: OidcProvider): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const key = raw as Record<string, unknown>;
  if (key.kty !== 'RSA') return null;
  if (key.e !== 'AQAB') return null;
  if (key.alg !== undefined && key.alg !== 'RS256') return null;
  if (key.use !== undefined && key.use !== 'sig') return null;
  if (provider.requiredKeyIssuer !== null && key.issuer !== provider.requiredKeyIssuer) return null;
  if (typeof key.n !== 'string') return null;
  const bytes = base64UrlToBytes(key.n);
  if (!bytes) return null;
  // No size test here: the proof's modulus is required to be exactly 2048 bits
  // (modulusFromLimbs), and only an exact match is accepted, so a key of any
  // other size can never match. A second test here could not be told apart
  // from the first by any input.
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** `max-age` in ms, or 0 when the response may not be reused. */
function cacheLifetimeMs(cacheControl: string | null): number {
  if (!cacheControl) return 0;
  const directives = cacheControl.toLowerCase().split(',').map(d => d.trim());
  if (directives.some(d => d === 'no-store' || d === 'no-cache')) return 0;
  const maxAge = directives.find(d => d.startsWith('max-age='));
  if (!maxAge) return 0;
  const seconds = Number(maxAge.slice('max-age='.length));
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, MAX_JWKS_CACHE_MS);
}

async function fetchJwks(providerId: string, provider: OidcProvider, timeoutMs: number): Promise<CachedJwks> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let text: string;
  try {
    // redirect: 'error' -- the URL is fixed so that nobody can choose the keys;
    // following a redirect would hand that choice to whoever answers it.
    response = await fetch(provider.jwksUrl, { redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch ${provider.name}'s signing keys from ${provider.jwksUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_JWKS_BYTES) {
    throw new Error(`${provider.name}'s key set at ${provider.jwksUrl} is ${text.length} bytes; a key set is a few kilobytes.`);
  }
  let keys: unknown;
  try {
    keys = (JSON.parse(text) as { keys?: unknown })?.keys;
  } catch {
    throw new Error(`${provider.name}'s key set at ${provider.jwksUrl} is not JSON.`);
  }
  if (!Array.isArray(keys)) {
    throw new Error(`${provider.name}'s key set at ${provider.jwksUrl} has no "keys" array.`);
  }
  const moduli = new Set<string>();
  for (const key of keys) {
    const modulus = acceptableModulus(key, provider);
    if (modulus) moduli.add(modulus);
  }
  const now = Date.now();
  const seen = recentlySeen.get(providerId) ?? new Map<string, number>();
  for (const modulus of moduli) seen.set(modulus, now);
  recentlySeen.set(providerId, seen);
  const entry = { moduli, fetchedAt: now, expiresAt: now + cacheLifetimeMs(response.headers.get('cache-control')) };
  jwksCache.set(providerId, entry);
  return entry;
}

function seenRecently(providerId: string, modulus: string): boolean {
  const at = recentlySeen.get(providerId)?.get(modulus);
  return at !== undefined && Date.now() - at <= RECENT_KEY_RETENTION_MS;
}

/** The proof's modulus as hex, or a reason it is not a well-formed one. */
function modulusFromLimbs(publicInputs: readonly string[]): { hex: string } | { error: string } {
  const layout = OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT;
  let modulus = 0n;
  for (let i = LIMB_COUNT - 1; i >= 0; i--) {
    let limb: bigint;
    try {
      limb = BigInt(publicInputs[layout.PUBKEY_MODULUS_START + i]);
    } catch {
      return { error: `Public input ${i} (an RSA modulus limb) is not a number.` };
    }
    if (limb < 0n || limb > LIMB_MASK) {
      return { error: `Public input ${i} (an RSA modulus limb) does not fit in 120 bits.` };
    }
    modulus = (modulus << LIMB_BITS) | limb;
  }
  const hex = modulus.toString(16);
  if (hex.length !== MODULUS_BYTES * 2) {
    return { error: 'The proof\'s RSA modulus is not 2048 bits, so it is not a provider signing key.' };
  }
  return { hex };
}

/**
 * Check an `oidc_domain_attestation` proof's RSA modulus against its
 * provider's published keys.
 *
 * Never passes on doubt: a fetch that fails, times out, redirects or returns
 * something that is not a key set answers `{ ok: false, error }`. A cached key
 * set is reused for the response's `Cache-Control: max-age` (at most 24 h); an
 * expired one is refetched, and if that refetch fails the check fails too.
 *
 * @throws Error when the proof's `provider` public input is not a provider this
 *   package knows. That is an unknown identifier, not a failed proof.
 */
export async function checkOidcProviderKey(
  publicInputs: readonly string[],
  options: OidcKeyCheckOptions = {},
): Promise<IssuerCheckResult> {
  if (!Array.isArray(publicInputs) || publicInputs.length !== OIDC_PUBLIC_INPUT_COUNT) {
    return {
      ok: false,
      error: `An oidc_domain_attestation proof has ${OIDC_PUBLIC_INPUT_COUNT} public inputs; got ${Array.isArray(publicInputs) ? publicInputs.length : typeof publicInputs}.`,
    };
  }

  let providerValue: bigint;
  try {
    providerValue = BigInt(publicInputs[OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PROVIDER]);
  } catch {
    return { ok: false, error: 'The proof\'s provider public input is not a number.' };
  }
  const providerId = providerValue.toString();
  if (!Object.prototype.hasOwnProperty.call(OIDC_PROVIDERS, providerId)) {
    throw new Error(
      `Unknown OIDC provider ${providerId}. Known: ${Object.entries(OIDC_PROVIDERS).map(([id, p]) => `${id} (${p.name})`).join(', ')}.`,
    );
  }
  const provider = OIDC_PROVIDERS[providerId];

  const modulus = modulusFromLimbs(publicInputs);
  if ('error' in modulus) return { ok: false, error: modulus.error };

  const timeoutMs = options.timeoutMs ?? JWKS_FETCH_TIMEOUT_MS;
  let jwks = jwksCache.get(providerId);
  try {
    if (!jwks || Date.now() >= jwks.expiresAt) {
      jwks = await fetchJwks(providerId, provider, timeoutMs);
    } else if (!jwks.moduli.has(modulus.hex) && !seenRecently(providerId, modulus.hex)
      && Date.now() - jwks.fetchedAt >= MIN_REFETCH_INTERVAL_MS) {
      // A key the provider started using after we cached its set.
      jwks = await fetchJwks(providerId, provider, timeoutMs);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (jwks.moduli.has(modulus.hex) || seenRecently(providerId, modulus.hex)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `The proof was made with an RSA key that ${provider.name} does not publish at ${provider.jwksUrl}, ` +
      'so nothing shows the identity token came from the provider. (A key withdrawn before this process first saw it cannot be checked.)',
  };
}
