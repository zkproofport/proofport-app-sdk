/**
 * ZKProofport SDK
 *
 * SDK for requesting ZK proofs from the ZKProofport mobile app
 *
 * @example
 * ```typescript
 * import { ProofportSDK } from '@zkproofport-app/sdk';
 *
 * // Initialize with environment preset
 * const sdk = ProofportSDK.create('production');
 *
 * // Set wallet signer
 * sdk.setSigner(signer);
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
export { ProofportSDK, default } from './ProofportSDK';

// Utility functions
export {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
} from './verifier';

// Public input layout constants
export {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
} from './constants';

// Types
export type {
  CircuitType,
  ProofRequestStatus,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  CircuitInputs,
  ProofRequest,
  ProofResponse,
  QRCodeOptions,
  VerifierContract,
  ProofportConfig,
  ChallengeResponse,
  WalletSigner,
  RelayProofRequest,
  RelayProofResult,
  SDKEnvironment,
} from './types';
