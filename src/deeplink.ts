/**
 * Deep Link utilities for ZKProofport SDK
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
 * Generates a unique request ID for proof requests.
 *
 * Creates an ID by combining a base36-encoded timestamp with a random string,
 * prefixed with "req-". This ensures uniqueness across concurrent requests.
 *
 * @returns A unique string identifier in the format "req-{timestamp}-{random}"
 *
 * @example
 * ```typescript
 * const id = generateRequestId();
 * // "req-lh8k3f2g-a9b7c4d2"
 * ```
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `req-${timestamp}-${random}`;
}

/**
 * Encodes an object into a URL-safe base64url string with UTF-8 support.
 *
 * Converts the input object to JSON, then encodes it using base64url format
 * (RFC 4648 §5) which replaces '+' with '-', '/' with '_', and removes padding.
 * Works in both browser and Node.js environments.
 *
 * @param data - The object to encode (will be JSON stringified)
 * @returns Base64url-encoded string safe for URL parameters
 *
 * @example
 * ```typescript
 * const encoded = encodeData({ circuit: 'coinbase_attestation', requestId: 'req-123' });
 * // "eyJjaXJjdWl0IjoiY29pbmJhc2VfYXR0ZXN0YXRpb24iLCJyZXF1ZXN0SWQiOiJyZXEtMTIzIn0"
 * ```
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
 * Decodes a base64url-encoded string back into a typed object.
 *
 * Reverses the encoding process by converting base64url to standard base64,
 * decoding it, and parsing the resulting JSON. Handles UTF-8 correctly in
 * both browser and Node.js environments.
 *
 * @typeParam T - The expected type of the decoded object
 * @param encoded - Base64url-encoded string (from encodeData)
 * @returns Decoded and parsed object of type T
 *
 * @throws {SyntaxError} If the decoded string is not valid JSON
 *
 * @example
 * ```typescript
 * const request = decodeData<ProofRequest>(encodedString);
 * console.log(request.circuit); // "coinbase_attestation"
 * ```
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
 * Builds a deep link URL for a proof request.
 *
 * Encodes the proof request and constructs a deep link URL that can be opened
 * by the ZKProofport mobile app. The URL format is:
 * `{scheme}://proof-request?data={encodedRequest}`
 *
 * @param request - The proof request to encode in the deep link
 * @param scheme - Custom URL scheme (defaults to "zkproofport")
 * @returns Complete deep link URL ready to be opened or embedded in a QR code
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   requestId: generateRequestId(),
 *   circuit: 'coinbase_attestation',
 *   inputs: { userAddress: '0x123...' },
 *   callbackUrl: 'https://example.com/callback'
 * };
 * const url = buildProofRequestUrl(request);
 * // "zkproofport://proof-request?data=eyJyZXF1ZXN0SWQi..."
 * ```
 */
export function buildProofRequestUrl(
  request: ProofRequest,
  scheme: string = DEFAULT_SCHEME
): string {
  const encodedRequest = encodeData(request);
  return `${scheme}://${DEEP_LINK_HOSTS.PROOF_REQUEST}?data=${encodedRequest}`;
}

/**
 * Builds a callback URL with proof response data as query parameters.
 *
 * Appends proof response fields to the provided callback URL. For completed proofs,
 * includes proof data, public inputs, and nullifier. For errors, includes error message.
 *
 * @param callbackUrl - Base callback URL (from the original proof request)
 * @param response - Proof response containing status and optional proof data
 * @returns Complete callback URL with proof response as query parameters
 *
 * @example
 * ```typescript
 * const response: ProofResponse = {
 *   requestId: 'req-123',
 *   circuit: 'coinbase_attestation',
 *   status: 'completed',
 *   proof: '0x...',
 *   publicInputs: ['0x1', '0x2'],
 *   nullifier: '0xabc...'
 * };
 * const url = buildCallbackUrl('https://example.com/callback', response);
 * // "https://example.com/callback?requestId=req-123&status=completed&proof=0x...&publicInputs=0x1,0x2..."
 * ```
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
    if (response.nullifier) {
      url.searchParams.set('nullifier', response.nullifier);
    }
  } else if (response.status === 'error' && response.error) {
    url.searchParams.set('error', response.error);
  }

  return url.toString();
}

/**
 * Parses a proof request from a deep link URL.
 *
 * Extracts and decodes the proof request data from a ZKProofport deep link URL.
 * Returns null if the URL is invalid or missing required parameters.
 *
 * @param url - Deep link URL (e.g., "zkproofport://proof-request?data=...")
 * @returns Decoded ProofRequest object, or null if parsing fails
 *
 * @example
 * ```typescript
 * const url = "zkproofport://proof-request?data=eyJyZXF1ZXN0SWQi...";
 * const request = parseProofRequestUrl(url);
 * if (request) {
 *   console.log(request.circuit); // "coinbase_attestation"
 * }
 * ```
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
 * Parses a proof response from a callback URL.
 *
 * Extracts proof response data from query parameters in a callback URL.
 * Handles both successful proof completions and error responses.
 * Returns null if required parameters (requestId, status) are missing.
 *
 * @param url - Callback URL with proof response query parameters
 * @returns Decoded ProofResponse object, or null if parsing fails
 *
 * @example
 * ```typescript
 * const callbackUrl = "https://example.com/callback?requestId=req-123&status=completed&proof=0x...";
 * const response = parseProofResponseUrl(callbackUrl);
 * if (response && response.status === 'completed') {
 *   console.log(response.proof); // "0x..."
 * }
 * ```
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
      response.nullifier = urlObj.searchParams.get('nullifier') || undefined;
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
 * Parses a deep link URL into its component parts.
 *
 * Breaks down a custom scheme URL into scheme, host, path, and query parameters.
 * Useful for routing and handling different types of deep links.
 *
 * @param url - Custom scheme URL to parse (e.g., "zkproofport://proof-request?data=...")
 * @returns Object containing scheme, host, path, and params, or null if invalid
 *
 * @example
 * ```typescript
 * const url = "zkproofport://proof-request/verify?data=abc123";
 * const components = parseDeepLink(url);
 * // {
 * //   scheme: "zkproofport",
 * //   host: "proof-request",
 * //   path: "/verify",
 * //   params: { data: "abc123" }
 * // }
 * ```
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
 * Checks if a URL is a valid ZKProofport deep link.
 *
 * Performs a case-insensitive check to see if the URL starts with the
 * ZKProofport scheme. Does not validate the URL structure beyond the scheme.
 *
 * @param url - URL to check
 * @param scheme - Expected URL scheme (defaults to "zkproofport")
 * @returns True if the URL starts with the specified scheme
 *
 * @example
 * ```typescript
 * isProofportDeepLink("zkproofport://proof-request?data=..."); // true
 * isProofportDeepLink("https://example.com"); // false
 * isProofportDeepLink("ZKPROOFPORT://proof-request"); // true (case-insensitive)
 * ```
 */
export function isProofportDeepLink(
  url: string,
  scheme: string = DEFAULT_SCHEME
): boolean {
  return url.toLowerCase().startsWith(`${scheme.toLowerCase()}://`);
}

/**
 * Validates a proof request for completeness and correctness.
 *
 * Performs comprehensive validation including:
 * - Required fields (requestId, circuit, callbackUrl)
 * - Circuit type validity (must be a supported circuit)
 * - Circuit-specific input validation (e.g., userAddress format, countryList structure)
 * - Expiration check (if expiresAt is provided)
 *
 * Note: userAddress is optional for both circuits - the mobile app will prompt
 * for wallet connection if not provided.
 *
 * @param request - Proof request to validate
 * @returns Validation result with `valid` flag and optional `error` message
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   requestId: 'req-123',
 *   circuit: 'coinbase_attestation',
 *   inputs: { userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1' },
 *   callbackUrl: 'https://example.com/callback'
 * };
 * const result = validateProofRequest(request);
 * if (!result.valid) {
 *   console.error(result.error); // "Invalid userAddress format" / "Request has expired" / etc.
 * }
 * ```
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
    if (!inputs.countryList || !Array.isArray(inputs.countryList) || inputs.countryList.length === 0) {
      return { valid: false, error: 'countryList is required and must be a non-empty array' };
    }
    if (!inputs.countryList.every(c => typeof c === 'string')) {
      return { valid: false, error: 'countryList must contain only strings' };
    }
    if (typeof inputs.isIncluded !== 'boolean') {
      return { valid: false, error: 'isIncluded is required and must be a boolean' };
    }
  }

  // Check expiry
  if (request.expiresAt && Date.now() > request.expiresAt) {
    return { valid: false, error: 'Request has expired' };
  }

  return { valid: true };
}
