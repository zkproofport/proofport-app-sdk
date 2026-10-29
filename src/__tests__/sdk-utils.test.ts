import { describe, it, expect } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

describe('ProofportSDK - Utility Methods', () => {
  it('getVerifierAddress() returns address for configured circuit', () => {
    const sdk = new ProofportSDK({
      verifiers: {
        coinbase_attestation: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          chainId: 84532,
          abi: [
            'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
          ],
        },
      },
    });

    const address = sdk.getVerifierAddress('coinbase_attestation');
    expect(address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('getVerifierAddress() throws for unconfigured circuit', () => {
    const sdk = new ProofportSDK();

    expect(() => {
      sdk.getVerifierAddress('coinbase_attestation');
    }).toThrow("No verifier configured for circuit 'coinbase_attestation'.");
  });

  it('getVerifierChainId() returns chain ID for configured circuit', () => {
    const sdk = new ProofportSDK({
      verifiers: {
        coinbase_attestation: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          chainId: 84532,
          abi: [
            'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
          ],
        },
      },
    });

    const chainId = sdk.getVerifierChainId('coinbase_attestation');
    expect(chainId).toBe(84532);
  });

  it('getCircuitMetadata() returns correct metadata for coinbase_attestation', () => {
    const sdk = new ProofportSDK();

    const metadata = sdk.getCircuitMetadata('coinbase_attestation');
    expect(metadata).toEqual({
      name: 'Coinbase KYC',
      description: 'Prove Coinbase identity verification, optionally authorizing one EIP-712 action',
      publicInputsCount: 193,
      publicInputNames: ['signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'scope', 'nullifier', 'attested_at'],
    });
  });

  it('getCircuitMetadata() returns correct metadata for coinbase_country_attestation', () => {
    const sdk = new ProofportSDK();

    const metadata = sdk.getCircuitMetadata('coinbase_country_attestation');
    expect(metadata).toEqual({
      name: 'Coinbase Country',
      description: 'Prove Coinbase country verification',
      publicInputsCount: 150,
      publicInputNames: [
        'signal_hash',
        'signer_list_merkle_root',
        'country_list',
        'country_list_length',
        'is_included',
      ],
    });
  });

  it('getSupportedCircuits() returns all circuit types', () => {
    const sdk = new ProofportSDK();

    const circuits = sdk.getSupportedCircuits();
    expect(circuits).toEqual([
      'coinbase_attestation',
      'coinbase_country_attestation',
      'oidc_domain_attestation',
      'giwa_attestation',
      'dojang_playground',
    ]);
  });
});
