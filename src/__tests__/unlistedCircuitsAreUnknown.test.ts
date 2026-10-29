/**
 * The three `mdl_kr_*` ids belong to a separate product and are not circuits
 * of this SDK. Each must be refused as an UNKNOWN id on every lookup, with an
 * error that names it and lists the known ids -- never resolved to another
 * circuit's status, offsets, verifier, chain or request builder.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_IDS,
  CIRCUIT_ISSUER_CHECKS,
  CIRCUIT_NEEDS_WALLET_SIGNATURE,
  CIRCUIT_PACKAGES,
  CIRCUIT_SUPPORT_STATUS,
  CIRCUIT_VK_PATHS,
  checkProofIssuer,
  circuitActionBinding,
  extractNullifierFromPublicInputs,
  extractScopeFromPublicInputs,
  getCircuitPackage,
  getCircuitSupportStatus,
  getPinnedVerifier,
  isCircuitId,
  isSupportedCircuitId,
  PINNED_VERIFIERS,
  resolveSignerVariant,
  signerVariantsOf,
  verifyProofOnChain,
} from '../verifier';
import type { CircuitId } from '../circuits';
import { CIRCUIT_METADATA, VERIFICATION_CHAINS } from '../constants';
import { parseProofResponseUrl, validateProofRequest } from '../deeplink';
import { verifyProofOffChain } from '../offChainVerifier';
import { ProofportSDK } from '../ProofportSDK';

const IDS = ['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'] as const;
const KNOWN = ALL_CIRCUIT_IDS.join(', ');
const field = (v: number) => '0x' + v.toString(16).padStart(64, '0');
const inputs66 = Array.from({ length: 66 }, (_, i) => field(i));

describe.each(IDS)('%s is an unknown circuit id', id => {
  it('is not a circuit id and has no row in any table', () => {
    expect(isCircuitId(id)).toBe(false);
    expect(isSupportedCircuitId(id)).toBe(false);
    expect((ALL_CIRCUIT_IDS as readonly string[]).includes(id)).toBe(false);
    expect(Object.values(CIRCUIT_IDS)).not.toContain(id);
    for (const table of [
      CIRCUIT_SUPPORT_STATUS,
      CIRCUIT_PACKAGES,
      CIRCUIT_VK_PATHS,
      CIRCUIT_ISSUER_CHECKS,
      CIRCUIT_NEEDS_WALLET_SIGNATURE,
      PINNED_VERIFIERS,
      CIRCUIT_METADATA,
      VERIFICATION_CHAINS.production,
      VERIFICATION_CHAINS.staging,
      VERIFICATION_CHAINS.local,
    ]) {
      expect(Object.prototype.hasOwnProperty.call(table, id)).toBe(false);
    }
  });

  it('every circuit lookup throws naming it and the known ids', () => {
    expect(() => getCircuitSupportStatus(id as CircuitId)).toThrow(`Unknown circuit '${id}'. Expected one of: ${KNOWN}`);
    expect(() => circuitActionBinding(id)).toThrow(`Unknown circuit '${id}'. Expected: ${KNOWN}`);
    expect(() => signerVariantsOf(id)).toThrow(`Unknown circuit '${id}'. Known: ${KNOWN}.`);
    expect(() => getCircuitPackage(id, 'standard')).toThrow(`Unknown circuit '${id}'`);
    expect(() => getPinnedVerifier(id, 84532)).toThrow(`Unknown circuit '${id}'. Known: ${KNOWN}.`);
    expect(resolveSignerVariant(id, undefined, '0x00')).toEqual({ error: `Unknown circuit '${id}'. Known: ${KNOWN}.` });
  });

  it('extractScope / extractNullifier throw instead of reading another layout', () => {
    expect(() => extractScopeFromPublicInputs(inputs66, id)).toThrow(`Unknown circuit '${id}'. Expected one of: ${KNOWN}`);
    expect(() => extractNullifierFromPublicInputs(inputs66, id)).toThrow(`Unknown circuit '${id}'. Expected one of: ${KNOWN}`);
  });

  it('the issuer check and both verify paths refuse it by name', async () => {
    const unknown = `Unknown circuit '${id}'. Known: ${KNOWN}.`;
    expect(await checkProofIssuer(id, inputs66)).toEqual({ ok: false, error: unknown });
    expect(await verifyProofOnChain(id as CircuitId, { proof: '0x1234', publicInputs: inputs66 } as never, undefined, { chainId: 84532 }))
      .toEqual({ valid: false, error: unknown });
    expect(await verifyProofOffChain(id as CircuitId, '0x1234', inputs66)).toEqual({ valid: false, error: unknown });

    const sdk = ProofportSDK.create('staging');
    const response = { requestId: 'req-1', circuit: id as CircuitId, status: 'completed' as const, proof: '0x1234', publicInputs: inputs66 };
    expect(await sdk.verifyResponseOnChain(response)).toEqual({ valid: false, error: unknown });
    expect(await sdk.verifyResponseOffChain(response)).toEqual({ valid: false, error: unknown });
  });

  it('a request for it is refused, and a callback naming it does not parse', async () => {
    const sdk = ProofportSDK.create('staging') as any;
    expect(() => sdk.createProofRequest(id, { scope: 'myapp.com' })).toThrow(`Unknown circuit '${id}'. Known: ${KNOWN}.`);
    await expect(sdk.createRelayRequest(id, { scope: 'myapp.com' })).rejects.toThrow(`Unknown circuit '${id}'. Expected: ${KNOWN}`);
    expect(
      validateProofRequest({ requestId: 'req-1', circuit: id as CircuitId, inputs: { scope: 'myapp.com' }, callbackUrl: 'https://example.com/cb', createdAt: Date.now() } as never),
    ).toEqual({ valid: false, error: `Invalid circuit type: ${id}. Expected one of: ${KNOWN}` });
    expect(parseProofResponseUrl(`https://example.com/cb?requestId=req-1&status=completed&circuit=${id}`)).toBeNull();
  });
});
