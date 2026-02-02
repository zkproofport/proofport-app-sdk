/**
 * Deep Link utilities for ZKProofPort SDK
 */
import type { ProofRequest, ProofResponse, DeepLinkComponents } from './types';
/**
 * Generate a unique request ID
 */
export declare function generateRequestId(): string;
/**
 * Encode data for URL transmission (base64url with UTF-8 support)
 */
export declare function encodeData(data: object): string;
/**
 * Decode URL-transmitted data (base64url with UTF-8 support)
 */
export declare function decodeData<T>(encoded: string): T;
/**
 * Build a proof request deep link URL
 */
export declare function buildProofRequestUrl(request: ProofRequest, scheme?: string): string;
/**
 * Build a callback URL with proof response
 */
export declare function buildCallbackUrl(callbackUrl: string, response: ProofResponse): string;
/**
 * Parse a proof request from deep link URL
 */
export declare function parseProofRequestUrl(url: string): ProofRequest | null;
/**
 * Parse a proof response from callback URL
 */
export declare function parseProofResponseUrl(url: string): ProofResponse | null;
/**
 * Parse deep link URL into components
 */
export declare function parseDeepLink(url: string): DeepLinkComponents | null;
/**
 * Check if URL is a ZKProofPort deep link
 */
export declare function isProofPortDeepLink(url: string, scheme?: string): boolean;
/**
 * Validate proof request
 */
export declare function validateProofRequest(request: ProofRequest): {
    valid: boolean;
    error?: string;
};
