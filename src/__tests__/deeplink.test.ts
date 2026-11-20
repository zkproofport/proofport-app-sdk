import { describe, it, expect, vi } from 'vitest';
import { computeSignalHash } from '../verifier';
import {
  generateRequestId,
  encodeData,
  decodeData,
  buildProofRequestUrl,
  parseProofRequestUrl,
  isProofportDeepLink,
  parseDeepLink,
} from '../deeplink';
import type { ProofRequest } from '../types';

describe('Deep Link Utilities', () => {
  const testRequest: ProofRequest = {
    requestId: 'req-test-123',
    circuit: 'coinbase_attestation',
    inputs: { scope: 'test.com' },
    createdAt: 1700000000000,
  };

  describe('generateRequestId', () => {
    it('returns string starting with "req-"', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^req-/);
    });

    it('returns unique values on repeated calls', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
    });

    it('is req-{base36 timestamp}-{32 hex} and fits the signal_hash requestId rule', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^req-[0-9a-z]+-[0-9a-f]{32}$/);
      expect(() => computeSignalHash({ scope: 'app:scope', circuitId: 'coinbase_attestation', requestId: id })).not.toThrow();
    });

    it('does not repeat across many calls in the same millisecond', () => {
      const ids = new Set(Array.from({ length: 2000 }, () => generateRequestId()));
      expect(ids.size).toBe(2000);
    });

    it('takes its random part from crypto.getRandomValues, never Math.random', () => {
      const mathRandom = vi.spyOn(Math, 'random');
      const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint8Array).fill(0xab);
        return array;
      });
      try {
        expect(generateRequestId()).toMatch(/-(ab){16}$/);
        expect(getRandomValues).toHaveBeenCalledTimes(1);
        expect(mathRandom).not.toHaveBeenCalled();
      } finally {
        mathRandom.mockRestore();
        getRandomValues.mockRestore();
      }
    });

    it.each([
      ['no crypto at all', undefined],
      ['crypto without getRandomValues', {}],
    ])('throws instead of using a weaker source when the runtime has %s', (_name, value) => {
      vi.stubGlobal('crypto', value);
      try {
        expect(() => generateRequestId()).toThrow(/no Web Crypto/);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('encodeData / decodeData', () => {
    it('encodes object to base64url string (no +, /, or = chars)', () => {
      const encoded = encodeData(testRequest);
      expect(typeof encoded).toBe('string');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('decodes base64url back to object', () => {
      const encoded = encodeData(testRequest);
      const decoded = decodeData<ProofRequest>(encoded);
      expect(decoded).toEqual(testRequest);
    });

    it('roundtrip preserves complex data', () => {
      const original = {
        requestId: 'req-abc-xyz',
        circuit: 'coinbase_country_attestation' as const,
        inputs: { scope: 'example.org', countryList: ['US', 'CA'], isIncluded: true },
        createdAt: Date.now(),
      };
      const decoded = decodeData<typeof original>(encodeData(original));
      expect(decoded).toEqual(original);
    });
  });

  describe('buildProofRequestUrl', () => {
    it('creates valid deep link with default scheme', () => {
      const url = buildProofRequestUrl(testRequest);
      expect(url).toMatch(/^zkproofport:\/\/proof-request\?data=/);
    });

    it('uses custom scheme', () => {
      const url = buildProofRequestUrl(testRequest, 'myapp');
      expect(url).toMatch(/^myapp:\/\/proof-request\?data=/);
    });
  });

  describe('parseProofRequestUrl', () => {
    it('extracts ProofRequest from URL (roundtrip)', () => {
      const url = buildProofRequestUrl(testRequest);
      const parsed = parseProofRequestUrl(url);
      expect(parsed).toEqual(testRequest);
    });

    it('returns null for invalid URL', () => {
      expect(parseProofRequestUrl('https://example.com')).toBeNull();
      expect(parseProofRequestUrl('zkproofport://proof-request')).toBeNull();
    });
  });

  describe('isProofportDeepLink', () => {
    it('returns true for zkproofport:// URLs', () => {
      expect(isProofportDeepLink('zkproofport://proof-request?data=abc')).toBe(true);
    });

    it('returns false for non-zkproofport URLs', () => {
      expect(isProofportDeepLink('https://example.com')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isProofportDeepLink('ZKPROOFPORT://proof-request')).toBe(true);
      expect(isProofportDeepLink('ZkProofport://proof-request')).toBe(true);
    });
  });

  describe('parseDeepLink', () => {
    it('breaks URL into components', () => {
      const result = parseDeepLink('zkproofport://proof-request/verify?data=abc&foo=bar');
      expect(result).toEqual({
        scheme: 'zkproofport',
        host: 'proof-request',
        path: '/verify',
        params: { data: 'abc', foo: 'bar' },
      });
    });

    it('returns null for invalid URL', () => {
      expect(parseDeepLink('not-a-url')).toBeNull();
    });
  });
});
