import type { RelayTerminalStatus } from './types';

/**
 * The statuses a relay request ends in, as a runtime list. `satisfies` keeps it
 * in step with the `RelayTerminalStatus` type in both directions: a status
 * added to the type and not here, or here and not in the type, fails to compile.
 */
export const RELAY_TERMINAL_STATUSES = ['completed', 'error', 'failed', 'cancelled', 'expired'] as const satisfies readonly RelayTerminalStatus[];

type Missing = Exclude<RelayTerminalStatus, typeof RELAY_TERMINAL_STATUSES[number]>;
const everyStatusListed: Missing extends never ? true : Missing = true;
void everyStatusListed;

/** True when `status` is one a relay request ends in. */
export function isTerminalRelayStatus(status: string): status is RelayTerminalStatus {
  return (RELAY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * How long `waitForProof()` / `waitForResult()` wait when the caller passes no
 * `timeoutMs`: 600 000 ms (10 min).
 *
 * The relay answers `expired` itself at 540 s, so with this default a dApp
 * always gets a terminal status to branch on rather than its own timeout. A
 * heavy proof on an older phone takes a few minutes after the user confirms;
 * the earlier 300 000 ms default could fire while such a proof was still being
 * made.
 */
export const DEFAULT_RELAY_WAIT_MS = 600_000;
