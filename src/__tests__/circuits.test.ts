/**
 * Drift guards for the canonical circuit identifier list.
 *
 * These tests exist so that adding, renaming or removing a circuit anywhere in
 * the SDK fails here first. The canonical names are the `name` field of each
 * circuit's Nargo.toml and are duplicated below on purpose: if the SDK list and
 * this list disagree, one of them changed without the other.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_IDS,
  CIRCUIT_SUPPORT_STATUS,
  PLANNED_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  getCircuitSupportStatus,
  isCircuitId,
  isSupportedCircuitId,
} from '../circuits';
import type { CircuitId, CircuitSupportStatus } from '../circuits';
import { CIRCUIT_METADATA } from '../constants';
import { ProofportSDK } from '../ProofportSDK';

/** Canonical `name` values from circuits/<dir>/Nargo.toml, in declaration order. */
const NARGO_CIRCUIT_NAMES = [
  'coinbase_attestation',
  'coinbase_country_attestation',
  'oidc_domain_attestation',
  'giwa_attestation',
  'mdl_kr_ownership',
  'mdl_kr_age',
  'mdl_kr_region',
];

/** Hyphenated route / directory names from other repos. Never circuit IDs. */
const FORBIDDEN_ALIASES = [
  'coinbase-kyc',
  'coinbase-country',
  'coinbase_kyc',
  'CoinbaseKyc',
  'giwa-kyc',
  'mdl-kr-ownership',
  'mdl-kr-age',
  'mdl-kr-region',
  'oidc-domain-attestation',
];

describe('canonical circuit identifiers', () => {
  it('matches the Nargo.toml names exactly, in order', () => {
    expect([...ALL_CIRCUIT_IDS]).toEqual(NARGO_CIRCUIT_NAMES);
  });

  it('exposes every identifier as a named constant on CIRCUIT_IDS', () => {
    expect(Object.values(CIRCUIT_IDS).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it('gives every constant a distinct name', () => {
    const values = Object.values(CIRCUIT_IDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('includes giwa_attestation, which the type union used to be missing', () => {
    expect(CIRCUIT_IDS.GIWA_ATTESTATION).toBe('giwa_attestation');
    expect(ALL_CIRCUIT_IDS).toContain('giwa_attestation');
  });

  it('contains no hyphen in any identifier', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      expect(id, `circuit id '${id}' must not contain a hyphen`).not.toContain('-');
    }
  });

  it('uses lowercase snake_case throughout', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it('rejects the hyphenated route names used elsewhere', () => {
    for (const alias of FORBIDDEN_ALIASES) {
      expect(isCircuitId(alias), `'${alias}' must not be a circuit id`).toBe(false);
      expect(ALL_CIRCUIT_IDS as readonly string[]).not.toContain(alias);
    }
  });

  it('freezes the exported constants', () => {
    expect(Object.isFrozen(CIRCUIT_IDS)).toBe(true);
    expect(Object.isFrozen(CIRCUIT_SUPPORT_STATUS)).toBe(true);
    expect(Object.isFrozen(ALL_CIRCUIT_IDS)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_CIRCUIT_IDS)).toBe(true);
    expect(Object.isFrozen(PLANNED_CIRCUIT_IDS)).toBe(true);
  });
});

describe('circuit support status', () => {
  it('assigns a status to every identifier, and to nothing else', () => {
    expect(Object.keys(CIRCUIT_SUPPORT_STATUS).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it('only uses the two declared status values', () => {
    const allowed: CircuitSupportStatus[] = ['supported', 'planned'];
    for (const id of ALL_CIRCUIT_IDS) {
      expect(allowed).toContain(CIRCUIT_SUPPORT_STATUS[id]);
    }
  });

  it('officially supports Coinbase (both) and OIDC only', () => {
    expect([...SUPPORTED_CIRCUIT_IDS]).toEqual([
      'coinbase_attestation',
      'coinbase_country_attestation',
      'oidc_domain_attestation',
    ]);
  });

  it('marks GIWA and the three mDL circuits as planned', () => {
    expect([...PLANNED_CIRCUIT_IDS]).toEqual([
      'giwa_attestation',
      'mdl_kr_ownership',
      'mdl_kr_age',
      'mdl_kr_region',
    ]);
  });

  it('partitions every circuit into exactly one of the two buckets', () => {
    const union = [...SUPPORTED_CIRCUIT_IDS, ...PLANNED_CIRCUIT_IDS];
    expect(union.sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
    expect(new Set(union).size).toBe(ALL_CIRCUIT_IDS.length);
  });

  it('getCircuitSupportStatus() agrees with the record', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      expect(getCircuitSupportStatus(id)).toBe(CIRCUIT_SUPPORT_STATUS[id]);
    }
  });

  it('getCircuitSupportStatus() throws on an unknown identifier', () => {
    expect(() => getCircuitSupportStatus('coinbase-kyc' as CircuitId)).toThrow(
      /Unknown circuit 'coinbase-kyc'/
    );
  });

  it('isSupportedCircuitId() is true only for officially supported circuits', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      expect(isSupportedCircuitId(id)).toBe(CIRCUIT_SUPPORT_STATUS[id] === 'supported');
    }
  });

  it('isCircuitId() rejects non-string values', () => {
    for (const value of [undefined, null, 0, {}, [], true]) {
      expect(isCircuitId(value)).toBe(false);
    }
  });
});

describe('the rest of the SDK reads from the same list', () => {
  it('CIRCUIT_METADATA has one entry per circuit, in the same order', () => {
    expect(Object.keys(CIRCUIT_METADATA)).toEqual([...ALL_CIRCUIT_IDS]);
  });

  it('getSupportedCircuits() returns the canonical list', () => {
    const sdk = new ProofportSDK();
    expect(sdk.getSupportedCircuits()).toEqual([...ALL_CIRCUIT_IDS]);
  });

  it('every circuit has metadata with a name and a description', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      const metadata = CIRCUIT_METADATA[id];
      expect(metadata, `missing CIRCUIT_METADATA for '${id}'`).toBeDefined();
      expect(metadata.name.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.publicInputsCount).toBeGreaterThan(0);
    }
  });
});

describe('the circuits module stays dependency-free', () => {
  const source = readFileSync(join(__dirname, '..', 'circuits.ts'), 'utf8');

  it('has no import statements', () => {
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line));
    expect(importLines).toEqual([]);
  });

  it('has no require() calls', () => {
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
