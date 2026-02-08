/**
 * ZKProofPort SDK
 *
 * SDK for requesting ZK proofs from the ZKProofPort mobile app
 *
 * @example
 * ```typescript
 * import { ProofPortSDK } from '@zkproofport-app/sdk';
 *
 * // Initialize with environment preset
 * const sdk = ProofPortSDK.create('production');
 *
 * // Authenticate
 * await sdk.login({ clientId: 'your-id', apiKey: 'your-key' });
 *
 * // Create proof request via relay
 * const relay = await sdk.createRelayRequest('coinbase_attestation', {
 *   scope: 'myapp.com'
 * });
 *
 * // Generate QR code
 * const qr = await sdk.generateQRCode(relay.deepLink);
 *
 * // Wait for proof
 * const result = await sdk.waitForProof(relay.requestId);
 * ```
 */

// Main SDK class
export { ProofPortSDK, default } from './ProofPortSDK';

// Types
export type {
  CircuitType,
  ProofRequestStatus,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  CircuitInputs,
  ProofRequest,
  ProofResponse,
  ParsedProof,
  QRCodeOptions,
  VerifierContract,
  ProofPortConfig,
  DeepLinkComponents,
  NullifierVerifyStatus,
  NullifierRecord,
  NullifierRegistryConfig,
  AuthCredentials,
  AuthToken,
  RelayProofRequest,
  RelayProofResult,
  SDKEnvironment,
} from './types';

// Deep link utilities
export {
  generateRequestId,
  buildProofRequestUrl,
  parseProofRequestUrl,
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
  extractNullifierFromPublicInputs,
  extractScopeFromPublicInputs,
  isNullifierRegistered,
  getNullifierInfo,
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
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  NULLIFIER_REGISTRY_ABI,
  ZKPROOFPORT_NULLIFIER_REGISTRY_ABI,
  RELAY_URLS,
} from './constants';
