/**
 * A dapp finds out its action is unusable HERE, not from inside the phone.
 *
 * `arc_eligibility` proves that a wallet authorised one EIP-712 action. An
 * action that is missing, malformed, or missing a field its own struct
 * declares cannot be proved — and the circuit will not say so, because it
 * hashes the action without reading it.
 *
 * The refusal used to live only in the mobile app's deep-link handling, which
 * is a screen the dapp developer never sees, reached after a person has
 * already scanned a QR code and switched apps. By then the challenge is spent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

const mockSigner = {
  signMessage: vi.fn().mockResolvedValue('0xmocksignature'),
  getAddress: vi.fn().mockResolvedValue('0xmockaddress'),
};

const GOOD_ACTION = {
  domain: {
    name: 'MyVault',
    version: '1',
    chainId: 5042002,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: { Deposit: [{ name: 'amount', type: 'uint256' }] },
  primaryType: 'Deposit',
  message: { amount: '1000000' },
};

function sdk() {
  const s = ProofportSDK.create('local');
  s.setSigner(mockSigner);
  return s;
}

describe('a dapp hears about a bad action from the SDK', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    mockSigner.signMessage.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('refuses an action on a circuit that cannot prove one, before any network call', async () => {
    // Arc stopped being the example here on 2026-09-22: its circuit gained a
    // branch, so a request with no action is now a plain attestation rather
    // than a refusal. What must still fail early is the opposite mistake --
    // an action sent to a circuit with no slots for it, which would otherwise
    // be dropped and leave the dapp believing something was authorized.
    await expect(
      sdk().createRelayRequest('coinbase_attestation', {
        scope: 'myapp.com',
        action: GOOD_ACTION,
      } as never),
    ).rejects.toThrow(/no action inputs/);
    // Nothing was fetched, so no challenge was burned.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses an action missing a field its own struct declares, and names it', async () => {
    const broken = { ...GOOD_ACTION, message: {} };
    await expect(
      sdk().createRelayRequest('arc_eligibility', {
        scope: 'myapp.com',
        action: broken,
      } as never),
    ).rejects.toThrow(/message is missing: amount/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a verifyingContract that is not an address', async () => {
    const broken = {
      ...GOOD_ACTION,
      domain: { ...GOOD_ACTION.domain, verifyingContract: 'MyVault' },
    };
    await expect(
      sdk().createRelayRequest('arc_eligibility', {
        scope: 'myapp.com',
        action: broken,
      } as never),
    ).rejects.toThrow(/verifyingContract must be a 20-byte hex address/);
  });

  it('names the circuit in the message, so a multi-circuit dapp knows which call', async () => {
    // Arc with no action is a valid request since its circuit gained the
    // branch, so the example is now the refusal that remains: an action sent
    // where nothing can prove it.
    const err = await sdk()
      .createRelayRequest('coinbase_attestation', {
        scope: 'myapp.com',
        action: GOOD_ACTION,
      } as never)
      .catch((e: Error) => e.message);
    expect(err).toContain('coinbase_attestation');
  });

  it('lets a complete action through to the relay', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requestId: 'r1', challenge: '0xchallenge' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requestId: 'r1',
          deepLink: 'zkproofport://proof-request?data=abc',
          status: 'pending',
        }),
      });

    const req = await sdk().createRelayRequest('arc_eligibility', {
      scope: 'myapp.com',
      action: GOOD_ACTION,
    } as never);
    expect(req.requestId).toBe('r1');

    // And the action reached the relay body rather than being dropped on the
    // way: the mobile app cannot invent it.
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string).inputs.action).toEqual(GOOD_ACTION);
  });

  it('demands a wallet signature for arc, as the relay does', async () => {
    const noSigner = ProofportSDK.create('local');
    await expect(
      noSigner.createRelayRequest('arc_eligibility', {
        scope: 'myapp.com',
        action: GOOD_ACTION,
      } as never),
    ).rejects.toThrow(/Signer not set/);
  });
});
