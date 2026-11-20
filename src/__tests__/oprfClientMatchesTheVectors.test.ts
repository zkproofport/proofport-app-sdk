/**
 * Core's OPRF client (packages/core/src/oprf/) against implementations that
 * are not core's: TACEO's crates (circuits' oprf-fixture), the OPRF node's own
 * name rules and digest (proofport-oprf src/auth.rs), oprf-nr's known-answer
 * tests, and one answer from TACEO's public test network. All of them are in
 * fixtures/oprf-vectors.json, written by scripts/generate-oprf-vectors.mjs.
 *
 * Matrix (drawn up before the code):
 *   primitives   keccak256 = ethers' on lengths 0..300 (rate boundary 135-137)
 *                and on Korean/emoji UTF-8; Poseidon2 / encode_to_curve = oprf-nr KATs
 *   evaluations  13 Rust evaluations byte for byte: query, A, key hash, DLog
 *                proof verifies, P = B / beta, nullifier, finalizeOprf whole;
 *                two blindings -> one nullifier; another key -> another key hash
 *                and nullifier; domain/scope swapped -> another nullifier
 *   boundaries   domain 0 and p - 1, scope 0 and p - 1, address 0x00..00 and
 *                0xff..ff, beta 1 and r - 1, key r - 1 (all in the vectors)
 *   overflow     domain / scope / query = p, 2^256, negative, non-hex, number
 *                not safe, null refused; beta 0, r, r + 1 refused; s = r refused
 *   names        every node verdict (empty, 256/257 bytes in ASCII, Hangul and
 *                emoji, Cc incl. tab / newline / DEL / C1, Cf incl. ZWJ emoji,
 *                RLO, ZWSP, BOM, soft hyphen, tags); JS-only: NUL, lone high and
 *                low surrogates; not a string: null, undefined, number, object;
 *                " " accepted (not Cc/Cf; the node does not trim); NFC vs NFD
 *                two names; the Cf table = this runtime's \p{Cf}
 *   request      digests = the node's and ethers' TypedDataEncoder; typed data
 *                and the eth_signTypedData_v4 JSON hash to the same digest;
 *                deadline now / now + 600 accepted, now - 1 / now + 601 /
 *                fractional / negative / string refused
 *   points       off curve, the identity, (0, 0), the order-2 point (0, -1),
 *                an 8-torsion-free-but-not-subgroup point, coordinates >= p:
 *                refused for D, A, B, P
 *   DLog proof   e + 1, s + 1, e and s swapped, another key's proof, a proof
 *                for another query, D replaced by another key: false
 *   pin          finalizeOprf with the right expected key hash accepts; with
 *                another refuses before anything else; the network answer is
 *                under TACEO's test key and core's staging pin is its hash
 *   address      lower case, upper case, valid EIP-55 accepted; a broken
 *                checksum, 19/21 bytes, no 0x, non-hex refused
 *   random       randomOprfBeta: non-zero, below r, two calls differ; no Web
 *                Crypto -> throws (never a weaker source)
 *   authz/race   N/A: pure functions, no caller identity, no I/O
 */
import { describe, it, expect, vi } from 'vitest';
import vectors from './fixtures/oprf-vectors.json';
import * as oprf from '../../packages/core/src/oprf';
import { encodeToCurve, isInSubgroup, isOnCurve, add, GENERATOR, scalarMul } from '../../packages/core/src/oprf/babyjubjub';
import { P, R } from '../../packages/core/src/oprf/field';
import { TACEO_TESTNET_OPRF_KEY_HASH, TACEO_TESTNET_OPRF_PUBLIC_KEY, getPinnedOprfKeyHash } from '../../packages/core/src/oprfKeys';

const { ethers } = await vi.importActual<typeof import('ethers')>('ethers');
const hex = (v: bigint) => '0x' + v.toString(16).padStart(64, '0');
const dec = (s: string) => BigInt(s);
const pt = (p: { x: string; y: string }) => ({ x: dec(p.x), y: dec(p.y) });

describe('primitives', () => {
  it('keccak256 equals ethers on every length across the 136-byte rate', () => {
    for (let n = 0; n <= 300; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 131 + n) & 0xff);
      expect(ethers.hexlify(oprf.oprfKeccak256(data))).toBe(ethers.keccak256(data));
    }
  });

  it.each(vectors.kats.encodeToCurve)('encode_to_curve: $test', k => {
    const p = encodeToCurve(BigInt(k.input));
    expect([p.x.toString(), p.y.toString()]).toEqual([k.x, k.y]);
    expect(isInSubgroup(p)).toBe(true);
  });

  it('blinded query: oprf-nr oprf_query_kat_test', () => {
    const k = vectors.kats.blindedQuery;
    expect(oprf.blindOprfQuery(k.query, k.beta)).toEqual({ x: hex(dec(k.x)), y: hex(dec(k.y)) });
  });

  it('Chaum-Pedersen: oprf-nr test_verify_dlog_equality', () => {
    const k = vectors.kats.dlog;
    expect(oprf.verifyOprfDlogEquality({ publicKey: k.publicKey, blindedQuery: k.blindedQuery, blindedResponse: k.blindedResponse, e: k.e, s: k.s })).toBe(true);
  });

  it('output: oprf-nr verified_oprf_kat_test (its own DS_out)', () => {
    const k = vectors.kats.verifiedOprf;
    const out = oprf.poseidon2T4([dec(k.dsOut), dec(k.query), dec(k.response.x), dec(k.response.y)])[1];
    expect(out.toString()).toBe(k.output);
  });

  it('the domain separators are their ASCII strings', () => {
    expect(oprf.OPRF_DS_QUERY).toBe(8873080049130461605566892302184544221631163997938119966801040601721n);
    expect(oprf.OPRF_DS_OUT).toBe(135392456804358850182600285372688968225573181120881957501105524n);
    expect(oprf.OPRF_DS_KEY).toBe(7339639790271784127253828559220533810128249n);
    expect(oprf.OPRF_DS_DLOG).toBe(1523098184080632582082867317389990410064981862n);
    expect(oprf.OPRF_FIELD_MODULUS).toBe(dec(vectors.constants.p));
    expect(oprf.OPRF_SCALAR_ORDER).toBe(dec(vectors.constants.r));
  });
});

describe.each(vectors.evaluations.map(e => [e.note, e] as const))('evaluation: %s', (_note, e) => {
  it('query, blinded point and key hash', () => {
    expect(oprf.oprfQuery({ address: e.address, domain: e.domain, scope: e.scope })).toBe(e.query);
    expect(oprf.blindOprfQuery(e.query, e.beta)).toEqual(e.blindedQuery);
    expect(oprf.oprfKeyHash(e.publicKey)).toBe(e.keyHash);
    expect(hex(scalarMul(GENERATOR, dec(e.secretKey)).x)).toBe(e.publicKey.x);
  });

  it('the nodes\' proof verifies, unblinding gives P, P gives the nullifier', () => {
    expect(oprf.verifyOprfDlogEquality({ publicKey: e.publicKey, blindedQuery: e.blindedQuery, blindedResponse: e.blindedResponse, e: e.dlogE, s: e.dlogS })).toBe(true);
    expect(oprf.unblindOprfResponse(e.blindedResponse, e.beta)).toEqual(e.response);
    expect(oprf.oprfNullifier(e.query, e.response)).toBe(e.nullifier);
  });

  it('finalizeOprf gives the circuit exactly these inputs', () => {
    expect(oprf.finalizeOprf({
      address: e.address, domain: e.domain, scope: e.scope, beta: e.beta, publicKey: e.publicKey,
      blindedResponse: e.blindedResponse, dlogE: e.dlogE, dlogS: e.dlogS, expectedKeyHash: e.keyHash,
    })).toEqual({
      oprf_key_hash: e.keyHash, domain: e.domain, scope: e.scope, nullifier: e.nullifier,
      oprf_public_key_x: e.publicKey.x, oprf_public_key_y: e.publicKey.y, oprf_beta: e.beta,
      oprf_dlog_e: e.dlogE, oprf_dlog_s: e.dlogS, oprf_response_x: e.response.x, oprf_response_y: e.response.y,
    });
  });
});

describe('what the evaluations show together', () => {
  const [honest, otherKey, swapped, otherBlinding] = vectors.evaluations;
  it('another blinding, one nullifier; another key, another hash and nullifier; swapped, another nullifier', () => {
    expect(otherBlinding.nullifier).toBe(honest.nullifier);
    expect(otherBlinding.blindedQuery).not.toEqual(honest.blindedQuery);
    expect(otherKey.keyHash).not.toBe(honest.keyHash);
    expect(otherKey.nullifier).not.toBe(honest.nullifier);
    expect(swapped.nullifier).not.toBe(honest.nullifier);
  });
});

describe('TACEO public test network', () => {
  const n = vectors.network;
  it('its answer verifies and gives its nullifier, under the key core pins for staging', () => {
    const inputs = oprf.finalizeOprf({
      address: '0x' + n.addressField.slice(-40), domain: n.domain, scope: n.scope, beta: n.beta, publicKey: n.publicKey,
      blindedResponse: n.blindedResponse, dlogE: n.dlogE, dlogS: n.dlogS, expectedKeyHash: getPinnedOprfKeyHash('staging', 'coinbase_attestation'),
    });
    expect(inputs.nullifier).toBe(n.nullifier);
    expect({ x: inputs.oprf_response_x, y: inputs.oprf_response_y }).toEqual(n.response);
    expect(oprf.reduceOprfName(n.domainName)).toBe(n.domain);
    expect(oprf.reduceOprfName(n.scopeName)).toBe(n.scope);
  });

  it('the pinned hash is the hash of the recorded public key', () => {
    expect(n.publicKey).toEqual(TACEO_TESTNET_OPRF_PUBLIC_KEY);
    expect(oprf.oprfKeyHash(TACEO_TESTNET_OPRF_PUBLIC_KEY)).toBe(TACEO_TESTNET_OPRF_KEY_HASH);
    expect(n.keyHash).toBe(TACEO_TESTNET_OPRF_KEY_HASH);
  });

  it('refuses the same answer against another pinned key, before checking anything else', () => {
    expect(() => oprf.finalizeOprf({
      address: '0x' + n.addressField.slice(-40), domain: n.domain, scope: n.scope, beta: n.beta, publicKey: n.publicKey,
      blindedResponse: n.blindedResponse, dlogE: n.dlogE, dlogS: n.dlogS, expectedKeyHash: vectors.evaluations[0].keyHash,
    })).toThrow(/is under key hash 0x039ecd4e.*not the pinned 0x013f6250/);
  });
});

describe('names', () => {
  it.each(vectors.names.map(v => [v.note, v] as const))('the node\'s verdict: %s', (_note, v) => {
    expect(oprf.oprfNameError(v.name)).toBe(v.verdict);
    if (v.verdict === null) {
      expect(oprf.reduceOprfName(v.name)).toBe(v.reduced);
      expect(oprf.reduceOprfName(v.name)).toBe(hex(BigInt(ethers.keccak256(ethers.toUtf8Bytes(v.name))) % P));
    } else {
      expect(() => oprf.reduceOprfName(v.name)).toThrow(v.verdict);
    }
  });

  it.each(vectors.jsOnlyNames.map(v => [v.note, v] as const))('the rule where the node cannot be asked: %s', (_note, v) => {
    expect(oprf.oprfNameError(v.name)).toBe(v.verdict);
  });

  it.each([[null], [undefined], [42], [{}], [['a']]])('not a string (%j) is refused', value => {
    expect(oprf.oprfNameError(value)).toBe('not-a-string');
    expect(() => oprf.reduceOprfName(value as never)).toThrow('not-a-string');
  });

  it('empty, a space and a tab are three different verdicts', () => {
    expect(oprf.oprfNameError('')).toBe('empty');
    expect(oprf.oprfNameError(' ')).toBeNull();
    expect(oprf.oprfNameError('\t')).toBe('control-character');
  });

  it('the reduction matters: keccak256("zkproofport.app") is at or above p', () => {
    const raw = BigInt(ethers.keccak256(ethers.toUtf8Bytes('zkproofport.app')));
    expect(raw >= P).toBe(true);
    expect(oprf.reduceOprfName("zkproofport.app")).toBe(hex(raw % P));
    expect(oprf.reduceOprfName("zkproofport.app")).not.toBe(hex(raw));
  });

  it('the format-character table is this runtime\'s \\p{Cf}', () => {
    const cf: [number, number][] = [];
    for (let c = 0, start = -1; c <= 0x110000; c++) {
      const is = c < 0x110000 && (c < 0xd800 || c > 0xdfff) && /\p{Cf}/u.test(String.fromCodePoint(c));
      if (is && start < 0) start = c;
      if (!is && start >= 0) { cf.push([start, c - 1]); start = -1; }
    }
    expect(oprf.OPRF_FORMAT_CHARACTERS.map(r => [...r])).toEqual(cf);
  });
});

describe('the request the wallet signs', () => {
  const NOW = 1_800_000_000;
  it.each(vectors.digests.map(d => [d.domainName.slice(0, 20), d] as const))('digest equals the node\'s: %s', (_n, d) => {
    expect(oprf.oprfRequestDigest(d.domainName, d.scopeName, d.deadline)).toBe(d.digest);
  });

  it('typed data and the v4 JSON hash to the digest the node computes', () => {
    const typed = oprf.oprfRequestTypedData({ domainName: 'zkproofport.app', scopeName: 'vote 투표 🗳️', deadline: NOW + 600, nowSeconds: NOW });
    const viaEthers = ethers.TypedDataEncoder.hash(typed.domain, { OprfRequest: [...typed.types.OprfRequest] }, typed.message);
    expect(viaEthers).toBe(oprf.oprfRequestDigest('zkproofport.app', 'vote 투표 🗳️', NOW + 600));
    const v4 = JSON.parse(oprf.oprfRequestEip712Json(typed));
    const { EIP712Domain: _d, ...types } = v4.types;
    expect(ethers.TypedDataEncoder.hash(v4.domain, types, v4.message)).toBe(viaEthers);
    expect(v4.domain).toEqual({ name: 'TACEO:OPRF', version: '1' });
    expect(v4.message.statement).toBe('TACEO:OPRF Request');
  });

  it.each([
    ['now', NOW, null],
    ['now + 600', NOW + 600, null],
    ['now - 1 (passed)', NOW - 1, /has passed/],
    ['now + 601 (too far ahead)', NOW + 601, /more than 600 s ahead/],
    ['fractional', NOW + 0.5, /non-negative integer/],
    ['negative', -1, /non-negative integer/],
    ['a string', String(NOW), /non-negative integer/],
  ])('deadline %s', (_label, deadline, refused) => {
    const err = oprf.oprfDeadlineError(deadline, NOW);
    if (refused === null) expect(err).toBeNull();
    else expect(err).toMatch(refused);
    const make = () => oprf.oprfRequestTypedData({ domainName: 'a', scopeName: 'b', deadline: deadline as number, nowSeconds: NOW });
    if (refused === null) expect(make).not.toThrow();
    else expect(make).toThrow(refused);
  });

  it('refuses names the node refuses before the wallet sees them', () => {
    expect(() => oprf.oprfRequestTypedData({ domainName: 'a'.repeat(257), scopeName: 'b', deadline: NOW, nowSeconds: NOW })).toThrow(/domainName .*too-long/);
    expect(() => oprf.oprfRequestTypedData({ domainName: 'a', scopeName: 'a‮b', deadline: NOW, nowSeconds: NOW })).toThrow(/scopeName .*format-character/);
    expect(() => oprf.oprfRequestDigest('a\u0000', 'b', NOW)).toThrow(/control-character/);
  });
});

describe('field values are never reduced', () => {
  const e = vectors.evaluations[0];
  it.each([
    ['p', hex(P)],
    ['p + 1', hex(P + 1n)],
    ['2^256', '0x1' + '0'.repeat(64)],
    ['negative', -1n],
    ['non-hex', '0xzz'],
    ['an unsafe number', 2 ** 60],
    ['null', null],
    ['an empty string', ''],
  ])('domain / scope / query = %s refused', (_label, value) => {
    expect(() => oprf.oprfQuery({ address: e.address, domain: value as never, scope: e.scope })).toThrow();
    expect(() => oprf.oprfQuery({ address: e.address, domain: e.domain, scope: value as never })).toThrow();
    expect(() => oprf.blindOprfQuery(value as never, e.beta)).toThrow();
    expect(() => oprf.oprfNullifier(value as never, e.response)).toThrow();
  });

  it('p - 1 and 0 are field elements', () => {
    expect(() => oprf.oprfQuery({ address: e.address, domain: hex(P - 1n), scope: 0n })).not.toThrow();
  });

  it.each([['0', 0n], ['r', R], ['r + 1', R + 1n], ['p', P]])('beta = %s refused', (_label, beta) => {
    expect(() => oprf.blindOprfQuery(e.query, beta)).toThrow(/beta/);
    expect(() => oprf.unblindOprfResponse(e.blindedResponse, beta)).toThrow(/beta/);
  });

  it('s = r (the same scalar, another encoding) is refused', () => {
    const sPlusR = BigInt(e.dlogS) + R;
    expect(() => oprf.verifyOprfDlogEquality({ publicKey: e.publicKey, blindedQuery: e.blindedQuery, blindedResponse: e.blindedResponse, e: e.dlogE, s: sPlusR })).toThrow(/s .*not below the modulus/);
  });
});

describe('points', () => {
  const e = vectors.evaluations[0];
  const good = pt(e.blindedResponse);
  // (0, p - 1) has order 2; G + (0, p - 1) is on the curve and outside the subgroup.
  const order2 = { x: 0n, y: P - 1n };
  const notInSubgroup = add(GENERATOR, order2);
  const cases: [string, { x: bigint; y: bigint }, RegExp][] = [
    ['off the curve', { x: good.x, y: (good.y + 1n) % P }, /prime-order subgroup/],
    ['the identity', { x: 0n, y: 1n }, /is the identity/],
    ['(0, 0)', { x: 0n, y: 0n }, /prime-order subgroup/],
    ['the order-2 point', order2, /prime-order subgroup/],
    ['on the curve, outside the subgroup', notInSubgroup, /prime-order subgroup/],
    ['x = p', { x: P, y: good.y }, /not below the modulus/],
  ];

  it('the outside-the-subgroup point really is on the curve', () => {
    expect(isOnCurve(notInSubgroup)).toBe(true);
    expect(isInSubgroup(notInSubgroup)).toBe(false);
  });

  it.each(cases)('refused as the public key, the blinded query, the answer and P: %s', (_label, bad, message) => {
    const args = { publicKey: e.publicKey, blindedQuery: e.blindedQuery, blindedResponse: e.blindedResponse, e: e.dlogE, s: e.dlogS };
    expect(() => oprf.verifyOprfDlogEquality({ ...args, publicKey: bad })).toThrow(message);
    expect(() => oprf.verifyOprfDlogEquality({ ...args, blindedQuery: bad })).toThrow(message);
    expect(() => oprf.verifyOprfDlogEquality({ ...args, blindedResponse: bad })).toThrow(message);
    expect(() => oprf.oprfKeyHash(bad)).toThrow(message);
    expect(() => oprf.oprfNullifier(e.query, bad)).toThrow(message);
    expect(() => oprf.unblindOprfResponse(bad, e.beta)).toThrow(message);
  });
});

describe('the nodes\' proof is checked, not trusted', () => {
  const [e, other] = vectors.evaluations;
  const args = { publicKey: e.publicKey, blindedQuery: e.blindedQuery, blindedResponse: e.blindedResponse, e: e.dlogE, s: e.dlogS };
  it.each([
    ['e + 1', { e: hex(BigInt(e.dlogE) + 1n) }],
    ['s + 1', { s: hex(BigInt(e.dlogS) + 1n) }],
    ['e and s swapped', { e: e.dlogS, s: hex(BigInt(e.dlogE) % R) }],
    ['another key\'s proof over its own answer, under this key', { blindedResponse: other.blindedResponse, e: other.dlogE, s: other.dlogS }],
    ['another key under this answer', { publicKey: other.publicKey }],
    ['this proof for another query', { blindedQuery: vectors.evaluations[2].blindedQuery }],
  ])('%s: does not verify', (_label, change) => {
    expect(oprf.verifyOprfDlogEquality({ ...args, ...change })).toBe(false);
  });

  it('finalizeOprf refuses a tampered proof and a nullifier from another key', () => {
    const base = { address: e.address, domain: e.domain, scope: e.scope, beta: e.beta, publicKey: e.publicKey, blindedResponse: e.blindedResponse, dlogE: e.dlogE, dlogS: e.dlogS };
    expect(() => oprf.finalizeOprf({ ...base, dlogE: hex(BigInt(e.dlogE) + 1n) })).toThrow(/does not verify/);
    expect(() => oprf.finalizeOprf({ ...base, publicKey: other.publicKey })).toThrow(/does not verify/);
    expect(() => oprf.finalizeOprf({ ...base, beta: hex(BigInt(e.beta) + 1n) })).toThrow(/does not verify/);
    expect(() => oprf.finalizeOprf({ ...base, address: other.address === e.address ? '0x' + 'ab'.repeat(20) : other.address })).toThrow(/does not verify/);
  });
});

describe('addresses', () => {
  it.each([
    ['lower case', '0xd6c714247037e5201b7e3dec97a3ab59a9d2f739'],
    ['upper case', '0xD6C714247037E5201B7E3DEC97A3AB59A9D2F739'],
    ['EIP-55', '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739'],
  ])('%s is the same address', (_label, address) => {
    expect(oprf.oprfAddressField(address)).toBe(0xd6c714247037e5201b7e3dec97a3ab59a9d2f739n);
  });

  it.each([
    // The EIP-55 form above with one letter's case flipped (E -> e).
    ['a broken checksum', '0xD6C714247037E5201B7e3deC97a3ab59a9d2F739'],
    ['19 bytes', '0x' + 'ab'.repeat(19)],
    ['21 bytes', '0x' + 'ab'.repeat(21)],
    ['no 0x', 'ab'.repeat(20)],
    ['non-hex', '0x' + 'zz'.repeat(20)],
  ])('%s is refused', (_label, address) => {
    expect(() => oprf.oprfAddressField(address)).toThrow();
  });
});

describe('randomOprfBeta', () => {
  it('is a non-zero scalar below r, fresh each call', () => {
    const a = BigInt(oprf.randomOprfBeta());
    const b = BigInt(oprf.randomOprfBeta());
    for (const v of [a, b]) {
      expect(v > 0n).toBe(true);
      expect(v < R).toBe(true);
    }
    expect(a).not.toBe(b);
  });

  it('throws without Web Crypto rather than using a weaker source', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => oprf.randomOprfBeta()).toThrow(/secure random source/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
