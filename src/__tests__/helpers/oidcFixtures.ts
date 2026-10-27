/**
 * OIDC test material: real RSA-2048 keys, their JWKs, and public inputs laid
 * out the way oidc_domain_attestation v2 emits them (214 fields; the modulus
 * as eighteen 120-bit limbs, least significant first, at 0-17; scope 83-114;
 * provider 147; aud_hash 148-179; nonce_mode 180; nonce_binding 181-212;
 * now 213).
 *
 * The public inputs are built here, following the circuits reference builder
 * (oidc-domain-attestation/scripts/oidc-inputs.ts). The issuer and policy
 * checks read only these fields; the proof bytes never reach them.
 */
import { generateKeyPairSync } from 'crypto';
import { ethers } from 'ethers';
import { vi } from 'vitest';

export const GOOGLE_WEB_CLIENT = '491923400813-5bb3up7dhejns2unvbrt6mku520hrr5g.apps.googleusercontent.com';
export const GOOGLE_DEVICE_CLIENT = '491923400813-pr17m6kpin2rsbbes18jpb60j1s3qmv4.apps.googleusercontent.com';
export const MICROSOFT_CLIENT = '8b09c842-d7a8-4d9c-a6ea-46c797412bac';
export const REQUEST_ID = '0b6f1f8e-4c1a-4d55-9b1e-2a7c3d4e5f60';
export const SCOPE = 'myapp.example';

export interface OidcV2Fields {
  /** The token's `aud` string; hashed into aud_hash. Default: the device client for the provider. */
  aud?: string;
  /** Default 0. */
  nonceMode?: number;
  /** 32 bytes as hex (no 0x). Default all zero, or the request's binding in mode 1 when `request` is given. */
  binding?: string;
  /** Unix seconds. Default: the current clock. */
  now?: bigint | number;
  /** Fills scope with keccak256(scope) and, in mode 1, the binding. */
  request?: { scope: string; requestId: string };
}

export const keccakUtf8 = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s)).slice(2);

/** keccak256("zkproofport-oidc-v1" || keccak256(scope) || requestId), hex without 0x. Mirrors the app's oidcNonce.ts. */
export function bindingFor(scope: string, requestId: string): string {
  return ethers.keccak256(ethers.concat([
    ethers.toUtf8Bytes('zkproofport-oidc-v1'),
    ethers.keccak256(ethers.toUtf8Bytes(scope)),
    ethers.toUtf8Bytes(requestId),
  ])).slice(2);
}

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

const bytesOf = (hex: string) => Array.from({ length: hex.length / 2 }, (_, i) => field(BigInt('0x' + hex.slice(2 * i, 2 * i + 2))));

/**
 * 214 public inputs carrying this modulus and provider, and by default a token
 * that passes the policy: the provider's device-flow client, nonce_mode 0, a
 * zero binding, and `now` equal to the clock.
 */
export function oidcPublicInputs(n: string | bigint, provider: number | bigint = 0, v2: OidcV2Fields = {}): string[] {
  let modulus = typeof n === 'bigint' ? n : modulusOf(n);
  const inputs: string[] = [];
  for (let i = 0; i < 18; i++) {
    inputs.push(field(modulus & ((1n << 120n) - 1n)));
    modulus >>= 120n;
  }
  while (inputs.length < 83) inputs.push(field(0n));
  inputs.push(...(v2.request ? bytesOf(keccakUtf8(v2.request.scope)) : bytesOf('00'.repeat(32))));
  while (inputs.length < 147) inputs.push(field(0n));
  inputs.push(field(BigInt(provider)));
  const aud = v2.aud ?? (BigInt(provider) === 1n ? MICROSOFT_CLIENT : GOOGLE_DEVICE_CLIENT);
  inputs.push(...bytesOf(keccakUtf8(aud)));
  const mode = v2.nonceMode ?? 0;
  inputs.push(field(BigInt(mode)));
  const binding = v2.binding ?? (mode === 1 && v2.request ? bindingFor(v2.request.scope, v2.request.requestId) : '00'.repeat(32));
  inputs.push(...bytesOf(binding));
  inputs.push(field(BigInt(v2.now ?? Math.floor(Date.now() / 1000))));
  if (inputs.length !== 214) throw new Error(`fixture built ${inputs.length} inputs`);
  return inputs;
}

/** The v1 layout (148 fields): what a proof from the old circuit looks like. */
export function oidcV1PublicInputs(n: string | bigint, provider: number | bigint = 0): string[] {
  return oidcPublicInputs(n, provider).slice(0, 148);
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
