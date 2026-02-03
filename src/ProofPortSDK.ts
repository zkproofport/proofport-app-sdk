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
 * ZKProofPort SDK for requesting and verifying ZK proofs
 */
export class ProofPortSDK {
  private config: Required<ProofPortConfig>;
  private pendingRequests: Map<string, ProofRequest> = new Map();

  constructor(config: ProofPortConfig = {}) {
    this.config = {
      scheme: config.scheme || DEFAULT_SCHEME,
      defaultCallbackUrl: config.defaultCallbackUrl || '',
      verifiers: config.verifiers || {},
    };
  }

  // ============ Request Creation ============

  /**
   * Create a Coinbase KYC verification request
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
   * Create a Coinbase Country attestation request
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
   * Create a generic proof request
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
   * Generate deep link URL for a proof request
   */
  getDeepLinkUrl(request: ProofRequest): string {
    return buildProofRequestUrl(request, this.config.scheme);
  }

  /**
   * Open ZKProofPort app with a proof request (browser)
   */
  openProofRequest(request: ProofRequest): void {
    const url = this.getDeepLinkUrl(request);
    window.location.href = url;
  }

  /**
   * Request a proof — auto-detects platform.
   * Mobile: opens deep link directly.
   * Desktop: returns QR code data URL and deep link URL for display.
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
   * Generate QR code as data URL
   */
  async generateQRCode(
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<string> {
    return generateQRCodeDataUrl(requestOrUrl, options, this.config.scheme);
  }

  /**
   * Generate QR code as SVG string
   */
  async generateQRCodeSVG(
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<string> {
    return generateQRCodeSVG(requestOrUrl, options, this.config.scheme);
  }

  /**
   * Render QR code to canvas element
   */
  async renderQRCodeToCanvas(
    canvas: HTMLCanvasElement,
    requestOrUrl: ProofRequest | string,
    options?: QRCodeOptions
  ): Promise<void> {
    return generateQRCodeToCanvas(canvas, requestOrUrl, options, this.config.scheme);
  }

  /**
   * Check if request data fits in QR code
   */
  checkQRCodeSize(requestOrUrl: ProofRequest | string): { size: number; withinLimit: boolean } {
    return estimateQRDataSize(requestOrUrl, this.config.scheme);
  }

  // ============ Response Handling ============

  /**
   * Parse proof response from callback URL
   */
  parseResponse(url: string): ProofResponse | null {
    return parseProofResponseUrl(url);
  }

  /**
   * Check if a URL is a ZKProofPort response
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
   * Get pending request by ID
   */
  getPendingRequest(requestId: string): ProofRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Clear pending request
   */
  clearPendingRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
  }

  // ============ Verification ============

  /**
   * Verify proof on-chain
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
   * Verify proof from response on-chain
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
   * Get verifier contract address
   */
  getVerifierAddress(circuit: CircuitType): string {
    const customVerifier = this.config.verifiers[circuit];
    return getVerifierAddress(circuit, customVerifier);
  }

  /**
   * Get verifier chain ID
   */
  getVerifierChainId(circuit: CircuitType): number {
    const customVerifier = this.config.verifiers[circuit];
    return getVerifierChainId(circuit, customVerifier);
  }

  /**
   * Get circuit metadata
   */
  getCircuitMetadata(circuit: CircuitType) {
    return CIRCUIT_METADATA[circuit];
  }

  /**
   * Get all supported circuits
   */
  getSupportedCircuits(): CircuitType[] {
    return Object.keys(CIRCUIT_METADATA) as CircuitType[];
  }

  /**
   * Validate a proof request
   */
  validateRequest(request: ProofRequest): { valid: boolean; error?: string } {
    return validateProofRequest(request);
  }

  /**
   * Check if URL is a ZKProofPort deep link
   */
  isProofPortDeepLink(url: string): boolean {
    return isProofPortDeepLink(url, this.config.scheme);
  }

  /**
   * Parse proof request from deep link URL
   */
  parseDeepLink(url: string): ProofRequest | null {
    return parseProofRequestUrl(url);
  }

  // ============ Static Factory ============

  /**
   * Create SDK with default configuration
   */
  static create(config?: ProofPortConfig): ProofPortSDK {
    return new ProofPortSDK(config);
  }

  /**
   * Detect if running on a mobile device
   */
  static isMobile(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }
}

export default ProofPortSDK;
