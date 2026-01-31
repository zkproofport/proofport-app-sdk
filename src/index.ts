/**
 * ProofPort SDK
 *
 * SDK for requesting ZK proofs from the ProofPort mobile app
 *
 * @example
 * ```typescript
 * import { ProofPortSDK } from '@proofport/sdk';
 *
 * const sdk = new ProofPortSDK({
 *   defaultCallbackUrl: 'https://myapp.com/verify'
 * });
 *
 * // Create age verification request
 * const request = sdk.createAgeVerificationRequest({
 *   birthYear: 2000,
 *   currentYear: 2026,
 *   minAge: 18
 * });
 *
 * // Generate QR code
 * const qrDataUrl = await sdk.generateQRCode(request);
 *
 * // Or open app directly
 * sdk.openProofRequest(request);
 * ```
 */

// Main SDK class
export { ProofPortSDK, default } from './ProofPortSDK';

// Types
export type {
  CircuitType,
  ProofRequestStatus,
  AgeVerifierInputs,
  CoinbaseKycInputs,
  CircuitInputs,
  ProofRequest,
  ProofResponse,
  ParsedProof,
  QRCodeOptions,
  VerifierContract,
  ProofPortConfig,
  DeepLinkComponents,
} from './types';

// Deep link utilities
export {
  generateRequestId,
  buildProofRequestUrl,
  buildCallbackUrl,
  parseProofRequestUrl,
  parseProofResponseUrl,
  parseDeepLink,
  isProofPortDeepLink,
  validateProofRequest,
  encodeData,
  decodeData,
} from './deeplink';

// QR code utilities
export {
  generateQRCodeDataUrl,
  generateQRCodeSVG,
  generateQRCodeToCanvas,
  estimateQRDataSize,
} from './qrcode';

// Verification utilities
export {
  verifyProofOnChain,
  parseProofForOnChain,
  getVerifierContract,
  getDefaultProvider,
  getVerifierAddress,
  getVerifierChainId,
} from './verifier';

// Constants
export {
  DEFAULT_SCHEME,
  DEEP_LINK_HOSTS,
  CIRCUIT_METADATA,
  VERIFIER_ABI,
  RPC_ENDPOINTS,
  DEFAULT_REQUEST_EXPIRY_MS,
  MAX_QR_DATA_SIZE,
} from './constants';
