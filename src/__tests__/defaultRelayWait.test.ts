import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { DEFAULT_RELAY_WAIT_MS } from '../relayStatus';
import { DEFAULT_RELAY_WAIT_MS as EXPORTED } from '../index';

/**
 * The relay answers `expired` at 540 s (`REQUEST_DEADLINE_MS` in
 * proofport-relay/src/app.ts). The SDK's default wait must outlast that, or a
 * dApp using the defaults sees its own timeout instead of the relay's answer.
 */
const RELAY_DEADLINE_MS = 540_000;

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('default relay wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is 600 000 ms and exported from the package root', () => {
    expect(DEFAULT_RELAY_WAIT_MS).toBe(600_000);
    expect(EXPORTED).toBe(DEFAULT_RELAY_WAIT_MS);
    expect(DEFAULT_RELAY_WAIT_MS).toBeGreaterThan(RELAY_DEADLINE_MS + 10_000);
  });

  it('waitForResult with no timeoutMs keeps polling past 300 s and gives up at 600 s', async () => {
    const sdk = ProofportSDK.create('local');
    (global.fetch as any).mockResolvedValue(okJson({ requestId: 'r', status: 'generating' }));
    let settled: unknown = 'open';
    const pending = sdk.waitForResult('r').then(
      (r) => { settled = r; },
      (e: Error) => { settled = e.message; },
    );

    await vi.advanceTimersByTimeAsync(RELAY_DEADLINE_MS);
    expect(settled).toBe('open');

    await vi.advanceTimersByTimeAsync(DEFAULT_RELAY_WAIT_MS - RELAY_DEADLINE_MS + 2_000);
    await pending;
    expect(settled).toBe('Polling timed out after 600000ms');
  });

  it('waitForProof with no timeoutMs is still waiting at 599 999 ms and times out at 600 000 ms', async () => {
    const sdk = ProofportSDK.create('local');
    let settled: unknown = 'open';
    const pending = sdk.waitForProof('r').then(
      (r) => { settled = r; },
      (e: Error) => { settled = e.message; },
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_RELAY_WAIT_MS - 1);
    expect(settled).toBe('open');

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe('Waiting for proof timed out after 600000ms');
  });
});
