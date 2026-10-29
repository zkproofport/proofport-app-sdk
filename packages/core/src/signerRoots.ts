/**
 * The signer-list Merkle root an attestation proof carries must be the root of
 * the published signer set.
 *
 * coinbase_attestation, coinbase_country_attestation and giwa_attestation
 * prove that the attestation transaction was signed by a member of the tree
 * whose root is `signer_list_merkle_root` -- a PUBLIC INPUT the prover
 * supplies. A prover who builds a tree of their own keys, signs a fake
 * attestation with one of them and proves against that root produces a proof
 * every verifier contract accepts. Only comparing the root with the known one
 * makes the proof say "Coinbase (or the GIWA attester) signed this". Until
 * 2026-10-23 only OpenStoa compared it, and only for the Coinbase circuits.
 *
 * Expected roots come from signerRoots.generated.ts, which
 * scripts/generate-signer-roots.mjs computes from the provers' own lists.
 */
import { COINBASE_SIGNER_SET, GIWA_SIGNER_SET, type SignerSet } from './signerRoots.generated';
import type { IssuerCheckResult } from './oidcProviderKeys';

export { COINBASE_SIGNER_SET, GIWA_SIGNER_SET } from './signerRoots.generated';
export type { SignerSet } from './signerRoots.generated';

export interface SignerRootLayout {
  /** Field index where the 32 root bytes start, one byte per field. */
  rootStart: number;
  /** The circuit's exact public input count. */
  publicInputCount: number;
  /** Which signer set's root it must carry. */
  set: SignerSet;
  /** Name for messages. */
  issuer: string;
}

/**
 * Per circuit, read off its `fn main` (and CIRCUIT_METADATA): Country puts
 * the root second (32-63); GIWA and Coinbase KYC v2 put signal_hash,
 * domain_separator and action_hash first, so their root is at 96-127.
 */
export const SIGNER_ROOT_LAYOUTS = Object.freeze({
  coinbase_attestation: { rootStart: 96, publicInputCount: 193, set: COINBASE_SIGNER_SET, issuer: 'Coinbase' },
  coinbase_country_attestation: { rootStart: 32, publicInputCount: 150, set: COINBASE_SIGNER_SET, issuer: 'Coinbase' },
  giwa_attestation: { rootStart: 96, publicInputCount: 192, set: GIWA_SIGNER_SET, issuer: 'the GIWA attester' },
} as const satisfies Record<string, SignerRootLayout>);

/** The check for one circuit's layout. */
export function signerRootCheck(layout: SignerRootLayout) {
  return async (publicInputs: readonly string[]): Promise<IssuerCheckResult> => {
    if (!Array.isArray(publicInputs) || publicInputs.length !== layout.publicInputCount) {
      return {
        ok: false,
        error: `Expected ${layout.publicInputCount} public inputs; got ${Array.isArray(publicInputs) ? publicInputs.length : typeof publicInputs}.`,
      };
    }
    let hex = '0x';
    for (let i = layout.rootStart; i < layout.rootStart + 32; i++) {
      let value: bigint;
      try {
        value = BigInt(publicInputs[i]);
      } catch {
        return { ok: false, error: `Public input ${i} (signer root byte) is not a number.` };
      }
      // No separate byte-range test: a value above 255 adds three or more hex
      // digits and a negative one a '-', so the string below can no longer
      // equal a 66-character root. Exact equality already refuses both.
      hex += value.toString(16).padStart(2, '0');
    }
    if (hex !== layout.set.root) {
      return {
        ok: false,
        error: `The proof's signer-list root ${hex} is not the root of ${layout.issuer}'s published signers (${layout.set.root}), ` +
          'so nothing shows the attestation was signed by them.',
      };
    }
    return { ok: true };
  };
}
