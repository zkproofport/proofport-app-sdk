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
