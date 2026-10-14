import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';
import { RELAY_TERMINAL_STATUSES, isTerminalRelayStatus } from '../relayStatus';
import type { RelayProofResult } from '../types';

/**
 * Every way a relay request can end must end the wait, on both delivery paths.
 * Until this was fixed `waitForResult()` returned only on completed/failed, so
 * an app error, a cancellation or a relay timeout polled on until the SDK's own
 * timeout -- the dApp was left waiting for an answer that had already arrived.
 */

const TERMINAL: Array<Partial<RelayProofResult> & { status: RelayProofResult['status'] }> = [
  { status: 'completed', proof: '0xproof', publicInputs: ['0x01'] },
  { status: 'error', error: 'Proof generation failed', errorCode: 'E2007' },
  { status: 'failed', error: 'legacy failure' },
  { status: 'cancelled' },
  { status: 'expired', error: 'The request timed out before the app answered' },
];

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('isTerminalRelayStatus', () => {
  it('is true for exactly the five terminal statuses', () => {
    expect([...RELAY_TERMINAL_STATUSES]).toEqual(['completed', 'error', 'failed', 'cancelled', 'expired']);
    for (const s of RELAY_TERMINAL_STATUSES) expect(isTerminalRelayStatus(s)).toBe(true);
  });
  it('is false for in-progress and unknown statuses', () => {
    for (const s of ['pending', 'generating', 'processing', '', 'COMPLETED', 'done']) {
      expect(isTerminalRelayStatus(s)).toBe(false);
    }
  });
});

describe('waitForResult (HTTP polling) ends on every terminal status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(TERMINAL)('returns on $status after pending and generating', async (terminal) => {
    const sdk = ProofportSDK.create('local');
    (global.fetch as any)
      .mockResolvedValueOnce(okJson({ requestId: 'r', status: 'pending' }))
      .mockResolvedValueOnce(okJson({ requestId: 'r', status: 'generating' }))
      .mockResolvedValueOnce(okJson({ requestId: 'r', ...terminal }));

    const seen: string[] = [];
    const result = await sdk.waitForResult('r', {
      intervalMs: 1,
      timeoutMs: 2000,
      onStatusChange: (r) => seen.push(r.status),
    });

    expect(result).toMatchObject(terminal);
    expect(seen).toEqual(['pending', 'generating', terminal.status]);
    expect((global.fetch as any).mock.calls).toHaveLength(3);
  });

  it('keeps polling through generating and times out when nothing terminal arrives', async () => {
    const sdk = ProofportSDK.create('local');
    (global.fetch as any).mockResolvedValue(okJson({ requestId: 'r', status: 'generating' }));
    await expect(sdk.waitForResult('r', { intervalMs: 5, timeoutMs: 40 })).rejects.toThrow('Polling timed out after 40ms');
  });
});

describe('waitForProof (Socket.IO) resolves on every terminal status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function resultHandler(mockSocket: any): Promise<(r: unknown) => void> {
    for (let i = 0; i < 50; i++) {
      const call = (mockSocket.on as any).mock.calls.find((c: any[]) => c[0] === 'proof:result');
      if (call) return call[1];
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error('waitForProof never registered a proof:result handler');
  }

  it.each(TERMINAL)('resolves with $status delivered as proof:result', async (terminal) => {
    const sdk = ProofportSDK.create('local');
    const { __mockSocket: mockSocket } = (await import('socket.io-client')) as any;

    const pending = sdk.waitForProof('r', { timeoutMs: 2000 });
    const onResult = await resultHandler(mockSocket);
    onResult({ requestId: 'r', ...terminal });

    await expect(pending).resolves.toMatchObject(terminal);
    // Resolving tears the socket down; nothing is left listening.
    expect(mockSocket.disconnect).toHaveBeenCalled();
    // And it did not fall back to polling.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not resolve on a generating status update; it reports it and keeps waiting', async () => {
    const sdk = ProofportSDK.create('local');
    const { __mockSocket: mockSocket } = (await import('socket.io-client')) as any;
    const updates: string[] = [];

    const pending = sdk.waitForProof('r', { timeoutMs: 60, onStatusChange: (u) => updates.push(u.status) });
    await resultHandler(mockSocket);
    const onStatus = (mockSocket.on as any).mock.calls.find((c: any[]) => c[0] === 'proof:status')[1];
    onStatus({ requestId: 'r', status: 'generating' });

    await expect(pending).rejects.toThrow('Waiting for proof timed out after 60ms');
    expect(updates).toEqual(['generating']);
  });
});
