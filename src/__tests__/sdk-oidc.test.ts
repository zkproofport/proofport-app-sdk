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

    it('has correct publicInputsCount of 420', () => {
      expect(CIRCUIT_METADATA['oidc_domain_attestation'].publicInputsCount).toBe(420);
    });

    it('has correct publicInputNames', () => {
      expect(CIRCUIT_METADATA['oidc_domain_attestation'].publicInputNames).toEqual([
        'pubkey_modulus_limbs',
        'domain',
        'scope',
        'nullifier',
      ]);
    });
  });

  describe('Public Input Layout', () => {
    it('PUBKEY_MODULUS spans fields 0–287', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PUBKEY_MODULUS_START).toBe(0);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.PUBKEY_MODULUS_END).toBe(287);
    });

    it('DOMAIN spans fields 288–355', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_START).toBe(288);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.DOMAIN_END).toBe(355);
    });

    it('SCOPE spans fields 356–387', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_START).toBe(356);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.SCOPE_END).toBe(387);
    });

    it('NULLIFIER spans fields 388–419', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_START).toBe(388);
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_END).toBe(419);
    });

    it('NULLIFIER_END is 419 (total 420 public inputs)', () => {
      expect(OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NULLIFIER_END).toBe(419);
    });
  });

  describe('CircuitType', () => {
    it("'oidc_domain_attestation' is assignable to CircuitType", () => {
      const circuit: CircuitType = 'oidc_domain_attestation';
      expect(circuit).toBe('oidc_domain_attestation');
    });
  });
});
