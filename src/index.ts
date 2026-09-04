/**
 * ZKProofport SDK
 *
 * SDK for requesting ZK proofs from the ZKProofport mobile app
 *
 * @example
 * ```typescript
 * import { ProofportSDK } from '@zkproofport-app/sdk';
 *
 * // Initialize SDK
 * const sdk = ProofportSDK.create();
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
  extractDomainFromPublicInputs,
} from './verifier';

// Canonical circuit identifiers — the single source of truth.
// Also available on its own, with no runtime dependencies, via
// `import { CIRCUIT_IDS } from '@zkproofport-app/sdk/circuits'`.
export {
  CIRCUIT_IDS,
  CIRCUIT_SUPPORT_STATUS,
  ALL_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  isCircuitId,
  isSupportedCircuitId,
  getCircuitSupportStatus,
  CIRCUIT_VK_PATHS,
} from './circuits';

// Off-chain verification — checking a proof against its verification key, with
// no chain involved. Needs the optional peer dependency @aztec/bb.js at the
// pinned version; see offChainVerifier.ts for why the version matters.
export { verifyProofOffChain } from './offChainVerifier';
export type {
  OffChainVerifyResult,
  OffChainVerifyOptions,
} from './offChainVerifier';

// Public input layout constants
export {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  MDL_KR_PUBLIC_INPUT_LAYOUT,
} from './constants';

export type { CircuitId, CircuitSupportStatus } from './circuits';

// Types
export type {
  CircuitType,
  ProofRequestStatus,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  OidcDomainInputs,
  MdlKrOwnershipInputs,
  MdlKrAgeInputs,
  MdlKrRegionInputs,
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
