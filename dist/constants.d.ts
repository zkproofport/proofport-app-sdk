/**
 * ZKProofPort SDK Constants
 */
import type { CircuitType } from './types';
/**
 * Default deep link scheme
 */
export declare const DEFAULT_SCHEME = "zkproofport";
/**
 * Deep link hosts
 */
export declare const DEEP_LINK_HOSTS: {
    readonly PROOF_REQUEST: "proof-request";
    readonly PROOF_RESPONSE: "proof-response";
};
/**
 * Circuit metadata
 */
export declare const CIRCUIT_METADATA: Record<CircuitType, {
    name: string;
    description: string;
    publicInputsCount: number;
    publicInputNames: string[];
}>;
/**
 * Standard verifier contract ABI (shared across all circuits)
 */
export declare const VERIFIER_ABI: string[];
/**
 * RPC endpoints by chain ID
 */
export declare const RPC_ENDPOINTS: Record<number, string>;
/**
 * Request expiry time (default: 10 minutes)
 */
export declare const DEFAULT_REQUEST_EXPIRY_MS: number;
/**
 * Maximum QR code data size (bytes)
 */
export declare const MAX_QR_DATA_SIZE = 2953;
export declare const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT: {
    readonly SIGNAL_HASH_START: 0;
    readonly SIGNAL_HASH_END: 31;
    readonly MERKLE_ROOT_START: 32;
    readonly MERKLE_ROOT_END: 63;
    readonly SCOPE_START: 64;
    readonly SCOPE_END: 95;
    readonly NULLIFIER_START: 96;
    readonly NULLIFIER_END: 127;
};
export declare const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT: {
    readonly SIGNAL_HASH_START: 0;
    readonly SIGNAL_HASH_END: 31;
    readonly MERKLE_ROOT_START: 32;
    readonly MERKLE_ROOT_END: 63;
    readonly COUNTRY_LIST_START: 64;
    readonly COUNTRY_LIST_END: 83;
    readonly COUNTRY_LIST_LENGTH: 84;
    readonly IS_INCLUDED: 85;
    readonly SCOPE_START: 86;
    readonly SCOPE_END: 117;
    readonly NULLIFIER_START: 118;
    readonly NULLIFIER_END: 149;
};
export declare const NULLIFIER_REGISTRY_ABI: string[];
