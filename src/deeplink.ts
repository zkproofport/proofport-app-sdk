/**
 * Deep Link utilities for ProofPort SDK
 */

import type {
  ProofRequest,
  ProofResponse,
  CircuitInputs,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  DeepLinkComponents,
  CircuitType,
} from './types';
import { DEFAULT_SCHEME, DEEP_LINK_HOSTS } from './constants';

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `req-${timestamp}-${random}`;
}

/**
 * Encode data for URL transmission (base64url with UTF-8 support)
 */
export function encodeData(data: object): string {
  const json = JSON.stringify(data);
  // Use base64url encoding (URL-safe) with UTF-8 support
  if (typeof btoa === 'function') {
    // Browser: UTF-8 encode first, then base64
    const utf8Encoded = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    );
    return btoa(utf8Encoded)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  // Node.js environment
  return Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode URL-transmitted data (base64url with UTF-8 support)
 */
export function decodeData<T>(encoded: string): T {
  // Restore base64 padding
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }

  let json: string;
  if (typeof atob === 'function') {
    // Browser: decode base64, then UTF-8 decode
    const decoded = atob(base64);
    json = decodeURIComponent(
      decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } else {
    json = Buffer.from(base64, 'base64').toString('utf-8');
  }

  return JSON.parse(json) as T;
}

/**
 * Build a proof request deep link URL
 */
export function buildProofRequestUrl(
  request: ProofRequest,
  scheme: string = DEFAULT_SCHEME
): string {
  const encodedRequest = encodeData(request);
  return `${scheme}://${DEEP_LINK_HOSTS.PROOF_REQUEST}?data=${encodedRequest}`;
}

/**
 * Build a callback URL with proof response
 */
export function buildCallbackUrl(
  callbackUrl: string,
  response: ProofResponse
): string {
  const url = new URL(callbackUrl);
  url.searchParams.set('requestId', response.requestId);
  url.searchParams.set('status', response.status);

  if (response.status === 'completed' && response.proof) {
    url.searchParams.set('proof', response.proof);
    if (response.publicInputs) {
      url.searchParams.set('publicInputs', response.publicInputs.join(','));
    }
    if (response.numPublicInputs !== undefined) {
      url.searchParams.set('numPublicInputs', response.numPublicInputs.toString());
    }
    if (response.timestamp) {
      url.searchParams.set('timestamp', response.timestamp.toString());
    }
  } else if (response.status === 'error' && response.error) {
    url.searchParams.set('error', response.error);
  }

  return url.toString();
}

/**
 * Parse a proof request from deep link URL
 */
export function parseProofRequestUrl(url: string): ProofRequest | null {
  try {
    const urlObj = new URL(url);
    const data = urlObj.searchParams.get('data');

    if (!data) {
      return null;
    }

    return decodeData<ProofRequest>(data);
  } catch (error) {
    console.error('Failed to parse proof request URL:', error);
    return null;
  }
}

/**
 * Parse a proof response from callback URL
 */
export function parseProofResponseUrl(url: string): ProofResponse | null {
  try {
    const urlObj = new URL(url);
    const requestId = urlObj.searchParams.get('requestId');
    const status = urlObj.searchParams.get('status') as ProofResponse['status'];

    if (!requestId || !status) {
      return null;
    }

    const response: ProofResponse = {
      requestId,
      circuit: urlObj.searchParams.get('circuit') as CircuitType || 'coinbase_attestation',
      status,
    };

    if (status === 'completed') {
      response.proof = urlObj.searchParams.get('proof') || undefined;
      const publicInputsStr = urlObj.searchParams.get('publicInputs');
      if (publicInputsStr) {
        response.publicInputs = publicInputsStr.split(',');
      }
      const numPublicInputs = urlObj.searchParams.get('numPublicInputs');
      if (numPublicInputs) {
        response.numPublicInputs = parseInt(numPublicInputs, 10);
      }
      const timestamp = urlObj.searchParams.get('timestamp');
      if (timestamp) {
        response.timestamp = parseInt(timestamp, 10);
      }
    } else if (status === 'error') {
      response.error = urlObj.searchParams.get('error') || undefined;
    }

    return response;
  } catch (error) {
    console.error('Failed to parse proof response URL:', error);
    return null;
  }
}

/**
 * Parse deep link URL into components
 */
export function parseDeepLink(url: string): DeepLinkComponents | null {
  try {
    // Handle custom scheme URLs
    const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
    if (!schemeMatch) {
      return null;
    }

    const scheme = schemeMatch[1];
    const rest = schemeMatch[2];

    // Parse host and path
    const [hostPath, queryString] = rest.split('?');
    const [host, ...pathParts] = hostPath.split('/');
    const path = '/' + pathParts.join('/');

    // Parse query parameters
    const params: Record<string, string> = {};
    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    }

    return { scheme, host, path, params };
  } catch (error) {
    console.error('Failed to parse deep link:', error);
    return null;
  }
}

/**
 * Check if URL is a ProofPort deep link
 */
export function isProofPortDeepLink(
  url: string,
  scheme: string = DEFAULT_SCHEME
): boolean {
  return url.toLowerCase().startsWith(`${scheme.toLowerCase()}://`);
}

/**
 * Validate proof request
 */
export function validateProofRequest(request: ProofRequest): { valid: boolean; error?: string } {
  if (!request.requestId) {
    return { valid: false, error: 'Missing requestId' };
  }

  if (!request.circuit) {
    return { valid: false, error: 'Missing circuit type' };
  }

  if (!['coinbase_attestation', 'coinbase_country_attestation'].includes(request.circuit)) {
    return { valid: false, error: `Invalid circuit type: ${request.circuit}` };
  }

  if (!request.callbackUrl) {
    return { valid: false, error: 'Missing callbackUrl' };
  }

  // Validate circuit-specific inputs
  if (request.circuit === 'coinbase_attestation') {
    // Coinbase KYC: userAddress is optional - app will connect wallet if not provided
    const inputs = request.inputs as CoinbaseKycInputs;
    if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
      return { valid: false, error: 'Invalid userAddress format' };
    }
    // If userAddress is not provided, app will prompt wallet connection - this is valid
  } else if (request.circuit === 'coinbase_country_attestation') {
    const inputs = request.inputs as CoinbaseCountryInputs;
    if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
      return { valid: false, error: 'Invalid userAddress format' };
    }
    if (inputs.countryList && !Array.isArray(inputs.countryList)) {
      return { valid: false, error: 'countryList must be an array of strings' };
    }
    if (inputs.countryList && !inputs.countryList.every(c => typeof c === 'string')) {
      return { valid: false, error: 'countryList must contain only strings' };
    }
  }

  // Check expiry
  if (request.expiresAt && Date.now() > request.expiresAt) {
    return { valid: false, error: 'Request has expired' };
  }

  return { valid: true };
}
