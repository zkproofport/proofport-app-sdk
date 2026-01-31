/**
 * ProofPort SDK Constants
 */

import type { CircuitType, VerifierContract } from './types';

/**
 * Default deep link scheme
 */
export const DEFAULT_SCHEME = 'zkproofport';

/**
 * Deep link hosts
 */
export const DEEP_LINK_HOSTS = {
  PROOF_REQUEST: 'proof-request',
  PROOF_RESPONSE: 'proof-response',
} as const;

/**
 * Circuit metadata
 */
export const CIRCUIT_METADATA: Record<CircuitType, {
  name: string;
  description: string;
  publicInputsCount: number;
  publicInputNames: string[];
}> = {
  age_verifier: {
    name: 'Age Verifier',
    description: 'Verify age without revealing birth year',
    publicInputsCount: 2,
    publicInputNames: ['current_year', 'min_age'],
  },
  coinbase_attestation: {
    name: 'Coinbase KYC',
    description: 'Prove Coinbase identity verification',
    publicInputsCount: 2,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
  },
};

/**
 * Default verifier contracts on Base Sepolia
 */
export const DEFAULT_VERIFIERS: Record<CircuitType, VerifierContract> = {
  age_verifier: {
    address: '', // TODO: deploy to Base Sepolia
    chainId: 84532, // Base Sepolia
    abi: [
      'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
    ],
  },
  coinbase_attestation: {
    address: '0x07121eb50b2Ebe1675E7Cb96c84B580A3fF6589e',
    chainId: 84532, // Base Sepolia
    abi: [
      'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
    ],
  },
};

/**
 * RPC endpoints by chain ID
 */
export const RPC_ENDPOINTS: Record<number, string> = {
  84532: 'https://sepolia.base.org', // Base Sepolia
  8453: 'https://mainnet.base.org', // Base Mainnet
};

/**
 * Request expiry time (default: 10 minutes)
 */
export const DEFAULT_REQUEST_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Maximum QR code data size (bytes)
 */
export const MAX_QR_DATA_SIZE = 2953; // Version 40 with L error correction
