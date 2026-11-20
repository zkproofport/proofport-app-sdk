/**
 * A wallet credential request's scope is an OPRF name the wallet will sign and
 * the OPRF node will judge: 1-256 UTF-8 bytes, no control (Cc) or format (Cf)
 * character. It is checked where the request is created -- the deep-link
 * builder, createRelayRequest (before a challenge is spent), and the deep-link
 * validator -- so a person never signs a request the node then refuses.
 * User decision 2026-11-20.
 *
 * Matrix (drawn up before the code):
 *   length     256 ASCII / 85 Hangul (255 B) / 64 emoji accepted; 257 ASCII,
 *              86 Hangul (258 B), 65 emoji refused
 *   blank      missing, empty, " " (the SDK's own non-blank rule, stricter
 *              than the node), null, a number, an object refused
 *   Cc         tab, newline, NUL, DEL, U+0085 refused
 *   Cf         ZWSP, RLO, BOM, soft hyphen, ZWJ emoji, tag character refused
 *   UTF-16     a lone surrogate refused
 *   accepted   Korean, emoji, flags, SQL / wildcard / markup text, NBSP
 *   oprfDomain the same rules when given (257 B, RLO, empty refused)
 *   circuits   every wallet credential circuit; OIDC keeps its own rules (a
 *              5000-byte scope is still accepted for it)
 *   doors      createProofRequest, createRelayRequest (no fetch made),
 *              validateProofRequest
 *   authz/race N/A: synchronous input validation, no caller identity
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { validateProofRequest } from '../deeplink';
import { OPRF_CIRCUIT_IDS } from '../verifier';

const REFUSED: [string, unknown, RegExp][] = [
  ['257 ASCII bytes', 'a'.repeat(257), /too-long/],
  ['86 Hangul syllables (258 bytes)', '가'.repeat(86), /too-long/],
  ['65 four-byte emoji (260 bytes)', '🔐'.repeat(65), /too-long/],
  ['missing', undefined, /scope is required/],
  ['empty', '', /scope is required/],
  ['a single space', ' ', /scope is required/],
  ['null', null, /scope is required/],
  ['a number', 42, /scope is required/],
  ['an object', { host: 'myapp.com' }, /scope is required/],
  ['a tab', 'my\tapp', /control-character/],
  ['a newline', 'my\napp', /control-character/],
  ['NUL', 'my\u0000app', /control-character/],
  ['DEL', 'my\u007fapp', /control-character/],
  ['U+0085', 'my\u0085app', /control-character/],
  ['a zero-width space', 'my​app', /format-character/],
  ['a right-to-left override', 'my‮app', /format-character/],
  ['a BOM', '﻿myapp', /format-character/],
  ['a soft hyphen', 'my­app', /format-character/],
  ['a ZWJ emoji', '👩‍💻', /format-character/],
  ['a tag character', 'myapp\u{e0041}', /format-character/],
  ['a lone surrogate', 'my\ud800app', /not-utf8/],
];

const ACCEPTED: [string, string][] = [
  ['256 ASCII bytes', 'a'.repeat(256)],
  ['85 Hangul syllables (255 bytes)', '가'.repeat(85)],
  ['64 four-byte emoji (256 bytes)', '🔐'.repeat(64)],
  ['Korean and emoji', '투표 2026 🗳️'],
  ['a flag', '🇰🇷'],
  ['SQL, wildcards and markup', "%_\\' OR 1=1; <script>x</script>"],
  ['a no-break space', 'my app'],
];

/** Inputs a circuit needs besides the scope. */
const extra = (circuit: string): Record<string, unknown> =>
  circuit === 'coinbase_country_attestation' ? { countryList: ['US'], isIncluded: true }
    : circuit === 'human_passport_score' ? { minScore: 20 }
      : {};

const inputs = (circuit: string, scope: unknown, more: Record<string, unknown> = {}) =>
  ({ ...extra(circuit), oprfDomain: 'myapp.com', ...(scope === undefined ? {} : { scope }), ...more });

const sdk = () => ProofportSDK.create('staging');
const deepLink = (circuit: string, i: Record<string, unknown>) =>
  (sdk() as unknown as { createProofRequest: (c: string, i: unknown) => unknown }).createProofRequest(circuit, i);
const link = (circuit: string, i: Record<string, unknown>) => ({
  requestId: 'r1', circuit, inputs: i, callbackUrl: 'https://relay.zkproofport.app/cb', createdAt: Date.now(),
}) as never;

beforeEach(() => {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe.each(OPRF_CIRCUIT_IDS)('%s', circuit => {
  it.each(REFUSED)('refuses %s at every door', async (_label, scope, message) => {
    expect(() => deepLink(circuit, inputs(circuit, scope))).toThrow(message);
    expect(validateProofRequest(link(circuit, inputs(circuit, scope)))).toEqual({ valid: false, error: expect.stringMatching(message) });
    const s = sdk();
    s.setSigner({ signMessage: vi.fn(), getAddress: vi.fn() } as never);
    await expect(s.createRelayRequest(circuit as never, inputs(circuit, scope) as never)).rejects.toThrow(message);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(ACCEPTED)('accepts %s', (_label, scope) => {
    expect(() => deepLink(circuit, inputs(circuit, scope))).not.toThrow();
    expect(validateProofRequest(link(circuit, inputs(circuit, scope)))).toMatchObject({ valid: true });
  });

  it.each([
    ['257 bytes', 'a'.repeat(257), /oprfDomain .*too-long/],
    ['a right-to-left override', 'zk‮proofport.app', /oprfDomain .*format-character/],
    ['empty', '', /oprfDomain .*empty/],
  ])('refuses an oprfDomain that is %s', (_label, oprfDomain, message) => {
    expect(() => deepLink(circuit, inputs(circuit, 'myapp.com', { oprfDomain }))).toThrow(message);
    expect(validateProofRequest(link(circuit, inputs(circuit, 'myapp.com', { oprfDomain })))).toEqual({ valid: false, error: expect.stringMatching(message) });
  });
});

describe('OIDC keeps its own scope rules', () => {
  it('a 5000-byte scope and a tab are still accepted for oidc_domain_attestation', () => {
    for (const scope of ['x'.repeat(5000), 'a\tb']) {
      expect(() => deepLink('oidc_domain_attestation', { scope, domain: 'example.com' })).not.toThrow();
    }
  });
});
