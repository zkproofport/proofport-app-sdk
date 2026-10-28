/**
 * Which verifier contract a proof is checked against, and who gets to say.
 *
 * Only two parties may name a verifier: this package, through the table
 * generated from the circuits repository's deployment records, and the dApp,
 * by configuring one explicitly. A proof response never may. It used to: when
 * the dApp configured nothing, `verifyProofOnChain` called whatever
 * `verifierAddress` the response carried, so whoever produced the response also
 * chose the contract that judged it -- a contract that answers `true` to
 * everything would have done.
 */
import { ALL_CIRCUIT_IDS, getCircuitPackage, isCircuitId, type CircuitId, type SignerVariant } from './circuits';
import { PINNED_VARIANT_VERIFIERS, PINNED_VERIFIERS, type PinnedVerifier } from './pinnedVerifiers.generated';

export { PINNED_VARIANT_VERIFIERS, PINNED_VERIFIERS, PINNED_VERIFIERS_SOURCE_COMMIT } from './pinnedVerifiers.generated';
export type { PinnedVerifier } from './pinnedVerifiers.generated';

/**
 * The pinned verifier for a circuit on a chain.
 *
 * @throws Error naming the circuit when it is not a circuit id, and naming the
 *   chain and the chains that do have one when there is no deployment there.
 */
export function getPinnedVerifier(circuit: string, chainId: number): PinnedVerifier {
  if (!isCircuitId(circuit)) {
    throw new Error(`Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  const byChain = PINNED_VERIFIERS[circuit as CircuitId];
  const pinned = Object.prototype.hasOwnProperty.call(byChain, chainId) ? byChain[chainId] : undefined;
  if (!pinned) {
    const known = Object.keys(byChain);
    throw new Error(
      `No ${circuit} verifier is deployed on chain ${chainId}. ` +
        (known.length > 0 ? `Chains with one: ${known.join(', ')}.` : 'It has no verifier deployed on any chain.'),
    );
  }
  return pinned;
}

/**
 * The pinned verifier for a circuit's `variant` package on a chain. The
 * variant is required: `standard` gives {@link getPinnedVerifier}'s answer.
 *
 * @throws Error naming the circuit when it is not a circuit id, naming the
 *   circuit and its variants when it has no `variant` package, and naming the
 *   chain and the chains that do have one when nothing is deployed there.
 */
export function getPinnedVariantVerifier(circuit: string, variant: string, chainId: number): PinnedVerifier {
  getCircuitPackage(circuit, variant);
  if (variant === 'standard') return getPinnedVerifier(circuit, chainId);
  const byCircuit: Partial<Record<CircuitId, Readonly<Record<number, PinnedVerifier>>>> =
    PINNED_VARIANT_VERIFIERS[variant as Exclude<SignerVariant, 'standard'>];
  const byChain = Object.prototype.hasOwnProperty.call(byCircuit, circuit) ? byCircuit[circuit as CircuitId] : undefined;
  const pinned = byChain && Object.prototype.hasOwnProperty.call(byChain, chainId) ? byChain[chainId] : undefined;
  if (!pinned) {
    const known = byChain ? Object.keys(byChain) : [];
    throw new Error(
      `No ${circuit} verifier for the '${variant}' signer is deployed on chain ${chainId}. ` +
        (known.length > 0 ? `Chains with one: ${known.join(', ')}.` : 'It has no verifier deployed on any chain.'),
    );
  }
  return pinned;
}

/** Address equality, ignoring checksum case. Both must be 20-byte hex. */
export function sameAddress(a: string, b: string): boolean {
  const hex = /^0x[0-9a-fA-F]{40}$/;
  return hex.test(a) && hex.test(b) && a.toLowerCase() === b.toLowerCase();
}
