/**
 * Proofport SDK - Main class
 */

import type {
  ProofRequest,
  ProofResponse,
  CircuitType,
  CircuitInputs,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  ProofportConfig,
  QRCodeOptions,
  ParsedProof,
  VerifierContract,
  AuthCredentials,
  AuthToken,
  RelayProofRequest,
  RelayProofResult,
} from './types';
import {
  generateRequestId,
  buildProofRequestUrl,
  buildCallbackUrl,
  parseProofRequestUrl,
  parseProofResponseUrl,
  validateProofRequest,
  isProofportDeepLink,
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
  getDefaultProvider,
  extractNullifierFromPublicInputs,
  extractScopeFromPublicInputs,
  isNullifierRegistered,
  getNullifierInfo,
} from './verifier';
import {
  DEFAULT_SCHEME,
  DEFAULT_REQUEST_EXPIRY_MS,
  CIRCUIT_METADATA,
  RELAY_URLS,
} from './constants';
import type { SDKEnvironment } from './types';


/**
 * Main SDK class for interacting with the ZKProofport mobile app.
 *
 * Provides methods for creating proof requests, generating QR codes and deep links,
 * verifying proofs on-chain, and handling proof responses from the mobile app.
 *
 * @example
 * ```typescript
 * import { ProofportSDK } from '@zkproofport-app/sdk';
 *
 * // Initialize SDK (uses production relay by default)
 * const sdk = ProofportSDK.create();
 *
 * // Authenticate
 * await sdk.login({ clientId: 'your-id', apiKey: 'your-key' });
 *
 * // Create proof request via relay
 * const relay = await sdk.createRelayRequest('coinbase_attestation', {
 *   scope: 'myapp.com'
 * });
 *
 * // Generate QR code for desktop users
 * const qrDataUrl = await sdk.generateQRCode(relay.deepLink);
 *
 * // Wait for proof via WebSocket (primary) or polling (fallback)
 * const result = await sdk.waitForProof(relay.requestId);
 * if (result.status === 'completed') {
 *   console.log('Proof received:', result.proof);
 * }
 * ```
 */
export class ProofportSDK {
  private config: Required<Omit<ProofportConfig, 'relayUrl' | 'nullifierRegistry'>>;
  private pendingRequests: Map<string, ProofRequest> = new Map();
  private authToken: AuthToken | null = null;
  private relayUrl: string;
  private nullifierRegistry?: { address: string; chainId: number };
  private socket: any = null;

  /**
   * Creates a new ProofportSDK instance.
   *
   * For most use cases, prefer the static factory with environment presets:
   * ```typescript
   * const sdk = ProofportSDK.create('production');
   * ```
   *
   * @param config - SDK configuration options
   * @param config.scheme - Custom deep link scheme (default: 'zkproofport')
   * @param config.relayUrl - Relay server URL (required for relay features)
   * @param config.verifiers - Custom verifier contract addresses per circuit
   *
   * @example
   * ```typescript
   * const sdk = new ProofportSDK({
   *   relayUrl: 'https://relay.zkproofport.app',
   *   verifiers: {
   *     coinbase_attestation: {
   *       verifierAddress: '0x...',
   *       chainId: 1
   *     }
   *   }
   * });
   * ```
   */
  constructor(config: ProofportConfig = {}) {
    this.config = {
      scheme: config.scheme || DEFAULT_SCHEME,
      verifiers: config.verifiers || {},
    };
    this.relayUrl = config.relayUrl || '';
    this.nullifierRegistry = config.nullifierRegistry;
  }

  // ============ Request Creation ============

  /**
   * @internal
   * Creates a Coinbase KYC verification proof request.
   *
   * Generates a proof request for verifying Coinbase KYC status without revealing
   * the actual attestation data. The proof confirms the user has passed Coinbase KYC
   * while maintaining privacy through zero-knowledge proofs.
   *
   * @param inputs - Circuit inputs for Coinbase KYC
   * @param inputs.scope - Application-specific scope (e.g., domain name)
   * @param options - Request configuration options

   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofport app
   * @param options.dappIcon - Application icon URL shown in ZKProofport app
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
  private createCoinbaseKycRequest(
    inputs: CoinbaseKycInputs,
    options: {
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
   * @internal
   * Creates a Coinbase Country attestation proof request.
   *
   * Generates a proof request for verifying country eligibility through Coinbase
   * attestation without revealing the actual country data. The proof confirms the
   * user's country status while maintaining privacy through zero-knowledge proofs.
   *
   * @param inputs - Circuit inputs for Coinbase Country attestation
   * @param inputs.scope - Application-specific scope (e.g., domain name)
   * @param options - Request configuration options

   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofport app
   * @param options.dappIcon - Application icon URL shown in ZKProofport app
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
  private createCoinbaseCountryRequest(
    inputs: CoinbaseCountryInputs,
    options: {
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
   * @internal
   * Creates a generic proof request for any supported circuit type.
   *
   * Routes to the appropriate circuit-specific request creation method based on
   * the circuit type. Use this for dynamic circuit selection or when the circuit
   * type is determined at runtime.
   *
   * @param circuit - Circuit type identifier ('coinbase_attestation' | 'coinbase_country_attestation')
   * @param inputs - Circuit-specific inputs
   * @param options - Request configuration options

   * @param options.message - Custom message to display to user
   * @param options.dappName - Application name shown in ZKProofport app
   * @param options.dappIcon - Application icon URL shown in ZKProofport app
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
  private createProofRequest(
    circuit: CircuitType,
    inputs: CircuitInputs,
    options: {
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
   * @internal
   * Generates a deep link URL for a proof request.
   *
   * Creates a zkproofport:// URL that opens the ZKProofport mobile app with the
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
  private getDeepLinkUrl(request: ProofRequest): string {
    return buildProofRequestUrl(request, this.config.scheme);
  }

  /**
   * @internal
   * Opens the ZKProofport mobile app with a proof request.
   *
   * Redirects the browser to the deep link URL, which opens the ZKProofport app
   * if installed. Only works in mobile browser environments. For desktop, use
   * requestProof() to display a QR code instead.
   *
   * @param request - ProofRequest object to send to the app
   *
   * @example
   * ```typescript
   * const request = sdk.createCoinbaseKycRequest({ scope: 'myapp.com' });
   * if (ProofportSDK.isMobile()) {
   *   sdk.openProofRequest(request); // Opens app directly
   * }
   * ```
   */
  private openProofRequest(request: ProofRequest): void {
    const url = this.getDeepLinkUrl(request);
    window.location.href = url;
  }

  /**
   * @internal
   * Requests a proof with automatic platform detection.
   *
   * Detects whether the user is on mobile or desktop and automatically chooses
   * the appropriate flow:
   * - Mobile: Opens the deep link directly to launch the ZKProofport app
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
  private async requestProof(
    request: ProofRequest,
    qrOptions?: QRCodeOptions
  ): Promise<{ deepLink: string; qrDataUrl?: string; mobile: boolean }> {
    const deepLink = this.getDeepLinkUrl(request);
    const mobile = ProofportSDK.isMobile();

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
   * @internal
   * Parses a proof response from a callback URL.
   *
   * Extracts and decodes proof response data from the callback URL query parameters
   * after the user completes proof generation in the ZKProofport app. The app
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
  private parseResponse(url: string): ProofResponse | null {
    return parseProofResponseUrl(url);
  }

  /**
   * @internal
   * Checks if a URL is a ZKProofport proof response callback.
   *
   * Validates whether the given URL contains the required query parameters for a
   * proof response. Useful for filtering and routing callback requests.
   *
   * @param url - URL to check
   *
   * @returns True if the URL appears to be a ZKProofport response callback
   *
   * @example
   * ```typescript
   * app.get('/callback', (req, res) => {
   *   const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
   *   if (sdk.isProofportResponse(fullUrl)) {
   *     const response = sdk.parseResponse(fullUrl);
   *     // Handle proof response
   *   }
   * });
   * ```
   */
  private isProofportResponse(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.has('requestId') && urlObj.searchParams.has('status');
    } catch {
      return false;
    }
  }

  /**
   * @internal
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
  private getPendingRequest(requestId: string): ProofRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * @internal
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
  private clearPendingRequest(requestId: string): void {
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
   * @param proof - Hex-encoded proof string from the ZKProofport app
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
   * by the SDK and ZKProofport app.
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
   * @internal
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
  private validateRequest(request: ProofRequest): { valid: boolean; error?: string } {
    return validateProofRequest(request);
  }

  /**
   * @internal
   * Checks if a URL is a ZKProofport deep link.
   *
   * Validates whether the given URL uses the ZKProofport deep link scheme
   * (zkproofport:// by default) and has the correct format for a proof request.
   *
   * @param url - URL string to check
   *
   * @returns True if the URL is a valid ZKProofport deep link
   *
   * @example
   * ```typescript
   * const url = 'zkproofport://proof?requestId=abc123&circuit=coinbase_attestation';
   * if (sdk.isProofportDeepLink(url)) {
   *   const request = sdk.parseDeepLink(url);
   *   console.log('Parsed request:', request);
   * }
   * ```
   */
  private isProofportDeepLink(url: string): boolean {
    return isProofportDeepLink(url, this.config.scheme);
  }

  /**
   * @internal
   * Parses a proof request from a deep link URL.
   *
   * Extracts and decodes the proof request data from a zkproofport:// deep link URL.
   * Useful for handling deep link navigation in web applications or validating
   * deep link URLs before displaying QR codes.
   *
   * @param url - ZKProofport deep link URL string
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
  private parseDeepLink(url: string): ProofRequest | null {
    return parseProofRequestUrl(url);
  }

  // ============ Static Factory ============

  /**
   * Creates a new ProofportSDK instance with environment preset or custom config.
   * Defaults to `'production'` if no argument is provided.
   *
   * **Recommended usage** — use the default production relay:
   * ```typescript
   * const sdk = ProofportSDK.create();
   * ```
   *
   * Environment presets:
   * - `'production'` — relay.zkproofport.app (default)
   * - `'staging'` — stg-relay.zkproofport.app
   * - `'local'` — localhost:4001
   *
   * @param envOrConfig - Environment name or custom SDK configuration
   *
   * @returns New ProofportSDK instance
   *
   * @example
   * ```typescript
   * // Environment preset (recommended)
   * const sdk = ProofportSDK.create(); // production (default)
   * const sdk = ProofportSDK.create('staging');
   *
   * // Custom config
   * const sdk = ProofportSDK.create({
   *   relayUrl: 'https://my-custom-relay.example.com',
   * });
   * ```
   */
  static create(envOrConfig?: SDKEnvironment | ProofportConfig): ProofportSDK {
    if (typeof envOrConfig === 'undefined') {
      return new ProofportSDK({ relayUrl: RELAY_URLS.production });
    }
    if (typeof envOrConfig === 'string') {
      const relayUrl = RELAY_URLS[envOrConfig];
      if (!relayUrl) {
        throw new Error(`Unknown environment: ${envOrConfig}. Use 'production', 'staging', or 'local'.`);
      }
      return new ProofportSDK({ relayUrl });
    }
    return new ProofportSDK(envOrConfig);
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
   * if (ProofportSDK.isMobile()) {
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

  /**
   * Authenticates with ZKProofport using client credentials via the relay server.
   *
   * Exchanges a client_id and api_key pair for a short-lived JWT token
   * that can be used to authenticate relay requests.
   *
   * @param credentials - Client ID and API key
   * @param relayUrl - Relay server URL (e.g., 'https://relay.zkproofport.app')
   * @returns Promise resolving to AuthToken with JWT token and metadata
   * @throws Error if authentication fails
   *
   * @example
   * ```typescript
   * const auth = await ProofportSDK.authenticate(
   *   { clientId: 'your-client-id', apiKey: 'your-api-key' },
   *   'https://relay.zkproofport.app'
   * );
   * console.log('Token:', auth.token);
   * console.log('Expires in:', auth.expiresIn, 'seconds');
   * ```
   */
  static async authenticate(
    credentials: AuthCredentials,
    relayUrl: string
  ): Promise<AuthToken> {
    if (!credentials.clientId || !credentials.apiKey) {
      throw new Error('clientId and apiKey are required');
    }
    if (!relayUrl) {
      throw new Error('relayUrl is required');
    }

    const response = await fetch(`${relayUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: credentials.clientId,
        api_key: credentials.apiKey,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Authentication failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      token: data.token,
      clientId: data.client_id,
      dappId: data.dapp_id,
      tier: data.tier,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
  }

  /**
   * Checks if an auth token is still valid (not expired).
   *
   * @param auth - AuthToken to check
   * @returns True if the token has not expired
   *
   * @example
   * ```typescript
   * if (!ProofportSDK.isTokenValid(auth)) {
   *   auth = await ProofportSDK.authenticate(credentials, relayUrl);
   * }
   * ```
   */
  static isTokenValid(auth: AuthToken): boolean {
    return Date.now() < auth.expiresAt - 30000; // 30s buffer
  }

  // ============ Relay Integration ============

  /**
   * Authenticates with ZKProofport and stores the token for relay requests.
   *
   * Instance method that authenticates via the relay server and stores
   * the JWT token internally, so subsequent relay requests are automatically authenticated.
   *
   * @param credentials - Client ID and API key
   * @returns Promise resolving to AuthToken
   * @throws Error if authentication fails or relayUrl is not configured
   *
   * @example
   * ```typescript
   * const sdk = ProofportSDK.create('production');
   *
   * await sdk.login({ clientId: 'your-id', apiKey: 'your-key' });
   * // SDK is now authenticated for relay requests
   * ```
   */
  async login(credentials: AuthCredentials): Promise<AuthToken> {
    if (!this.relayUrl) {
      throw new Error('relayUrl is required for authentication. Use ProofportSDK.create(\'production\') or set relayUrl in config.');
    }
    this.authToken = await ProofportSDK.authenticate(credentials, this.relayUrl);
    return this.authToken;
  }

  /**
   * Logs out by clearing the stored authentication token.
   */
  logout(): void {
    this.authToken = null;
  }

  /**
   * Returns whether the SDK instance is currently authenticated with a valid token.
   */
  isAuthenticated(): boolean {
    return this.authToken !== null && ProofportSDK.isTokenValid(this.authToken);
  }

  /**
   * Returns the current auth token, or null if not authenticated.
   */
  getAuthToken(): AuthToken | null {
    return this.authToken;
  }

  /**
   * Creates a proof request through the relay server.
   *
   * This is the recommended way to create proof requests. The relay server:
   * - Issues a server-side requestId (validated by the mobile app)
   * - Tracks request status in Redis
   * - Handles credit deduction and tier enforcement
   * - Builds the deep link with relay callback URL
   *
   * @param circuit - Circuit type identifier
   * @param inputs - Circuit-specific inputs
   * @param options - Request options (message, dappName, dappIcon, nonce)
   * @returns Promise resolving to RelayProofRequest with requestId, deepLink, pollUrl
   * @throws Error if not authenticated or relay request fails
   *
   * @example
   * ```typescript
   * const sdk = ProofportSDK.create();
   * await sdk.login({ clientId: 'id', apiKey: 'key' });
   *
   * const relay = await sdk.createRelayRequest('coinbase_attestation', {
   *   scope: 'myapp.com'
   * }, { dappName: 'My DApp' });
   *
   * // Generate QR code from relay deep link
   * const qr = await sdk.generateQRCode(relay.deepLink);
   *
   * // Wait for proof (WebSocket primary, polling fallback)
   * const result = await sdk.waitForProof(relay.requestId);
   * ```
   */
  async createRelayRequest(
    circuit: CircuitType,
    inputs: CircuitInputs,
    options: {
      message?: string;
      dappName?: string;
      dappIcon?: string;
      nonce?: string;
    } = {}
  ): Promise<RelayProofRequest> {
    if (!this.authToken || !ProofportSDK.isTokenValid(this.authToken)) {
      throw new Error('Not authenticated. Call login() first.');
    }
    if (!this.relayUrl) {
      throw new Error('relayUrl is required. Set it in ProofportSDK config.');
    }

    const body: Record<string, unknown> = {
      circuitId: circuit,
      inputs,
    };
    if (options.message) body.message = options.message;
    if (options.dappName) body.dappName = options.dappName;
    if (options.dappIcon) body.dappIcon = options.dappIcon;
    if (options.nonce) body.nonce = options.nonce;

    const response = await fetch(`${this.relayUrl}/api/v1/proof/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Relay request failed: HTTP ${response.status}`);
    }

    return await response.json() as RelayProofRequest;
  }

  /**
   * Polls the relay for proof result status.
   *
   * @param requestId - The relay-issued request ID
   * @returns Promise resolving to RelayProofResult
   * @throws Error if relay URL not configured or request not found
   *
   * @example
   * ```typescript
   * const result = await sdk.pollResult(relay.requestId);
   * if (result.status === 'completed') {
   *   console.log('Proof:', result.proof);
   *   console.log('Public inputs:', result.publicInputs);
   * }
   * ```
   */
  async pollResult(requestId: string): Promise<RelayProofResult> {
    if (!this.relayUrl) {
      throw new Error('relayUrl is required. Set it in ProofportSDK config.');
    }

    const response = await fetch(`${this.relayUrl}/api/v1/proof/${requestId}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Request not found or expired');
      }
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Poll failed: HTTP ${response.status}`);
    }

    return await response.json() as RelayProofResult;
  }

  /**
   * Polls the relay until proof is completed or failed, with configurable interval and timeout.
   *
   * @param requestId - The relay-issued request ID
   * @param options - Polling options
   * @param options.intervalMs - Polling interval in milliseconds (default: 2000)
   * @param options.timeoutMs - Maximum polling time in milliseconds (default: 300000 = 5 min)
   * @param options.onStatusChange - Callback when status changes
   * @returns Promise resolving to final RelayProofResult
   * @throws Error if timeout or relay error
   */
  async waitForResult(
    requestId: string,
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      onStatusChange?: (result: RelayProofResult) => void;
    } = {}
  ): Promise<RelayProofResult> {
    const interval = options.intervalMs || 2000;
    const timeout = options.timeoutMs || 300000;
    const startTime = Date.now();
    let lastStatus = '';

    while (Date.now() - startTime < timeout) {
      const result = await this.pollResult(requestId);

      if (result.status !== lastStatus) {
        lastStatus = result.status;
        options.onStatusChange?.(result);
      }

      if (result.status === 'completed' || result.status === 'failed') {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Polling timed out after ${timeout}ms`);
  }

  /**
   * Subscribes to real-time proof status updates via Socket.IO.
   *
   * This is the recommended way to receive proof results. Uses WebSocket
   * connection for instant delivery instead of polling.
   *
   * Requires `socket.io-client` package: `npm install socket.io-client`
   *
   * @param requestId - The relay-issued request ID to subscribe to
   * @param callbacks - Event callbacks for status changes and results
   * @param callbacks.onStatus - Called on status updates (pending, generating)
   * @param callbacks.onResult - Called when proof is completed or failed
   * @param callbacks.onError - Called on errors
   * @returns Unsubscribe function to clean up the connection
   * @throws Error if not authenticated, relayUrl not set, or socket.io-client not installed
   *
   * @example
   * ```typescript
   * const relay = await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' });
   * const qr = await sdk.generateQRCode(relay.deepLink);
   *
   * const unsubscribe = await sdk.subscribe(relay.requestId, {
   *   onResult: (result) => {
   *     if (result.status === 'completed') {
   *       console.log('Proof received!', result.proof);
   *     }
   *   },
   *   onError: (error) => console.error('Error:', error),
   * });
   *
   * // Later: clean up
   * unsubscribe();
   * ```
   */
  async subscribe(
    requestId: string,
    callbacks: {
      onStatus?: (data: { requestId: string; status: string; deepLink?: string }) => void;
      onResult?: (result: RelayProofResult) => void;
      onError?: (error: { error: string; code?: number; requestId?: string }) => void;
    }
  ): Promise<() => void> {
    if (!this.authToken || !ProofportSDK.isTokenValid(this.authToken)) {
      throw new Error('Not authenticated. Call login() first.');
    }
    if (!this.relayUrl) {
      throw new Error('relayUrl is required. Set it in ProofportSDK config.');
    }

    let ioConnect: any;
    try {
      const mod: any = await import('socket.io-client');
      ioConnect = mod.io ?? mod.connect ?? mod.default;
    } catch {
      throw new Error(
        'socket.io-client is required for real-time updates. Install it: npm install socket.io-client'
      );
    }

    if (typeof ioConnect !== 'function') {
      throw new Error('Failed to load socket.io-client: io function not found');
    }

    // Connect to relay /proof namespace
    const socket = ioConnect(`${this.relayUrl}/proof`, {
      path: '/socket.io',
      auth: { token: this.authToken.token },
      transports: ['websocket', 'polling'],
    });

    this.socket = socket;

    // Subscribe to the request room
    socket.on('connect', () => {
      socket.emit('proof:subscribe', { requestId });
    });

    // Handle connection errors (e.g. rejected by relay middleware)
    socket.on('connect_error', (err: Error) => {
      console.error(`[ProofportSDK] Socket.IO connect_error for requestId=${requestId}: ${err.message}`);
      callbacks.onError?.({ error: err.message, requestId });
    });

    // Listen for events
    if (callbacks.onStatus) {
      socket.on('proof:status', callbacks.onStatus);
    }
    if (callbacks.onResult) {
      socket.on('proof:result', callbacks.onResult);
    }
    if (callbacks.onError) {
      socket.on('proof:error', callbacks.onError);
    }

    // Return unsubscribe function
    return () => {
      socket.off('proof:status');
      socket.off('proof:result');
      socket.off('proof:error');
      socket.disconnect();
      if (this.socket === socket) {
        this.socket = null;
      }
    };
  }

  /**
   * Waits for a proof result using Socket.IO (primary) with polling fallback.
   *
   * Tries Socket.IO first for real-time delivery. If socket.io-client is not
   * installed or connection fails, automatically falls back to HTTP polling.
   *
   * @param requestId - The relay-issued request ID
   * @param options - Configuration options
   * @param options.timeoutMs - Maximum wait time in ms (default: 300000 = 5 min)
   * @param options.onStatusChange - Callback for status updates
   * @returns Promise resolving to final RelayProofResult
   */
  async waitForProof(
    requestId: string,
    options: {
      timeoutMs?: number;
      onStatusChange?: (result: RelayProofResult | { requestId: string; status: string; deepLink?: string }) => void;
    } = {}
  ): Promise<RelayProofResult> {
    const timeout = options.timeoutMs || 300000;

    // Try Socket.IO first
    if (this.authToken && ProofportSDK.isTokenValid(this.authToken) && this.relayUrl) {
      try {
        return await new Promise<RelayProofResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            unsubscribePromise?.then(fn => fn());
            reject(new Error(`Waiting for proof timed out after ${timeout}ms`));
          }, timeout);

          const unsubscribePromise = this.subscribe(requestId, {
            onStatus: (data) => {
              options.onStatusChange?.(data);
            },
            onResult: (result) => {
              clearTimeout(timer);
              unsubscribePromise?.then(fn => fn());
              resolve(result);
            },
            onError: (error) => {
              clearTimeout(timer);
              unsubscribePromise?.then(fn => fn());
              reject(new Error(error.error));
            },
          });
        });
      } catch (err: any) {
        // Re-throw timeout — that's a real failure the caller should handle
        if (err.message?.includes('timed out')) {
          throw err;
        }
        // socket.io-client missing or connection failed → fall back to polling silently
        console.warn('Socket.IO unavailable, falling back to HTTP polling:', err.message);
      }
    }

    // Fallback: HTTP polling
    return this.waitForResult(requestId, {
      timeoutMs: timeout,
      onStatusChange: options.onStatusChange as any,
    });
  }

  /**
   * Disconnects the Socket.IO connection if active.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ============ Nullifier Utilities ============

  /**
   * Extracts the nullifier from proof public inputs.
   *
   * The nullifier is a bytes32 value derived from the user's address and scope,
   * used to prevent duplicate proof submissions. Each user+scope combination
   * produces a unique nullifier.
   *
   * @param publicInputs - Array of public input hex strings from proof response
   * @param circuit - Circuit type to determine field positions
   * @returns Nullifier as hex string (0x...), or null if inputs are insufficient
   *
   * @example
   * ```typescript
   * const result = await sdk.waitForProof(relay.requestId);
   * if (result.status === 'completed') {
   *   const nullifier = sdk.extractNullifier(result.publicInputs, result.circuit);
   *   console.log('Nullifier:', nullifier);
   * }
   * ```
   */
  extractNullifier(publicInputs: string[], circuit: CircuitType): string | null {
    return extractNullifierFromPublicInputs(publicInputs, circuit);
  }

  /**
   * Extracts the scope from proof public inputs.
   *
   * The scope is an application-specific identifier (e.g., domain name) encoded
   * as bytes32 in the proof's public inputs.
   *
   * @param publicInputs - Array of public input hex strings from proof response
   * @param circuit - Circuit type to determine field positions
   * @returns Scope as hex string (0x...), or null if inputs are insufficient
   *
   * @example
   * ```typescript
   * const result = await sdk.waitForProof(relay.requestId);
   * if (result.status === 'completed') {
   *   const scope = sdk.extractScope(result.publicInputs, result.circuit);
   *   console.log('Scope:', scope);
   * }
   * ```
   */
  extractScope(publicInputs: string[], circuit: CircuitType): string | null {
    return extractScopeFromPublicInputs(publicInputs, circuit);
  }

  /**
   * Checks if a nullifier is already registered on-chain.
   *
   * Queries the ZKProofportNullifierRegistry contract to determine if the
   * nullifier has been used before. Used to prevent duplicate proof submissions.
   *
   * Requires `nullifierRegistry` in SDK config.
   *
   * @param nullifier - Nullifier hex string from extractNullifier()
   * @param provider - Optional ethers provider (defaults to public RPC for configured chain)
   * @returns True if nullifier is already registered
   * @throws Error if nullifierRegistry is not configured
   *
   * @example
   * ```typescript
   * const sdk = ProofportSDK.create({
   *   relayUrl: 'https://relay.zkproofport.app',
   *   nullifierRegistry: { address: '0x...', chainId: 8453 }
   * });
   *
   * const nullifier = sdk.extractNullifier(publicInputs, circuit);
   * const isDuplicate = await sdk.checkNullifier(nullifier);
   * ```
   */
  async checkNullifier(nullifier: string, provider?: any): Promise<boolean> {
    if (!this.nullifierRegistry) {
      throw new Error('nullifierRegistry is required. Set it in ProofportSDK config.');
    }
    const p = provider || getDefaultProvider(this.nullifierRegistry.chainId);
    return isNullifierRegistered(nullifier, this.nullifierRegistry.address, p);
  }

  /**
   * Gets detailed information about a registered nullifier from on-chain registry.
   *
   * Retrieves the registration timestamp, scope, and circuit ID for a nullifier.
   * Returns null if the nullifier is not registered.
   *
   * Requires `nullifierRegistry` in SDK config.
   *
   * @param nullifier - Nullifier hex string from extractNullifier()
   * @param provider - Optional ethers provider (defaults to public RPC for configured chain)
   * @returns Nullifier info or null if not registered
   * @throws Error if nullifierRegistry is not configured
   *
   * @example
   * ```typescript
   * const info = await sdk.getNullifierDetails(nullifier);
   * if (info) {
   *   console.log('Registered at:', new Date(info.registeredAt * 1000));
   *   console.log('Circuit:', info.circuitId);
   * }
   * ```
   */
  async getNullifierDetails(
    nullifier: string,
    provider?: any
  ): Promise<{ registeredAt: number; scope: string; circuitId: string } | null> {
    if (!this.nullifierRegistry) {
      throw new Error('nullifierRegistry is required. Set it in ProofportSDK config.');
    }
    const p = provider || getDefaultProvider(this.nullifierRegistry.chainId);
    return getNullifierInfo(nullifier, this.nullifierRegistry.address, p);
  }
}

export default ProofportSDK;
