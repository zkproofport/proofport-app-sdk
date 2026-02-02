/**
 * ZKProofPort SDK Types
 */
/**
 * Supported circuit types
 */
export type CircuitType = 'coinbase_attestation' | 'coinbase_country_attestation';
/**
 * Proof request status
 */
export type ProofRequestStatus = 'pending' | 'completed' | 'error' | 'cancelled';
/**
 * Coinbase KYC input parameters
 * Note: userAddress is optional - if not provided, app will connect wallet automatically
 */
export interface CoinbaseKycInputs {
    userAddress?: string;
    rawTransaction?: string;
    scope: string;
}
/**
 * Coinbase Country attestation input parameters
 */
export interface CoinbaseCountryInputs {
    userAddress?: string;
    rawTransaction?: string;
    countryList?: string[];
    isIncluded?: boolean;
    scope: string;
}
/**
 * Empty inputs (for circuits that get all data from app)
 */
export interface EmptyInputs {
}
/**
 * Circuit-specific inputs union type
 */
export type CircuitInputs = CoinbaseKycInputs | CoinbaseCountryInputs | EmptyInputs;
/**
 * Proof request configuration
 */
export interface ProofRequest {
    /** Unique request identifier */
    requestId: string;
    /** Circuit type to use */
    circuit: CircuitType;
    /** Circuit-specific inputs */
    inputs: CircuitInputs;
    /** URL to return proof result */
    callbackUrl: string;
    /** Optional: Custom message to display in app */
    message?: string;
    /** Optional: Dapp name for display */
    dappName?: string;
    /** Optional: Dapp icon URL */
    dappIcon?: string;
    /** Timestamp when request was created */
    createdAt: number;
    /** Optional: Request expiry timestamp */
    expiresAt?: number;
}
/**
 * Proof response from the app
 */
export interface ProofResponse {
    /** Original request ID */
    requestId: string;
    /** Circuit type used */
    circuit: CircuitType;
    /** Request status */
    status: ProofRequestStatus;
    /** Proof hex string (if success) */
    proof?: string;
    /** Public inputs as hex strings (if success) */
    publicInputs?: string[];
    /** Number of public inputs */
    numPublicInputs?: number;
    /** Error message (if error) */
    error?: string;
    /** Timestamp when proof was generated */
    timestamp?: number;
    /** Verifier contract address (provided by app) */
    verifierAddress?: string;
    /** Chain ID where verifier is deployed (provided by app) */
    chainId?: number;
    /** Nullifier (if applicable) */
    nullifier?: string;
}
/**
 * Parsed proof data for on-chain verification
 */
export interface ParsedProof {
    /** Proof bytes (hex string with 0x prefix) */
    proofHex: string;
    /** Public inputs as hex strings */
    publicInputsHex: string[];
    /** Number of public inputs */
    numPublicInputs: number;
}
/**
 * QR code generation options
 */
export interface QRCodeOptions {
    /** QR code width in pixels */
    width?: number;
    /** Error correction level */
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    /** Margin around QR code */
    margin?: number;
    /** Dark color (foreground) */
    darkColor?: string;
    /** Light color (background) */
    lightColor?: string;
}
/**
 * Verifier contract information
 */
export interface VerifierContract {
    /** Contract address */
    address: string;
    /** Chain ID */
    chainId: number;
    /** ABI for verify function */
    abi: string[];
}
/**
 * SDK configuration
 */
export interface ProofPortConfig {
    /** Deep link scheme (default: zkproofport) */
    scheme?: string;
    /** Default callback URL */
    defaultCallbackUrl?: string;
    /** Custom verifier contracts */
    verifiers?: Partial<Record<CircuitType, VerifierContract>>;
}
/**
 * Deep link URL components
 */
export interface DeepLinkComponents {
    scheme: string;
    host: string;
    path: string;
    params: Record<string, string>;
}
