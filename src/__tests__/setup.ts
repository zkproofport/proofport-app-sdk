/**
 * Vitest global setup — mocks for fetch, ethers, socket.io-client
 */
import { vi } from 'vitest';

// ── Global fetch mock ──────────────────────────────────────────────
global.fetch = vi.fn();

// ── ethers mock (peer dependency, may not be installed) ────────────
vi.mock('ethers', () => {
  const Contract = vi.fn().mockImplementation(function (this: any) {
    this.verify = vi.fn().mockResolvedValue(true);
    this.isNullifierRegistered = vi.fn().mockResolvedValue(false);
    this.getNullifierInfo = vi.fn().mockResolvedValue([0n, '0x0', '0x0']);
  });

  return {
    ethers: {
      Contract,
      JsonRpcProvider: vi.fn(),
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
