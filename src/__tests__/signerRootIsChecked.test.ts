/**
 * The Coinbase and GIWA circuits prove "a member of the tree with root R
 * signed the attestation", where R is a public input the prover supplies. A
 * proof over a tree of the prover's own keys verifies everywhere unless the
 * verifier compares R with the published signer set. Every verify path must.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';
import { ProofportSDK } from '../ProofportSDK';
import {
  verifyProofOnChain,
  checkProofIssuer,
  CIRCUIT_ISSUER_CHECKS,
  SIGNER_ROOT_LAYOUTS,
  COINBASE_SIGNER_SET,
  GIWA_SIGNER_SET,
  ALL_CIRCUIT_IDS,
} from '../verifier';
import { verifyProofOffChain } from '../offChainVerifier';
import { CIRCUIT_METADATA } from '../constants';
import type { ProofResponse } from '../types';
import { attestationInputs, type RootCircuit } from './helpers/signerFixtures';

vi.mock('@aztec/bb.js', () => ({
  Barretenberg: { new: vi.fn(async () => ({ destroy: vi.fn() })) },
  UltraHonkVerifierBackend: vi.fn(function (this: any) {
    this.verifyProof = vi.fn(async () => true);
  }),
}));

const Contract = ethers.Contract as unknown as ReturnType<typeof vi.fn>;
const PROOF = '0x' + 'ab'.repeat(64);
const VK = new Uint8Array(1888);
const ROOT_CIRCUITS = Object.keys(SIGNER_ROOT_LAYOUTS) as RootCircuit[];

/** The root of a tree the attacker controls, built the way the provers build theirs. */
async function rootOf(addresses: string[]): Promise<string> {
  const real = await vi.importActual<typeof import('ethers')>('ethers');
  let layer = addresses.map(a => real.keccak256(real.getBytes(real.getAddress(a))));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(real.keccak256(real.concat([layer[i], layer[i + 1] ?? layer[i]])));
    layer = next;
  }
  return layer[0];
}

beforeEach(() => {
  Contract.mockClear();
});

describe('the expected roots are the roots of the published signer lists', () => {
  it('recomputes each committed root from its committed list (a hand-edited hex fails here)', async () => {
    expect(await rootOf([...COINBASE_SIGNER_SET.signers])).toBe(COINBASE_SIGNER_SET.root);
    expect(await rootOf([...GIWA_SIGNER_SET.signers])).toBe(GIWA_SIGNER_SET.root);
  });

  it('every circuit whose public inputs name a signer root has a check; the rest say why not', () => {
    for (const id of ALL_CIRCUIT_IDS) {
      const hasRoot = CIRCUIT_METADATA[id].publicInputNames.includes('signer_list_merkle_root');
      const check = (CIRCUIT_ISSUER_CHECKS as Record<string, unknown>)[id];
      if (hasRoot) expect(check, id).not.toBeNull();
    }
    expect(Object.entries(CIRCUIT_ISSUER_CHECKS).filter(([, c]) => c === null).map(([id]) => id).sort()).toEqual(
      ['dojang_playground'],
    );
  });

  // The real proofs the circuits build writes (not committed; present where
  // the circuits were built). Their root is what a genuine mobile proof carries.
  const REAL = [
    ['coinbase_attestation', 'coinbase-attestation'],
    ['coinbase_country_attestation', 'coinbase-country-attestation'],
    ['giwa_attestation', 'giwa-attestation'],
  ] as const;
  it.each(REAL)('accepts the root inside a real %s proof', async (circuit, dir) => {
    const file = join(process.cwd(), '..', 'circuits', dir, 'target', 'proof', 'public_inputs');
    if (!existsSync(file)) return;
    const bytes = readFileSync(file);
    const inputs: string[] = [];
    for (let i = 0; i < bytes.length; i += 32) inputs.push('0x' + bytes.subarray(i, i + 32).toString('hex'));
    expect(await checkProofIssuer(circuit, inputs)).toEqual({ ok: true });
  });
});

describe.each(ROOT_CIRCUITS)('%s', circuit => {
  const layout = SIGNER_ROOT_LAYOUTS[circuit];

  it('accepts the published root', async () => {
    expect(await checkProofIssuer(circuit, attestationInputs(circuit))).toEqual({ ok: true });
  });

  it("refuses a root of the attacker's own signer", async () => {
    const forged = await rootOf(['0x000000000000000000000000000000000000dEaD']);
    const result = await checkProofIssuer(circuit, attestationInputs(circuit, forged));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/not the root of/);
  });

  it('refuses the published signers plus one more', async () => {
    const plus = await rootOf([...layout.set.signers, '0x000000000000000000000000000000000000dEaD']);
    expect((await checkProofIssuer(circuit, attestationInputs(circuit, plus))).ok).toBe(false);
  });

  it("refuses the other issuer's root", async () => {
    const other = layout.set === COINBASE_SIGNER_SET ? GIWA_SIGNER_SET.root : COINBASE_SIGNER_SET.root;
    expect((await checkProofIssuer(circuit, attestationInputs(circuit, other))).ok).toBe(false);
  });

  it.each([0, 31])('refuses a root differing in byte %i only', async i => {
    const inputs = attestationInputs(circuit);
    inputs[layout.rootStart + i] = '0x' + ((Number(BigInt(inputs[layout.rootStart + i])) ^ 1).toString(16));
    expect((await checkProofIssuer(circuit, inputs)).ok).toBe(false);
  });

  it('refuses the right root one slot early, with zeros where the root belongs', async () => {
    const inputs = attestationInputs(circuit, '0x' + '00'.repeat(32));
    const real = attestationInputs(circuit);
    for (let i = 0; i < 32; i++) inputs[layout.rootStart - 32 + i] = real[layout.rootStart + i];
    expect((await checkProofIssuer(circuit, inputs)).ok).toBe(false);
  });

  it('refuses a root field holding more than a byte, even when its low byte is right', async () => {
    const inputs = attestationInputs(circuit);
    inputs[layout.rootStart] = '0x' + (BigInt(inputs[layout.rootStart]) + 256n).toString(16);
    expect((await checkProofIssuer(circuit, inputs)).ok).toBe(false);
  });

  it.each([['zz'], [''], ['-1'], ['<script>'], ['%_\\'], ['0x😀']])('refuses a root field %j', async value => {
    const inputs = attestationInputs(circuit);
    inputs[layout.rootStart + 5] = value;
    expect((await checkProofIssuer(circuit, inputs)).ok).toBe(false);
  });

  it.each([['empty'], ['one short'], ['one extra']])('refuses a public input array that is %s', async shape => {
    const good = attestationInputs(circuit);
    const inputs = shape === 'empty' ? [] : shape === 'one short' ? good.slice(0, -1) : [...good, good[0]];
    expect((await checkProofIssuer(circuit, inputs)).ok).toBe(false);
  });
});

describe('every verify path refuses a forged signer root before asking the verifier', () => {
  const forgedInputs = async () =>
    attestationInputs('coinbase_attestation', await rootOf(['0x000000000000000000000000000000000000dEaD']));
  const response = (publicInputs: string[]): ProofResponse => ({
    requestId: 'r', circuit: 'coinbase_attestation', status: 'completed', proof: PROOF, publicInputs,
  });
  const paths: Array<[string, (inputs: string[]) => Promise<{ valid: boolean; error?: string }>, boolean]> = [
    ['core verifyProofOnChain', i => verifyProofOnChain('coinbase_attestation', { proofHex: PROOF, publicInputsHex: i, numPublicInputs: i.length }, {}, { chainId: 84532 }), true],
    ['sdk.verifyOnChain', i => ProofportSDK.create('staging').verifyOnChain('coinbase_attestation', PROOF, i, {}), true],
    ['sdk.verifyResponseOnChain', i => ProofportSDK.create('staging').verifyResponseOnChain(response(i), {}), true],
    ['verifyProofOffChain', i => verifyProofOffChain('coinbase_attestation', PROOF, i, { verificationKey: VK }), false],
    ['sdk.verifyResponseOffChain', i => ProofportSDK.create('staging').verifyResponseOffChain(response(i), { verificationKey: VK }), false],
  ];

  it.each(paths)('%s', async (_name, verify, onChain) => {
    const refused = await verify(await forgedInputs());
    expect(refused.valid).toBe(false);
    expect(refused.error).toMatch(/not the root of Coinbase's published signers/);
    if (onChain) expect(Contract).not.toHaveBeenCalled();

    const accepted = await verify(attestationInputs('coinbase_attestation'));
    expect(accepted.error).toBeUndefined();
    expect(accepted.valid).toBe(true);
  });
});
