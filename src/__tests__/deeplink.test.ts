import { describe, it, expect } from 'vitest';
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
