/**
 * The lookup over ./oprfKeyHashes (the pinned OPRF key hash per environment
 * and proof type; read that file for what each row is and where it came
 * from). An unknown environment, an environment with no key, an unknown
 * circuit and a circuit with no OPRF nullifier are each an error naming
 * what was asked -- never another row.
 */
import { ALL_CIRCUIT_IDS } from './circuits';
import type { OprfCircuitId } from './oprfLayouts';
import { OPRF_CIRCUIT_IDS } from './oprfLayouts';
import { OPRF_ENVIRONMENTS, OPRF_KEY_HASHES, type OprfEnvironment } from './oprfKeyHashes';

export {
  OPRF_ENVIRONMENTS,
  OPRF_KEY_HASHES,
  TACEO_TESTNET_OPRF_KEY_HASH,
  TACEO_TESTNET_OPRF_PUBLIC_KEY,
} from './oprfKeyHashes';
export type { OprfEnvironment } from './oprfKeyHashes';

export function isOprfEnvironment(value: unknown): value is OprfEnvironment {
  return typeof value === 'string' && (OPRF_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * The key hash a `circuit` proof must carry in `environment`.
 *
 * @throws Error naming the unknown environment, an environment with no OPRF
 *   key (production today), an unknown circuit, or a circuit with no OPRF
 *   nullifier.
 */
export function getPinnedOprfKeyHash(environment: unknown, circuit: unknown): string {
  if (!isOprfEnvironment(environment)) {
    throw new Error(`Unknown OPRF environment '${String(environment)}'. Known: ${OPRF_ENVIRONMENTS.join(', ')}.`);
  }
  const rows = OPRF_KEY_HASHES[environment];
  if (rows === null) {
    throw new Error(
      `No OPRF key is registered for the '${environment}' environment, so no wallet credential proof can be verified there yet.`,
    );
  }
  if (typeof circuit !== 'string' || !(ALL_CIRCUIT_IDS as readonly string[]).includes(circuit)) {
    throw new Error(`Unknown circuit '${String(circuit)}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  if (!(OPRF_CIRCUIT_IDS as readonly string[]).includes(circuit)) {
    throw new Error(`${circuit} has no OPRF nullifier. Circuits that do: ${OPRF_CIRCUIT_IDS.join(', ')}.`);
  }
  const row = rows[circuit as OprfCircuitId];
  if (row === undefined) {
    throw new Error(`No OPRF key hash for ${circuit} in '${environment}'.`);
  }
  return row;
}
