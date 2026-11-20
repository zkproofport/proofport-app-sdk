/**
 * What a wallet credential proof's OPRF nullifier needs judged beyond its
 * verifier contract (circuits/oprf-nullifier-libs/README.md, "What a verifier
 * checks"):
 *
 * - the key hash: the proof's `oprf_key_hash` must be the one pinned for its
 *   proof type and the environment it is verified for (./oprfKeys). The
 *   circuit accepts an answer from any self-consistent key, so without this a
 *   proof under a key the prover holds verifies, with a nullifier the prover
 *   chose. Always checked.
 * - domain and scope: the proof's `domain` / `scope` must be
 *   keccak256(utf8(string)) mod p of the strings the request asked for.
 *   Reduced BEFORE comparing (a raw keccak256 is at or above p for about 81%
 *   of strings). Checked whenever the caller says which request the proof
 *   answers, the same rule as signal_hash (./signalHash).
 *
 * Never throws: everything here arrives from the proof's sender.
 */
import { isCircuitId, ALL_CIRCUIT_IDS } from './circuits';
import type { IssuerCheckResult } from './oidcProviderKeys';
import { oprfNameError, reduceOprfName } from './oprf/client';
import { getPinnedOprfKeyHash, OPRF_ENVIRONMENTS } from './oprfKeys';
import { OPRF_PUBLIC_INPUT_LAYOUTS, readOprfPublicInputs } from './oprfLayouts';

/** The strings a request asked the OPRF nullifier for. */
export interface OprfRequestNames {
  /** The scope string (not its hash). */
  scope: string;
  /** The OPRF domain string the request named (not its hash). */
  oprfDomain?: string;
}

export interface OprfCheckOptions {
  /**
   * The environment the proof is verified for: which row of OPRF_KEY_HASHES
   * its key hash must match. Required; there is no default, because a wrong
   * environment would accept a key nobody vouches for.
   */
  oprfEnvironment?: string;
  /** The request the proof answers; when given, domain and scope are compared. */
  request?: OprfRequestNames;
}

const fail = (error: string): IssuerCheckResult => ({ ok: false, error });

function nameField(value: unknown, what: string): string | { error: string } {
  if (value === undefined) {
    return { error: `The request names no ${what}, so the proof's ${what} cannot be checked. Pass request.${what === 'OPRF domain' ? 'oprfDomain' : 'scope'}.` };
  }
  const why = oprfNameError(value);
  if (why !== null) return { error: `The request's ${what} cannot be an OPRF name (${why}).` };
  return reduceOprfName(value as string);
}

/** The OPRF check for one `circuit` proof. */
export function checkOprfProof(
  circuit: string,
  publicInputs: readonly string[],
  options: OprfCheckOptions = {},
): IssuerCheckResult {
  if (!isCircuitId(circuit)) return fail(`Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  if (OPRF_PUBLIC_INPUT_LAYOUTS[circuit] === null) return fail(`${circuit} has no OPRF nullifier.`);
  if (options.oprfEnvironment === undefined) {
    return fail(
      `oprfEnvironment is required to verify a ${circuit} proof: it decides which OPRF key the proof must come from. ` +
        `Known: ${OPRF_ENVIRONMENTS.join(', ')}.`,
    );
  }
  let pinned: string;
  let read: ReturnType<typeof readOprfPublicInputs>;
  try {
    pinned = getPinnedOprfKeyHash(options.oprfEnvironment, circuit);
    read = readOprfPublicInputs(circuit, publicInputs);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (read.oprfKeyHash !== pinned) {
    return fail(
      `The proof's OPRF key hash ${read.oprfKeyHash} is not the key pinned for ${circuit} in '${options.oprfEnvironment}' ` +
        `(${pinned}), so its nullifier may come from a key someone else holds.`,
    );
  }
  if (options.request === undefined) return { ok: true };
  if (!options.request || typeof options.request !== 'object') return fail('The request must be an object { scope, oprfDomain }.');
  const domain = nameField(options.request.oprfDomain, 'OPRF domain');
  if (typeof domain !== 'string') return fail(domain.error);
  const scope = nameField(options.request.scope, 'scope');
  if (typeof scope !== 'string') return fail(scope.error);
  if (read.domain !== domain) {
    return fail(
      `The proof's OPRF domain ${read.domain} is not keccak256(${JSON.stringify(options.request.oprfDomain)}) mod p (${domain}).` +
        (read.domain === scope ? ' Domain and scope are swapped.' : ''),
    );
  }
  if (read.scope !== scope) {
    return fail(`The proof's scope ${read.scope} is not keccak256(${JSON.stringify(options.request.scope)}) mod p (${scope}).`);
  }
  return { ok: true };
}
