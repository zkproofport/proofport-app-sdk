/**
 * Vitest global setup — mocks for fetch, ethers, socket.io-client
 */
import { vi } from 'vitest';

// ── Global fetch mock ──────────────────────────────────────────────
global.fetch = vi.fn();

// ── ethers mock (peer dependency, may not be installed) ────────────
vi.mock('ethers', async () => {
  // Hashing stays real: core's OIDC policy hashes the audience and the request
  // nonce with ethers' keccak256, and a mocked hash would check nothing.
  const actual = (await vi.importActual<typeof import('ethers')>('ethers')).ethers;
  const Contract = vi.fn().mockImplementation(function (this: any) {
    this.verify = vi.fn().mockResolvedValue(true);
  });

  return {
    ethers: {
      Contract,
      JsonRpcProvider: vi.fn(),
      keccak256: actual.keccak256,
      toUtf8Bytes: actual.toUtf8Bytes,
      concat: actual.concat,
      zeroPadValue: vi.fn((value: string, length: number) => {
        const hex = value.startsWith('0x') ? value.slice(2) : value;
        return '0x' + hex.padStart(length * 2, '0');
      }),
    },
  };
});

// ── socket.io-client mock ──────────────────────────────────────────
vi.mock('socket.io-client', () => {
  const mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  };

  return {
    io: vi.fn(() => mockSocket),
    __mockSocket: mockSocket,
  };
});
