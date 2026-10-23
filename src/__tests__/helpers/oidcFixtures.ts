/**
 * OIDC test material: real RSA-2048 keys, their JWKs, and public inputs laid
 * out the way oidc_domain_attestation emits them (148 fields; the modulus as
 * eighteen 120-bit limbs, least significant first, at 0-17; provider at 147).
 *
 * No real OIDC proof exists on hand (circuits-dev.md, 2026-10-22), so the
 * public inputs are built here. The issuer check reads only the limbs and the
 * provider; the proof bytes never reach it.
 */
import { generateKeyPairSync } from 'crypto';
import { vi } from 'vitest';

export interface TestKey {
  jwk: Record<string, unknown>;
  n: string;
}

export function makeRsaKey(bits = 2048, extra: Record<string, unknown> = {}): TestKey {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { jwk: { kid: `k${Math.random()}`, use: 'sig', alg: 'RS256', ...jwk, ...extra }, n: jwk.n as string };
}

const field = (v: bigint) => '0x' + v.toString(16).padStart(64, '0');

export function modulusOf(n: string): bigint {
  return BigInt('0x' + Buffer.from(n, 'base64url').toString('hex'));
}

/** 148 public inputs carrying this modulus and provider. */
export function oidcPublicInputs(n: string | bigint, provider: number | bigint = 0): string[] {
  let modulus = typeof n === 'bigint' ? n : modulusOf(n);
  const inputs: string[] = [];
  for (let i = 0; i < 18; i++) {
    inputs.push(field(modulus & ((1n << 120n) - 1n)));
    modulus >>= 120n;
  }
  while (inputs.length < 147) inputs.push(field(0n));
  inputs.push(field(BigInt(provider)));
  return inputs;
}

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys';
export const MS_TEMPLATE_ISSUER = 'https://login.microsoftonline.com/{tenantid}/v2.0';

export function jwksResponse(keys: unknown[], cacheControl: string | null = 'public, max-age=3600', status = 200, body?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'cache-control' ? cacheControl : null) },
    text: async () => body ?? JSON.stringify({ keys }),
  };
}

/** Install a fetch mock answering each JWKS URL with the given key list. */
export function serveJwks(byUrl: Record<string, unknown[]>, cacheControl: string | null = 'public, max-age=3600') {
  const fetchMock = vi.fn(async (url: string) => {
    const keys = byUrl[url];
    if (!keys) throw new Error(`unexpected fetch ${url}`);
    return jwksResponse(keys, cacheControl);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
