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
import {
  ACCEPTED_LEGACY_VERIFIERS,
  AWAITING_REDEPLOY,
  PINNED_VARIANT_VERIFIERS,
  PINNED_VERIFIERS,
  VERIFICATION_KEYS,
  type AwaitingRedeploy,
  type LegacyVerifier,
  type PinnedVerifier,
  type VerificationKeyRecord,
} from './pinnedVerifiers.generated';

export {
  ACCEPTED_LEGACY_VERIFIERS,
  AWAITING_REDEPLOY,
  PINNED_VARIANT_VERIFIERS,
  PINNED_VERIFIERS,
  PINNED_VERIFIERS_SOURCE_COMMIT,
  VERIFICATION_KEYS,
  VERIFICATION_KEYS_REF,
  VERIFICATION_KEY_BB_VERSION,
} from './pinnedVerifiers.generated';
export type { AwaitingRedeploy, LegacyVerifier, PinnedVerifier, VerificationKeyRecord } from './pinnedVerifiers.generated';

/**
 * The current verification key of a circuit's `variant` package: its sha256
 * and its path in the circuits repository (fetched at VERIFICATION_KEYS_REF).
 *
 * @throws Error naming the circuit, or the circuit and its variants.
 */
export function getVerificationKeyRecord(circuit: string, variant: string): VerificationKeyRecord {
  getCircuitPackage(circuit, variant);
  const byVariant = VERIFICATION_KEYS[circuit as CircuitId];
  const record = Object.prototype.hasOwnProperty.call(byVariant, variant) ? byVariant[variant as SignerVariant] : undefined;
  if (!record) {
    throw new Error(`No verification key is recorded for ${circuit} '${variant}'. Recorded: ${Object.keys(byVariant).join(', ') || 'none'}.`);
  }
  return record;
}

/**
 * Why a chain has no pinned verifier when one IS deployed there: the contract
 * was built from a superseded key and waits for a redeploy. Null otherwise.
 */
function awaitingRedeployError(circuit: string, variant: string, chainId: number, table: readonly AwaitingRedeploy[] = AWAITING_REDEPLOY): string | null {
  const row = table.find(v => v.circuit === circuit && v.variant === variant && v.chainId === chainId);
  if (!row) return null;
  return (
    `The ${circuit} verifier${variant === 'standard' ? '' : ` for the '${variant}' signer`} on chain ${chainId} awaits a redeploy: ` +
    `the contract deployed there (${row.previousAddress}) was built from a verification key that is no longer this circuit's, ` +
    `so it is not used.`
  );
}

/**
 * One contract a proof may be checked against. `current` is the deployment
 * {@link getPinnedVariantVerifier} names; `legacy` is a superseded one the
 * circuits repository still vouches for until `acceptedUntil`.
 */
export interface AcceptedVerifier {
  readonly address: string;
  readonly chainId: number;
  readonly label: 'current' | 'legacy';
  /** For `legacy`: the last day (UTC, inclusive) it is accepted. */
  readonly acceptedUntil?: string;
  /** For `legacy`: the circuits commit holding its verification key. */
  readonly vkRef?: string;
}

/** @internal `YYYY-MM-DD` of `now` in UTC. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Legacy verifiers of a circuit's `variant` package still within their window
 * on `now`, in table order, on one chain -- or on every chain with `'any'`,
 * which the off-chain path uses because it needs only their verification keys.
 */
export function getAcceptedLegacyVerifiers(
  circuit: string,
  variant: string,
  now: Date,
  chainId: number | 'any',
  table: readonly LegacyVerifier[] = ACCEPTED_LEGACY_VERIFIERS,
): readonly LegacyVerifier[] {
  getCircuitPackage(circuit, variant);
  const today = utcDay(now);
  return table.filter(
    v => v.circuit === circuit && v.variant === variant && (chainId === 'any' || v.chainId === chainId) && today <= v.acceptedUntil,
  );
}

/**
 * Every contract a proof of a circuit's `variant` package may be checked
 * against on a chain: the current deployment first, then each legacy one still
 * within its window. All of them come from this package's tables; nothing a
 * proof response carries can add to the list.
 *
 * @throws Error as {@link getPinnedVariantVerifier} does: unknown circuit,
 *   unknown variant, or no current deployment on the chain. A legacy entry
 *   alone never makes a chain verifiable.
 */
export function getAcceptedVerifiers(
  circuit: string,
  variant: string,
  chainId: number,
  now: Date = new Date(),
  table: readonly LegacyVerifier[] = ACCEPTED_LEGACY_VERIFIERS,
): readonly AcceptedVerifier[] {
  const current = getPinnedVariantVerifier(circuit, variant, chainId);
  return [
    { address: current.address, chainId, label: 'current' },
    ...getAcceptedLegacyVerifiers(circuit, variant, now, chainId, table).map(v => ({
      address: v.address,
      chainId,
      label: 'legacy' as const,
      acceptedUntil: v.acceptedUntil,
      vkRef: v.vkRef,
    })),
  ];
}

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
    const awaiting = awaitingRedeployError(circuit, 'standard', chainId);
    if (awaiting) throw new Error(awaiting);
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
    const awaiting = awaitingRedeployError(circuit, variant, chainId);
    if (awaiting) throw new Error(awaiting);
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
