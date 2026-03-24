import { describe, it, expect } from 'vitest';
import {
  buildProofRequestUrl,
  parseProofRequestUrl,
  validateProofRequest,
} from '../deeplink';
import {
  CIRCUIT_METADATA,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
} from '../constants';
import { extractDomainFromPublicInputs } from '../verifier';
import type { CircuitType, OidcDomainInputs, ProofRequest } from '../types';

describe('OIDC Domain Attestation', () => {
  describe('Deep Link Generation', () => {
    it('generates a deep link with oidc_domain_attestation circuit', () => {
      const request: ProofRequest = {
        requestId: 'req-oidc-test-123',
        circuit: 'oidc_domain_attestation',
        inputs: { domain: 'google.com', scope: 'myapp.com' } as OidcDomainInputs,
        createdAt: 1700000000000,
      };
      const url = buildProofRequestUrl(request);
      expect(url).toMatch(/^zkproofport:\/\/proof-request\?data=/);
    });

    it('encodes OidcDomainInputs domain and scope correctly (roundtrip)', () => {
      const inputs: OidcDomainInputs = { domain: 'github.com', scope: 'dapp.example.com' };
      const request: ProofRequest = {
        requestId: 'req-oidc-roundtrip',
        circuit: 'oidc_domain_attestation',
        inputs,
        createdAt: 1700000000000,
      };
      const url = buildProofRequestUrl(request);
      const parsed = parseProofRequestUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed!.circuit).toBe('oidc_domain_attestation');
      expect((parsed!.inputs as OidcDomainInputs).domain).toBe('github.com');
      expect((parsed!.inputs as OidcDomainInputs).scope).toBe('dapp.example.com');
    });

    it('roundtrip preserves only domain and scope (no jwt)', () => {
      const inputs: OidcDomainInputs = { domain: 'company.com', scope: 'myapp.com' };
      const request: ProofRequest = {
        requestId: 'req-oidc-no-jwt',
        circuit: 'oidc_domain_attestation',
        inputs,
        createdAt: 1700000000000,
      };
      const url = buildProofRequestUrl(request);
      const parsed = parseProofRequestUrl(url);
      expect(parsed).not.toBeNull();
      const parsedInputs = parsed!.inputs as OidcDomainInputs;
      expect(parsedInputs.domain).toBe('company.com');
      expect(parsedInputs.scope).toBe('myapp.com');
    });
  });

  describe('Deep Link Validation', () => {
    const baseRequest: ProofRequest = {
      requestId: 'req-oidc-valid',
      circuit: 'oidc_domain_attestation',
      inputs: { domain: 'google.com', scope: 'myapp.com' } as OidcDomainInputs,
      callbackUrl: 'https://relay.zkproofport.app/callback',
      createdAt: 1700000000000,
    };

    it('valid request with domain and scope passes', () => {
      const result = validateProofRequest(baseRequest);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('missing domain fails with correct error', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: '', scope: 'myapp.com' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/domain/i);
    });

    it('missing scope fails with correct error', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: 'google.com', scope: '' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/scope/i);
    });

    it('empty string domain fails', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: '   ', scope: 'myapp.com' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(false);
    });

    it('empty string scope fails', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: 'google.com', scope: '   ' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(false);
    });

    it('valid request with provider passes', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: 'company.com', scope: 'myapp.com', provider: 'google' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(true);
    });

    it('empty provider string fails', () => {
      const request: ProofRequest = {
        ...baseRequest,
        inputs: { domain: 'company.com', scope: 'myapp.com', provider: '' } as OidcDomainInputs,
      };
      const result = validateProofRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/provider/i);
    });

    it('provider roundtrip preserves value', () => {
      const inputs: OidcDomainInputs = { domain: 'company.com', scope: 'myapp.com', provider: 'google' };
      const request: ProofRequest = {
        requestId: 'req-oidc-provider',
        circuit: 'oidc_domain_attestation',
        inputs,
        createdAt: 1700000000000,
      };
      const url = buildProofRequestUrl(request);
      const parsed = parseProofRequestUrl(url);
      expect(parsed).not.toBeNull();
      expect((parsed!.inputs as OidcDomainInputs).provider).toBe('google');
    });
  });

  describe('Circuit Metadata', () => {
    it('oidc_domain_attestation exists in CIRCUIT_METADATA', () => {
      expect(CIRCUIT_METADATA).toHaveProperty('oidc_domain_attestation');
    });

    it('has correct publicInputsCount of 148', () => {
      expect(CIRCUIT_METADATA['oidc_domain_attestation'].publicInputsCount).toBe(148);
    });

    it('has correct publicInputNames', () => {
      expect(CIRCUIT_METADATA['oidc_domain_attestation'].publicInputNames).toEqual([
        'pubkey_modulus_limbs',
        'domain',
        'scope',
        'nullifier',
        'provider',
      ]);
    });
  });

  describe('Public Input Layout', () => {
    it('PUBKEY_MODULUS spans fields 0–17', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PUBKEY_MODULUS_START).toBe(0);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PUBKEY_MODULUS_END).toBe(17);
    });

    it('DOMAIN storage spans fields 18–81 (len at 82)', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_STORAGE_START).toBe(18);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_STORAGE_END).toBe(81);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_LEN).toBe(82);
    });

    it('deprecated DOMAIN_START/DOMAIN_END still exist for backwards compat', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_START).toBe(18);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_END).toBe(82);
    });

    it('SCOPE spans fields 83–114', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_START).toBe(83);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_END).toBe(114);
    });

    it('NULLIFIER spans fields 115–146', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_START).toBe(115);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_END).toBe(146);
    });

    it('PROVIDER is field 147 (total 148 public inputs)', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PROVIDER).toBe(147);
    });
  });

  describe('extractDomainFromPublicInputs', () => {
    function buildMockPublicInputs(domainStr: string): string[] {
      const inputs = new Array(148).fill('0x00');
      // storage[0..63] at indices 18–81: ASCII bytes of domain
      for (let i = 0; i < domainStr.length && i < 64; i++) {
        inputs[18 + i] = '0x' + domainStr.charCodeAt(i).toString(16).padStart(2, '0');
      }
      // len at index 82
      inputs[82] = '0x' + domainStr.length.toString(16).padStart(2, '0');
      return inputs;
    }

    it('extracts domain from valid oidc_domain_attestation publicInputs', () => {
      const inputs = buildMockPublicInputs('example.com');
      const domain = extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation');
      expect(domain).toBe('example.com');
    });

    it('extracts single-char domain', () => {
      const inputs = buildMockPublicInputs('x');
      const domain = extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation');
      expect(domain).toBe('x');
    });

    it('extracts max-length domain (64 chars)', () => {
      const longDomain = 'a'.repeat(64);
      const inputs = buildMockPublicInputs(longDomain);
      const domain = extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation');
      expect(domain).toBe(longDomain);
    });

    it('returns null for non-oidc circuit', () => {
      const inputs = buildMockPublicInputs('example.com');
      expect(extractDomainFromPublicInputs(inputs, 'coinbase_attestation')).toBeNull();
      expect(extractDomainFromPublicInputs(inputs, 'coinbase_country_attestation')).toBeNull();
    });

    it('returns null when circuit is undefined', () => {
      const inputs = buildMockPublicInputs('example.com');
      expect(extractDomainFromPublicInputs(inputs)).toBeNull();
    });

    it('returns null for too-short publicInputs', () => {
      const inputs = new Array(10).fill('0x00');
      expect(extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation')).toBeNull();
    });

    it('returns null when publicInputs length equals DOMAIN_LEN index (off by one)', () => {
      // length 82 means index 82 is out of bounds
      const inputs = new Array(82).fill('0x00');
      expect(extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation')).toBeNull();
    });

    it('returns null when domain len is 0', () => {
      const inputs = new Array(148).fill('0x00');
      // len at index 82 = 0
      inputs[82] = '0x00';
      expect(extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation')).toBeNull();
    });

    it('returns null when domain len exceeds 64', () => {
      const inputs = new Array(148).fill('0x00');
      inputs[82] = '0x41'; // 65 > 64
      expect(extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation')).toBeNull();
    });

    it('uses domain len at index 82 (not null terminator) to determine length', () => {
      const inputs = new Array(148).fill('0x00');
      // Put "hi" at storage indices 18, 19 then leave zeros at 20+
      inputs[18] = '0x' + 'h'.charCodeAt(0).toString(16);
      inputs[19] = '0x' + 'i'.charCodeAt(0).toString(16);
      // Set len=2 at index 82 — only first 2 bytes should be read
      inputs[82] = '0x02';
      const domain = extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation');
      expect(domain).toBe('hi');
    });

    it('ignores storage bytes beyond the len value', () => {
      const inputs = buildMockPublicInputs('example.com');
      // Put extra garbage after the domain in storage
      inputs[18 + 11] = '0x58'; // 'X' at position after "example.com"
      inputs[18 + 12] = '0x59'; // 'Y'
      // len is still 11 so those should be ignored
      const domain = extractDomainFromPublicInputs(inputs, 'oidc_domain_attestation');
      expect(domain).toBe('example.com');
    });
  });

  describe('CircuitType', () => {
    it("'oidc_domain_attestation' is assignable to CircuitType", () => {
      const circuit: CircuitType = 'oidc_domain_attestation';
      expect(circuit).toBe('oidc_domain_attestation');
    });
  });
});
