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
  extractOprfDomainFromPublicInputs,
  extractOprfKeyHashFromPublicInputs,
} from './verifier';

// The OPRF nullifier every wallet credential proof carries: its four public
// inputs, the key hash each environment pins, and the check every verify path
// runs. reduceOprfName turns a scope or domain string into the field a proof
// carries. The client side (blinding, the nodes' proof, the nullifier) is in
// '@zkproofport-app/core/oprf'.
export {
  OPRF_PUBLIC_INPUT_LAYOUTS,
  OPRF_CIRCUIT_IDS,
  readOprfPublicInputs,
  OPRF_KEY_HASHES,
  OPRF_ENVIRONMENTS,
  TACEO_TESTNET_OPRF_KEY_HASH,
  getPinnedOprfKeyHash,
  checkOprfProof,
  reduceOprfName,
  oprfNameError,
} from './verifier';
export type { OprfCircuitId, OprfEnvironment, OprfPublicInputs, OprfPublicInputLayout, ProofRequestContext } from './verifier';

// Canonical circuit identifiers — the single source of truth.
// Also available on its own, with no runtime dependencies, via
// `import { CIRCUIT_IDS } from '@zkproofport-app/sdk/circuits'`.
export {
  CIRCUIT_IDS,
  CIRCUIT_SUPPORT_STATUS,
  ALL_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  EXPERIMENTAL_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  isCircuitId,
  isSupportedCircuitId,
  getCircuitSupportStatus,
  CIRCUIT_VK_PATHS,
  CIRCUIT_PACKAGES,
  SIGNER_VARIANTS,
  isSignerVariant,
  signerVariantsOf,
  getCircuitPackage,
  resolveSignerVariant,
  HUMAN_PASSPORT_ISSUER,
  HUMAN_PASSPORT_ISSUER_ROOT,
  HUMAN_PASSPORT_CHAINS,
  HUMAN_PASSPORT_CHAIN_IDS,
  HUMAN_PASSPORT_SCORER_IDS,
  humanPassportChain,
  humanPassportScoreUnits,
  evmProofByteLength,
} from './circuits';

// Off-chain verification — checking a proof against its verification key, with
// no chain involved. Everything it needs ships with this package.
export { verifyProofOffChain } from './offChainVerifier';
export type {
  OffChainVerifyResult,
  OffChainVerifyOptions,
} from './offChainVerifier';

// The verifier contracts proofs are checked against, generated from the
// circuits repository's deployment records. A response's own verifierAddress
// is never used.
export { PINNED_VERIFIERS, PINNED_VARIANT_VERIFIERS, getPinnedVerifier, getPinnedVariantVerifier } from './verifier';
export type { PinnedVerifier } from './verifier';

// What an OIDC proof's token must say (audience, nonce, time) before any verify
// function calls it valid; run by every verify path. Exported so a dApp can
// derive the nonce a request expects or show why a proof was refused.
export {
  checkOidcPolicy,
  deriveOidcNonceBinding,
  oidcAudienceHash,
  OIDC_ALLOWED_AUDIENCES,
  OIDC_NONCE_DOMAIN,
  OIDC_NOW_MAX_AGE_SECONDS,
  OIDC_NOW_MAX_FUTURE_SECONDS,
  OIDC_V1_PUBLIC_INPUT_COUNT,
  OIDC_V2_PUBLIC_INPUT_COUNT,
} from './verifier';
export type { OidcRequestContext, OidcAudience, OidcNonceMode } from './verifier';

// The signal_hash a proof without an action carries for a request, and the
// check every verify path runs when it is given the request. Exported so a
// dApp can recompute it for a request it issued.
export {
  computeSignalHash,
  checkSignalHash,
  signalHashScopeError,
  signalHashRequestIdError,
  SIGNAL_HASH_CIRCUIT_IDS,
  SIGNAL_HASH_LAYOUTS,
  SIGNAL_HASH_MAX_SCOPE_BYTES,
  SIGNAL_HASH_MAX_REQUEST_ID_LENGTH,
} from './verifier';
export type { SignalHashRequest, SignalHashLayout } from './verifier';

// Public input layout constants
export {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
} from './constants';
export {
  COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT,
  GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  GIWA_ATTESTATION_PUBLIC_INPUT_COUNT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_LAYOUT,
  DOJANG_PLAYGROUND_PUBLIC_INPUT_COUNT,
} from './verifier';

export type { CircuitId, CircuitSupportStatus, SignerVariant, CircuitPackage, HumanPassportChain } from './circuits';
// Whether a circuit binds an EIP-712 action, and whether it must. One table,
// so a dapp does not have to learn which circuit names are special.
export {
  CIRCUIT_ACTION_BINDING,
  circuitActionBinding,
} from './circuits';
export type { CircuitActionBinding } from './circuits';

// Types
export type {
  CircuitType,
  ProofRequestStatus,
  CoinbaseKycInputs,
  ActionBoundInputs,
  GiwaAttestationInputs,
  DojangPlaygroundInputs,
  TypedAction,
  CoinbaseCountryInputs,
  HumanPassportScoreInputs,
  OidcDomainInputs,
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
  RelayProofStatus,
  RelayTerminalStatus,
  SDKEnvironment,
} from './types';

// The statuses a relay request ends in, for branching on a RelayProofResult.
export { RELAY_TERMINAL_STATUSES, isTerminalRelayStatus, DEFAULT_RELAY_WAIT_MS } from './relayStatus';

// Checking the EIP-712 action a giwa_attestation proof binds to. Exported so a
// dapp validates before sending and the mobile app validates before signing,
// against one definition rather than three.
export { validateTypedAction, parseTypedAction } from './typedAction';
