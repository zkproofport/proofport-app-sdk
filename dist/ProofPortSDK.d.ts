/**
 * ProofPort SDK - Main class
 */
import type { ProofRequest, ProofResponse, CircuitType, CircuitInputs, CoinbaseKycInputs, CoinbaseCountryInputs, ProofPortConfig, QRCodeOptions } from './types';
/**
 * ZKProofPort SDK for requesting and verifying ZK proofs
 */
export declare class ProofPortSDK {
    private config;
    private pendingRequests;
    constructor(config?: ProofPortConfig);
    /**
     * Create a Coinbase KYC verification request
     */
    createCoinbaseKycRequest(inputs: CoinbaseKycInputs, options?: {
        callbackUrl?: string;
        message?: string;
        dappName?: string;
        dappIcon?: string;
        expiresInMs?: number;
    }): ProofRequest;
    /**
     * Create a Coinbase Country attestation request
     */
    createCoinbaseCountryRequest(inputs: CoinbaseCountryInputs, options?: {
        callbackUrl?: string;
        message?: string;
        dappName?: string;
        dappIcon?: string;
        expiresInMs?: number;
    }): ProofRequest;
    /**
     * Create a generic proof request
     */
    createProofRequest(circuit: CircuitType, inputs: CircuitInputs, options?: {
        callbackUrl?: string;
        message?: string;
        dappName?: string;
        dappIcon?: string;
        expiresInMs?: number;
    }): ProofRequest;
    /**
     * Generate deep link URL for a proof request
     */
    getDeepLinkUrl(request: ProofRequest): string;
    /**
     * Open ZKProofPort app with a proof request (browser)
     */
    openProofRequest(request: ProofRequest): void;
    /**
     * Request a proof — auto-detects platform.
     * Mobile: opens deep link directly.
     * Desktop: returns QR code data URL and deep link URL for display.
     */
    requestProof(request: ProofRequest, qrOptions?: QRCodeOptions): Promise<{
        deepLink: string;
        qrDataUrl?: string;
        mobile: boolean;
    }>;
    /**
     * Generate QR code as data URL
     */
    generateQRCode(request: ProofRequest, options?: QRCodeOptions): Promise<string>;
    /**
     * Generate QR code as SVG string
     */
    generateQRCodeSVG(request: ProofRequest, options?: QRCodeOptions): Promise<string>;
    /**
     * Render QR code to canvas element
     */
    renderQRCodeToCanvas(canvas: HTMLCanvasElement, request: ProofRequest, options?: QRCodeOptions): Promise<void>;
    /**
     * Check if request data fits in QR code
     */
    checkQRCodeSize(request: ProofRequest): {
        size: number;
        withinLimit: boolean;
    };
    /**
     * Parse proof response from callback URL
     */
    parseResponse(url: string): ProofResponse | null;
    /**
     * Check if a URL is a ZKProofPort response
     */
    isProofPortResponse(url: string): boolean;
    /**
     * Get pending request by ID
     */
    getPendingRequest(requestId: string): ProofRequest | undefined;
    /**
     * Clear pending request
     */
    clearPendingRequest(requestId: string): void;
    /**
     * Verify proof on-chain
     */
    verifyOnChain(circuit: CircuitType, proof: string, publicInputs: string[], providerOrSigner?: any): Promise<{
        valid: boolean;
        error?: string;
    }>;
    /**
     * Verify proof from response on-chain
     */
    verifyResponseOnChain(response: ProofResponse, providerOrSigner?: any): Promise<{
        valid: boolean;
        error?: string;
    }>;
    /**
     * Get verifier contract address
     */
    getVerifierAddress(circuit: CircuitType): string;
    /**
     * Get verifier chain ID
     */
    getVerifierChainId(circuit: CircuitType): number;
    /**
     * Get circuit metadata
     */
    getCircuitMetadata(circuit: CircuitType): {
        name: string;
        description: string;
        publicInputsCount: number;
        publicInputNames: string[];
    };
    /**
     * Get all supported circuits
     */
    getSupportedCircuits(): CircuitType[];
    /**
     * Validate a proof request
     */
    validateRequest(request: ProofRequest): {
        valid: boolean;
        error?: string;
    };
    /**
     * Check if URL is a ZKProofPort deep link
     */
    isProofPortDeepLink(url: string): boolean;
    /**
     * Parse proof request from deep link URL
     */
    parseDeepLink(url: string): ProofRequest | null;
    /**
     * Create SDK with default configuration
     */
    static create(config?: ProofPortConfig): ProofPortSDK;
    /**
     * Detect if running on a mobile device
     */
    static isMobile(): boolean;
}
export default ProofPortSDK;
