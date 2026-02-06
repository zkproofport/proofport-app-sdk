/**
 * ProofPort SDK - Main class
 */

import type {
  ProofRequest,
  ProofResponse,
  CircuitType,
  CircuitInputs,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  ProofPortConfig,
  QRCodeOptions,
  ParsedProof,
  VerifierContract,
} from './types';
import {
  generateRequestId,
  buildProofRequestUrl,
  buildCallbackUrl,
  parseProofRequestUrl,
  parseProofResponseUrl,
  validateProofRequest,
  isProofPortDeepLink,
} from './deeplink';
import {
  generateQRCodeDataUrl,
  generateQRCodeSVG,
  generateQRCodeToCanvas,
  estimateQRDataSize,
} from './qrcode';
import {
  verifyProofOnChain,
  parseProofForOnChain,
  getVerifierAddress,
  getVerifierChainId,
} from './verifier';
import {
  DEFAULT_SCHEME,
  DEFAULT_REQUEST_EXPIRY_MS,
  CIRCUIT_METADATA,
} from './constants';


/**
 * Main SDK class for interacting with the ZKProofPort mobile app.
 *
 * Provides methods for creating proof requests, generating QR codes and deep links,
 * verifying proofs on-chain, and handling proof responses from the mobile app.
 *
 * @example
 * ```typescript
 * import { ProofPortSDK } from '@zkproofport-app/sdk';
 *
 * // Initialize SDK with default callback URL
 * const sdk = new ProofPortSDK({
 *   defaultCallbackUrl: 'https://myapp.com/callback'
 * });
 *
 * // Create a Coinbase KYC proof request
 * const request = sdk.createCoinbaseKycRequest({
 *   scope: 'myapp.com'
 * });
 *
 * // Generate QR code for desktop users
 * const qrDataUrl = await sdk.generateQRCode(request);
 *
 * // Handle callback response
 * const response = sdk.parseResponse(callbackUrl);
 * if (response?.status === 'completed') {
 *   const result = await sdk.verifyResponseOnChain(response);
 *   console.log('Proof valid:', result.valid);
 * }
 * ```
 */
export class ProofPortSDK {
  private config: Required<ProofPortConfig>;
  private pendingRequests: Map<string, ProofRequest> = new Map();

  /**
   * Creates a new ProofPortSDK instance.
   *
   * @param config - SDK configuration options
   * @param config.scheme - Custom deep link scheme (default: 'zkproofport')
   * @param config.defaultCallbackUrl - Default callback URL for proof responses
   * @param config.verifiers - Custom verifier contract addresses per circuit
   *
   * @example
   * ```typescript
   * const sdk = new ProofPortSDK({
   *   defaultCallbackUrl: 'https://myapp.com/callback',
   *   verifiers: {
   *     coinbase_attestation: {
   *       verifierAddress: '0x...',
   *       chainId: 1
   *     }
   *   }
   * });
   * ```
   */
  constructor(config: ProofPortConfig = {}) {
    this.config = {
      scheme: config.scheme || DEFAULT_SCHEME,
      defaultCallbackUrl: config.defaultCallbackUrl || '',
      verifiers: config.verifiers || {},
    };
  }

  // ============ Request Creation ============

  /**
   * Creates a Coinbase KYC verification proof request.
   *
   * Generates a proof request for verifying Coinbase KYC status without revealing
   * the actual attestation data. The proof confirms the user has passed Coinbase KYC
   * while maintaining privacy through zero-knowledge proofs.
   *
   * @param inputs - Circuit inputs for Coinbase KYC
   * @param inputs.scope - Application-specific scope (e.g., domain name)
   * @param options - Request configuration options
   * @param options.callbackUrl - URL to redirect after proof generation (overrides default)
   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofPort app
   * @param options.dappIcon - Application icon URL shown in ZKProofPort app
   * @param options.expiresInMs - Request expiration time in milliseconds (default: 10 minutes)
   *
   * @returns ProofRequest object with unique requestId and all request details
   *
   * @throws Error if scope is not provided
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({
   *   scope: 'myapp.com'
   * }, {
   *   dappName: 'My DApp',
   *   message: 'Verify your KYC status to access this feature'
   * });
   *
   * const deepLink = sdk.getDeepLinkUrl(request);
   * ```
   */
  createCoinbaseKycRequest(
    inputs: CoinbaseKycInputs,
    options: {
      callbackUrl?: string;
      message?: string;
      dappName?: string;
      dappIcon?: string;
      expiresInMs?: number;
    } = {}
  ): ProofRequest {
    if (!inputs.scope) {
      throw new Error('scope is required for coinbase_attestation circuit');
    }

    const request: ProofRequest = {
      requestId: generateRequestId(),
      circuit: 'coinbase_attestation',
      inputs,
      callbackUrl: options.callbackUrl || this.config.defaultCallbackUrl,
      message: options.message,
      dappName: options.dappName,
      dappIcon: options.dappIcon,
      createdAt: Date.now(),
      expiresAt: Date.now() + (options.expiresInMs || DEFAULT_REQUEST_EXPIRY_MS),
    };

    this.pendingRequests.set(request.requestId, request);
    return request;
  }

  /**
   * Creates a Coinbase Country attestation proof request.
   *
   * Generates a proof request for verifying country eligibility through Coinbase
   * attestation without revealing the actual country data. The proof confirms the
   * user's country status while maintaining privacy through zero-knowledge proofs.
   *
   * @param inputs - Circuit inputs for Coinbase Country attestation
   * @param inputs.scope - Application-specific scope (e.g., domain name)
   * @param options - Request configuration options
   * @param options.callbackUrl - URL to redirect after proof generation (overrides default)
   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofPort app
   * @param options.dappIcon - Application icon URL shown in ZKProofPort app
   * @param options.expiresInMs - Request expiration time in milliseconds (default: 10 minutes)
   *
   * @returns ProofRequest object with unique requestId and all request details
   *
   * @throws Error if scope is not provided
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseCountryRequest({
   *   scope: 'myapp.com'
   * }, {
   *   dappName: 'My DApp',
   *   message: 'Verify your country eligibility'
   * });
   * ```
   */
  createCoinbaseCountryRequest(
    inputs: CoinbaseCountryInputs,
    options: {
      callbackUrl?: string;
      message?: string;
      dappName?: string;
      dappIcon?: string;
      expiresInMs?: number;
    } = {}
  ): ProofRequest {
    if (!inputs.scope) {
      throw new Error('scope is required for coinbase_country_attestation circuit');
    }
    if (!inputs.countryList || !Array.isArray(inputs.countryList) || inputs.countryList.length === 0) {
      throw new Error('countryList is required for coinbase_country_attestation circuit');
    }
    if (typeof inputs.isIncluded !== 'boolean') {
      throw new Error('isIncluded is required for coinbase_country_attestation circuit');
    }

    const request: ProofRequest = {
      requestId: generateRequestId(),
      circuit: 'coinbase_country_attestation',
      inputs,
      callbackUrl: options.callbackUrl || this.config.defaultCallbackUrl,
      message: options.message,
      dappName: options.dappName,
      dappIcon: options.dappIcon,
      createdAt: Date.now(),
      expiresAt: Date.now() + (options.expiresInMs || DEFAULT_REQUEST_EXPIRY_MS),
    };

    this.pendingRequests.set(request.requestId, request);
    return request;
  }

  /**
   * Creates a generic proof request for any supported circuit type.
   *
   * Routes to the appropriate circuit-specific request creation method based on
   * the circuit type. Use this for dynamic circuit selection or when the circuit
   * type is determined at runtime.
   *
   * @param circuit - Circuit type identifier ('coinbase_attestation' | 'coinbase_country_attestation')
   * @param inputs - Circuit-specific inputs
   * @param options - Request configuration options
   * @param options.callbackUrl - URL to redirect after proof generation (overrides default)
   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofPort app
   * @param options.dappIcon - Application icon URL shown in ZKProofPort app
   * @param options.expiresInMs - Request expiration time in milliseconds (default: 15 minutes)
   *
   * @returns ProofRequest object with unique requestId and all request details
   *
   * @throws Error if required inputs are missing for the specified circuit
   *
   * @example
   * ```typescript
   * const circuitType = userSelection; // Dynamic selection
   * const request = sdk.createProofRequest(
   *   circuitType,
   *   { scope: 'myapp.com' },
   *   { dappName: 'My DApp' }
   * );
   * ```
   */
  createProofRequest(
    circuit: CircuitType,
    inputs: CircuitInputs,
    options: {
      callbackUrl?: string;
      message?: string;
      dappName?: string;
      dappIcon?: string;
      expiresInMs?: number;
    } = {}
  ): ProofRequest {
    if (circuit === 'coinbase_country_attestation') {
      return this.createCoinbaseCountryRequest(inputs as CoinbaseCountryInputs, options);
    } else {
      return this.createCoinbaseKycRequest(inputs as CoinbaseKycInputs, options);
    }
  }

  // ============ Deep Link Generation ============

  /**
   * Generates a deep link URL for a proof request.
   *
   * Creates a zkproofport:// URL that opens the ZKProofPort mobile app with the
   * specified proof request. The URL contains all request details encoded as query
   * parameters.
   *
   * @param request - ProofRequest object to encode as deep link
   *
   * @returns Deep link URL string (e.g., 'zkproofport://proof?requestId=...')
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const url = sdk.getDeepLinkUrl(request);
   * // url: 'zkproofport://proof?requestId=abc123&circuit=coinbase_attestation&...'
   * ```
   */
  getDeepLinkUrl(request: ProofRequest): string {
    return buildProofRequestUrl(request, this.config.scheme);
  }

  /**
   * Opens the ZKProofPort mobile app with a proof request.
   *
   * Redirects the browser to the deep link URL, which opens the ZKProofPort app
   * if installed. Only works in mobile browser environments. For desktop, use
   * requestProof() to display a QR code instead.
   *
   * @param request - ProofRequest object to send to the app
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * if (ProofPortSDK.isMobile()) {
   *   sdk.openProofRequest(request); // Opens app directly
   * }
   * ```
   */
  openProofRequest(request: ProofRequest): void {
    const url = this.getDeepLinkUrl(request);
    window.location.href = url;
  }

  /**
   * Requests a proof with automatic platform detection.
   *
   * Detects whether the user is on mobile or desktop and automatically chooses
   * the appropriate flow:
   * - Mobile: Opens the deep link directly to launch the ZKProofPort app
   * - Desktop: Generates a QR code data URL for the user to scan
   *
   * @param request - ProofRequest object to send
   * @param qrOptions - QR code generation options (size, colors, logo) for desktop
   *
   * @returns Object containing deep link URL, optional QR code data URL, and platform detection result
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const result = await sdk.requestProof(request);
   *
   * if (result.mobile) {
   *   console.log('Opening app directly');
   * } else {
   *   // Display QR code for desktop users
   *   document.getElementById('qr').src = result.qrDataUrl;
   * }
   * ```
   */
  async requestProof(
    request: ProofRequest,
    qrOptions?: QRCodeOptions
  ): Promise<{ deepLink: string; qrDataUrl?: string; mobile: boolean }> {
    const deepLink = this.getDeepLinkUrl(request);
    const mobile = ProofPortSDK.isMobile();

    if (mobile) {
      window.location.href = deepLink;
      return { deepLink, mobile: true };
    }

    const qrDataUrl = await this.generateQRCode(request, qrOptions);
    return { deepLink, qrDataUrl, mobile: false };
  }

  // ============ QR Code Generation ============

  /**
   * Generates a QR code as a data URL for a proof request.
   *
   * Creates a PNG image data URL that can be directly set as an img src attribute.
   * Suitable for embedding QR codes in web pages for desktop users to scan with
   * their mobile device.
   *
   * @param requestOrUrl - ProofRequest object or deep link URL string
   * @param options - QR code customization options
   * @param options.size - QR code size in pixels (default: 256)
   * @param options.margin - Quiet zone margin in modules (default: 4)
   * @param options.darkColor - Color for dark modules (default: '#000000')
   * @param options.lightColor - Color for light modules (default: '#ffffff')
   * @param options.logoUrl - Optional center logo image URL
   * @param options.logoSize - Logo size as fraction of QR code (default: 0.2)
   *
   * @returns Promise resolving to PNG data URL (e.g., 'data:image/png;base64,...')
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const qrUrl = await sdk.generateQRCode(request, {
   *   size: 400,
   *   darkColor: '#1a1a1a',
   *   logoUrl: 'https://myapp.com/logo.png'
   * });
   * document.getElementById('qr-image').src = qrUrl;
   * ```
   */
  async generateQRCode(
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<string> {
    return generateQRCodeDataUrl(requestOrUrl, options, this.config.scheme);
  }

  /**
   * Generates a QR code as an SVG string for a proof request.
   *
   * Creates a scalable vector graphics representation of the QR code, ideal for
   * high-resolution displays or when vector format is preferred over raster images.
   *
   * @param requestOrUrl - ProofRequest object or deep link URL string
   * @param options - QR code customization options
   * @param options.size - QR code size in pixels (default: 256)
   * @param options.margin - Quiet zone margin in modules (default: 4)
   * @param options.darkColor - Color for dark modules (default: '#000000')
   * @param options.lightColor - Color for light modules (default: '#ffffff')
   *
   * @returns Promise resolving to SVG string
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const svgString = await sdk.generateQRCodeSVG(request);
   * document.getElementById('qr-container').innerHTML = svgString;
   * ```
   */
  async generateQRCodeSVG(
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<string> {
    return generateQRCodeSVG(requestOrUrl, options, this.config.scheme);
  }

  /**
   * Renders a QR code directly to an HTML canvas element.
   *
   * Draws the QR code onto the provided canvas element, useful for custom
   * rendering workflows or when you need direct canvas manipulation.
   *
   * @param canvas - HTML canvas element to render to
   * @param requestOrUrl - ProofRequest object or deep link URL string
   * @param options - QR code customization options
   * @param options.size - QR code size in pixels (default: 256)
   * @param options.margin - Quiet zone margin in modules (default: 4)
   * @param options.darkColor - Color for dark modules (default: '#000000')
   * @param options.lightColor - Color for light modules (default: '#ffffff')
   *
   * @returns Promise that resolves when rendering is complete
   *
   * @example
   * ```typescript
   * const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * await sdk.renderQRCodeToCanvas(canvas, request, { size: 400 });
   * ```
   */
  async renderQRCodeToCanvas(
    canvas: HTMLCanvasElement,
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<void> {
    return generateQRCodeToCanvas(canvas, requestOrUrl, options, this.config.scheme);
  }

  /**
   * Checks if a proof request fits within QR code size limits.
   *
   * Estimates the encoded data size and validates it against QR code capacity limits.
   * Useful for validating requests before generating QR codes, especially when
   * including large custom messages or metadata.
   *
   * @param requestOrUrl - ProofRequest object or deep link URL string
   *
   * @returns Object with size in bytes and whether it fits within limits
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const check = sdk.checkQRCodeSize(request);
   * if (!check.withinLimit) {
   *   console.warn(`Request too large: ${check.size} bytes`);
   * }
   * ```
   */
  checkQRCodeSize(requestOrUrl: ProofRequest | string): { size: number; withinLimit: boolean } {
    return estimateQRDataSize(requestOrUrl, this.config.scheme);
  }

  // ============ Response Handling ============

  /**
   * Parses a proof response from a callback URL.
   *
   * Extracts and decodes proof response data from the callback URL query parameters
   * after the user completes proof generation in the ZKProofPort app. The app
   * redirects to your callback URL with the proof data encoded as query parameters.
   *
   * @param url - Callback URL containing proof response data
   *
   * @returns ProofResponse object with status, proof data, and public inputs, or null if invalid
   *
   * @example
   * ```typescript
   * // In your callback endpoint handler
   * app.get('/callback', (req, res) => {
   *   const callbackUrl = req.url;
   *   const response = sdk.parseResponse(callbackUrl);
   *
   *   if (response?.status === 'completed') {
   *     console.log('Proof received:', response.proof);
   *     console.log('Public inputs:', response.publicInputs);
   *   } else if (response?.status === 'rejected') {
   *     console.log('User rejected the request');
   *   }
   * });
   * ```
   */
  parseResponse(url: string): ProofResponse | null {
    return parseProofResponseUrl(url);
  }

  /**
   * Checks if a URL is a ZKProofPort proof response callback.
   *
   * Validates whether the given URL contains the required query parameters for a
   * proof response. Useful for filtering and routing callback requests.
   *
   * @param url - URL to check
   *
   * @returns True if the URL appears to be a ZKProofPort response callback
   *
   * @example
   * ```typescript
   * app.get('/callback', (req, res) => {
   *   const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
   *   if (sdk.isProofPortResponse(fullUrl)) {
   *     const response = sdk.parseResponse(fullUrl);
   *     // Handle proof response
   *   }
   * });
   * ```
   */
  isProofPortResponse(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.has('requestId') && urlObj.searchParams.has('status');
    } catch {
      return false;
    }
  }

  /**
   * Retrieves a pending proof request by its ID.
   *
   * Looks up a previously created proof request from the SDK's internal cache.
   * Useful for validating callback responses and maintaining request state.
   *
   * @param requestId - Unique request identifier
   *
   * @returns ProofRequest object if found, undefined otherwise
   *
   * @example
   * ```typescript
   * app.get('/callback', (req, res) => {
   *   const response = sdk.parseResponse(req.url);
   *   const originalRequest = sdk.getPendingRequest(response.requestId);
   *
   *   if (originalRequest) {
   *     console.log('Original request:', originalRequest);
   *     sdk.clearPendingRequest(response.requestId);
   *   }
   * });
   * ```
   */
  getPendingRequest(requestId: string): ProofRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Clears a pending proof request from the internal cache.
   *
   * Removes a proof request from the SDK's pending requests map. Should be called
   * after successfully processing a proof response to prevent memory leaks.
   *
   * @param requestId - Unique request identifier to remove
   *
   * @example
   * ```typescript
   * app.get('/callback', (req, res) => {
   *   const response = sdk.parseResponse(req.url);
   *   if (response?.status === 'completed') {
   *     // Process proof...
   *     sdk.clearPendingRequest(response.requestId);
   *   }
   * });
   * ```
   */
  clearPendingRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
  }

  // ============ Verification ============

  /**
   * Verifies a zero-knowledge proof on-chain using the deployed verifier contract.
   *
   * Calls the Solidity verifier contract to cryptographically verify the proof's
   * validity. This ensures the proof was generated correctly and the public inputs
   * match the claimed values.
   *
   * @param circuit - Circuit type identifier
   * @param proof - Hex-encoded proof string from the ZKProofPort app
   * @param publicInputs - Array of hex-encoded public input strings
   * @param providerOrSigner - ethers v6 Provider or Signer (defaults to base mainnet public RPC)
   *
   * @returns Promise resolving to verification result with valid boolean and optional error message
   *
   * @example
   * ```typescript
   * import { ethers } from 'ethers';
   *
   * const response = sdk.parseResponse(callbackUrl);
   * if (response?.status === 'completed') {
   *   const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
   *   const result = await sdk.verifyOnChain(
   *     response.circuit,
   *     response.proof,
   *     response.publicInputs,
   *     provider
   *   );
   *
   *   if (result.valid) {
   *     console.log('Proof verified on-chain!');
   *   } else {
   *     console.error('Verification failed:', result.error);
   *   }
   * }
   * ```
   */
  async verifyOnChain(
    circuit: CircuitType,
    proof: string,
    publicInputs: string[],
    providerOrSigner?: any
  ): Promise<{ valid: boolean; error?: string }> {
    const parsedProof = parseProofForOnChain(
      proof,
      publicInputs,
      publicInputs.length
    );

    const customVerifier = this.config.verifiers[circuit];
    return verifyProofOnChain(circuit, parsedProof, providerOrSigner, customVerifier);
  }

  /**
   * Verifies a proof response on-chain using the deployed verifier contract.
   *
   * Convenience method that extracts proof data from a ProofResponse object and
   * verifies it on-chain. Automatically handles incomplete or rejected responses.
   *
   * @param response - ProofResponse object from parseResponse()
   * @param providerOrSigner - ethers v6 Provider or Signer (defaults to base mainnet public RPC)
   *
   * @returns Promise resolving to verification result with valid boolean and optional error message
   *
   * @example
   * ```typescript
   * import { ethers } from 'ethers';
   *
   * app.get('/callback', async (req, res) => {
   *   const response = sdk.parseResponse(req.url);
   *
   *   if (response?.status === 'completed') {
   *     const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
   *     const result = await sdk.verifyResponseOnChain(response, provider);
   *
   *     if (result.valid) {
   *       // Grant access to user
   *       res.json({ success: true, verified: true });
   *     } else {
   *       res.status(400).json({ error: result.error });
   *     }
   *   } else {
   *     res.status(400).json({ error: 'Proof generation failed or rejected' });
   *   }
   * });
   * ```
   */
  async verifyResponseOnChain(
    response: ProofResponse,
    providerOrSigner?: any
  ): Promise<{ valid: boolean; error?: string }> {
    if (response.status !== 'completed' || !response.proof || !response.publicInputs) {
      return { valid: false, error: 'Invalid or incomplete response' };
    }

    const parsedProof = parseProofForOnChain(
      response.proof,
      response.publicInputs,
      response.publicInputs.length
    );

    const customVerifier = this.config.verifiers[response.circuit];
    const responseVerifier = {
      verifierAddress: response.verifierAddress,
      chainId: response.chainId,
    };
    return verifyProofOnChain(response.circuit, parsedProof, providerOrSigner, customVerifier, responseVerifier);
  }

  // ============ Utility Methods ============

  /**
   * Gets the deployed verifier contract address for a circuit.
   *
   * Returns the Ethereum address of the Solidity verifier contract for the
   * specified circuit. Uses custom verifier if configured, otherwise returns
   * the default deployed address.
   *
   * @param circuit - Circuit type identifier
   *
   * @returns Ethereum address of the verifier contract (0x...)
   *
   * @example
   * ```typescript
   * const address = sdk.getVerifierAddress('coinbase_attestation');
   * console.log('Verifier deployed at:', address);
   * ```
   */
  getVerifierAddress(circuit: CircuitType): string {
    const customVerifier = this.config.verifiers[circuit];
    return getVerifierAddress(circuit, customVerifier);
  }

  /**
   * Gets the blockchain chain ID where the verifier contract is deployed.
   *
   * Returns the EIP-155 chain ID for the network where the verifier contract
   * is deployed. Uses custom verifier if configured, otherwise returns the
   * default chain ID (Base mainnet: 8453).
   *
   * @param circuit - Circuit type identifier
   *
   * @returns Chain ID number (e.g., 8453 for Base mainnet)
   *
   * @example
   * ```typescript
   * const chainId = sdk.getVerifierChainId('coinbase_attestation');
   * console.log('Verifier on chain:', chainId); // 8453 (Base mainnet)
   * ```
   */
  getVerifierChainId(circuit: CircuitType): number {
    const customVerifier = this.config.verifiers[circuit];
    return getVerifierChainId(circuit, customVerifier);
  }

  /**
   * Gets metadata for a specific circuit type.
   *
   * Returns circuit metadata including display name, description, required inputs,
   * and other configuration details.
   *
   * @param circuit - Circuit type identifier
   *
   * @returns Circuit metadata object with name, description, and configuration
   *
   * @example
   * ```typescript
   * const metadata = sdk.getCircuitMetadata('coinbase_attestation');
   * console.log('Circuit name:', metadata.name);
   * console.log('Description:', metadata.description);
   * ```
   */
  getCircuitMetadata(circuit: CircuitType) {
    return CIRCUIT_METADATA[circuit];
  }

  /**
   * Gets all supported circuit types.
   *
   * Returns an array of all circuit type identifiers that are currently supported
   * by the SDK and ZKProofPort app.
   *
   * @returns Array of supported circuit type identifiers
   *
   * @example
   * ```typescript
   * const circuits = sdk.getSupportedCircuits();
   * console.log('Supported circuits:', circuits);
   * // ['coinbase_attestation', 'coinbase_country_attestation']
   * ```
   */
  getSupportedCircuits(): CircuitType[] {
    return Object.keys(CIRCUIT_METADATA) as CircuitType[];
  }

  /**
   * Validates a proof request for completeness and correctness.
   *
   * Checks that the proof request contains all required fields and that the
   * circuit-specific inputs are valid. Useful for catching configuration errors
   * before generating QR codes or sending requests to users.
   *
   * @param request - ProofRequest object to validate
   *
   * @returns Validation result with valid boolean and optional error message
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * const validation = sdk.validateRequest(request);
   *
   * if (!validation.valid) {
   *   console.error('Invalid request:', validation.error);
   * }
   * ```
   */
  validateRequest(request: ProofRequest): { valid: boolean; error?: string } {
    return validateProofRequest(request);
  }

  /**
   * Checks if a URL is a ZKProofPort deep link.
   *
   * Validates whether the given URL uses the ZKProofPort deep link scheme
   * (zkproofport:// by default) and has the correct format for a proof request.
   *
   * @param url - URL string to check
   *
   * @returns True if the URL is a valid ZKProofPort deep link
   *
   * @example
   * ```typescript
   * const url = 'zkproofport://proof?requestId=abc123&circuit=coinbase_attestation';
   * if (sdk.isProofPortDeepLink(url)) {
   *   const request = sdk.parseDeepLink(url);
   *   console.log('Parsed request:', request);
   * }
   * ```
   */
  isProofPortDeepLink(url: string): boolean {
    return isProofPortDeepLink(url, this.config.scheme);
  }

  /**
   * Parses a proof request from a deep link URL.
   *
   * Extracts and decodes the proof request data from a zkproofport:// deep link URL.
   * Useful for handling deep link navigation in web applications or validating
   * deep link URLs before displaying QR codes.
   *
   * @param url - ZKProofPort deep link URL string
   *
   * @returns ProofRequest object with all request details, or null if invalid
   *
   * @example
   * ```typescript
   * const deepLink = 'zkproofport://proof?requestId=abc123&circuit=coinbase_attestation&...';
   * const request = sdk.parseDeepLink(deepLink);
   *
   * if (request) {
   *   console.log('Request ID:', request.requestId);
   *   console.log('Circuit:', request.circuit);
   * }
   * ```
   */
  parseDeepLink(url: string): ProofRequest | null {
    return parseProofRequestUrl(url);
  }

  // ============ Static Factory ============

  /**
   * Creates a new ProofPortSDK instance with default configuration.
   *
   * Static factory method for creating SDK instances. Equivalent to using
   * the constructor directly, but provides a more functional API style.
   *
   * @param config - Optional SDK configuration
   *
   * @returns New ProofPortSDK instance
   *
   * @example
   * ```typescript
   * const sdk = ProofPortSDK.create({
   *   defaultCallbackUrl: 'https://myapp.com/callback'
   * });
   * ```
   */
  static create(config?: ProofPortConfig): ProofPortSDK {
    return new ProofPortSDK(config);
  }

  /**
   * Detects if the code is running on a mobile device.
   *
   * Uses user agent detection to determine if the current environment is a mobile
   * browser. This helps the SDK automatically choose between direct deep link
   * navigation (mobile) and QR code display (desktop).
   *
   * @returns True if running on a mobile device (iOS, Android, etc.)
   *
   * @example
   * ```typescript
   * if (ProofPortSDK.isMobile()) {
   *   // Open deep link directly
   *   sdk.openProofRequest(request);
   * } else {
   *   // Show QR code
   *   const qr = await sdk.generateQRCode(request);
   *   displayQRCode(qr);
   * }
   * ```
   */
  static isMobile(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }
}

export default ProofPortSDK;
