/**
 * ZKProofPort SDK Constants
 */

import type { CircuitType } from './types';

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
  coinbase_attestation: {
    name: 'Coinbase KYC',
    description: 'Prove Coinbase identity verification',
    publicInputsCount: 2,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
  },
  coinbase_country_attestation: {
    name: 'Coinbase Country',
    description: 'Prove Coinbase country verification',
    publicInputsCount: 14,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root', 'country_list', 'country_list_length', 'is_included'],
  },
};

/**
 * Standard verifier contract ABI (shared across all circuits)
 */
export const VERIFIER_ABI = [
  'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];

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

export const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  SCOPE_START: 64,
  SCOPE_END: 95,
  NULLIFIER_START: 96,
  NULLIFIER_END: 127,
} as const;

export const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  COUNTRY_LIST_START: 64,
  COUNTRY_LIST_END: 83,
  COUNTRY_LIST_LENGTH: 84,
  IS_INCLUDED: 85,
  SCOPE_START: 86,
  SCOPE_END: 117,
  NULLIFIER_START: 118,
  NULLIFIER_END: 149,
} as const;

export const NULLIFIER_REGISTRY_ABI = [
  'function registerCircuit(bytes32 _circuitId, address _verifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
  'function updateCircuit(bytes32 _circuitId, address _newVerifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
  'function verifyAndRegister(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external returns (bool)',
  'function isNullifierUsed(bytes32 _nullifier) external view returns (bool)',
  'function getScope(bytes32 _nullifier) external view returns (bytes32)',
  'function getCircuit(bytes32 _nullifier) external view returns (bytes32)',
  'function verifyOnly(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
  'event CircuitRegistered(bytes32 indexed circuitId, address verifier)',
  'event CircuitUpdated(bytes32 indexed circuitId, address newVerifier)',
  'event NullifierRegistered(bytes32 indexed nullifier, bytes32 indexed scope, bytes32 indexed circuitId)',
];
