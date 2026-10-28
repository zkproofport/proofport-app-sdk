/**
 * ZKProofport SDK Types
 */

import type { CircuitType, TypedAction, ParsedProof, VerifierContract } from '@zkproofport-app/core';

// Moved to @zkproofport-app/core, re-exported so existing imports keep working.
export type { CircuitType, TypedAction, ParsedProof, VerifierContract };



/**
 * Proof request lifecycle status.
 *
 * - `pending`: Request sent to mobile app, awaiting proof generation
 * - `completed`: Proof successfully generated and returned
 * - `error`: Proof generation failed
 * - `cancelled`: Request cancelled by user
 */
export type ProofRequestStatus = 'pending' | 'completed' | 'error' | 'cancelled';

/**
 * Input parameters for Coinbase KYC attestation circuit.
 *
 * This circuit proves a user has completed Coinbase KYC verification
 * without revealing their identity or Coinbase account details.
 *
 * @property userAddress - Ethereum address to prove ownership of (optional, app will connect wallet if not provided)
 * @property rawTransaction - Raw attestation transaction data (optional, app can fetch from Etherscan)
 * @property scope - Application-specific identifier for proof uniqueness (e.g., dapp domain)
 *
 * @example
 * ```typescript
 * const inputs: CoinbaseKycInputs = {
 *   userAddress: '0x1234...', // Optional
 *   scope: 'myapp.com'
 * };
 * ```
 */
export interface CoinbaseKycInputs {
  userAddress?: string;
  rawTransaction?: string;
  scope: string;
}

/**
 * Input parameters for Coinbase Country attestation circuit.
 *
 * This circuit proves a user's country based on Coinbase verification,
 * supporting both inclusion (user IS from countries) and exclusion (user is NOT from countries) checks.
 *
 * @property userAddress - Ethereum address to prove ownership of (optional)
 * @property rawTransaction - Raw attestation transaction data (optional)
 * @property countryList - List of ISO 3166-1 alpha-2 country codes (e.g., ['US', 'KR']) (required)
 * @property isIncluded - If true, proves user IS from countries; if false, proves user is NOT from countries (required)
 * @property scope - Application-specific identifier for proof uniqueness
 *
 * @example
 * ```typescript
 * // Prove user is from US or KR
 * const inputs: CoinbaseCountryInputs = {
 *   countryList: ['US', 'KR'],
 *   isIncluded: true,
 *   scope: 'myapp.com'
 * };
 * ```
 */
export interface CoinbaseCountryInputs {
  userAddress?: string;
  rawTransaction?: string;
  countryList: string[];
  isIncluded: boolean;
  scope: string;
}

/**
 * Input parameters for OIDC Domain attestation circuit.
 *
 * This circuit proves a user's email domain affiliation via OIDC Sign-In
 * without revealing the full email address. The mobile app handles
 * authentication and proof generation entirely on-device.
 *
 * @property domain - Email domain to prove (e.g., "google.com", "company.com")
 * @property scope - Application-specific identifier for proof uniqueness (e.g., dapp domain)
 * @property provider - OIDC workspace provider name for organization membership verification.
 *   When set, the mobile app verifies the user's account is managed by the specified provider.
 *   Supported: `'google'` (Google Workspace `hd` claim), `'microsoft'` (Microsoft 365 `tid` claim).
 *   Omit for general email domain verification without organization membership check.
 */
export interface OidcDomainInputs {
  domain: string;
  scope: string;
  provider?: 'google' | 'microsoft';
}

/**
 * Input parameters for Korea Mobile ID (mDL) ownership attestation circuit.
 *
 * Proves the user holds a valid Korean mobile driver's license. The license
 * data never leaves the device; only the selected attributes indicated by
 * `discloseFlags` are revealed through the proof's public inputs.
 *
 * @property scope - Application-specific identifier for proof uniqueness (e.g., dapp domain)
 * @property discloseFlags - Attribute disclosure bitmask 0x00–0x0F
 *   (0x01 name | 0x02 birth | 0x04 sex | 0x08 phone). Omit or 0 for a fully
 *   anonymous ownership proof. The attribute values themselves are entered
 *   by the user on-device, never supplied by the dapp.
 *
 * @example
 * ```typescript
 * // Anonymous "I hold a valid Korean mobile ID" proof
 * const inputs: MdlKrOwnershipInputs = { scope: 'myapp.com' };
 * ```
 */
export interface MdlKrOwnershipInputs {
  scope: string;
  discloseFlags?: number;
}

/**
 * Input parameters for Korea Mobile ID (mDL) age attestation circuit.
 *
 * Proves the user is at least `ageThreshold` years old according to their
 * Korean mobile driver's license, without revealing the birth date.
 *
 * @property scope - Application-specific identifier for proof uniqueness
 * @property ageThreshold - Minimum age to prove (integer, 1–150). E.g., 19 for
 *   Korean adult verification.
 *
 * @example
 * ```typescript
 * const inputs: MdlKrAgeInputs = { scope: 'myapp.com', ageThreshold: 19 };
 * ```
 */
export interface MdlKrAgeInputs {
  scope: string;
  ageThreshold: number;
}

/**
 * Input parameters for Korea Mobile ID (mDL) region attestation circuit.
 *
 * Proves the user's registered address is in the specified si/do region
 * without revealing the full address.
 *
 * @property scope - Application-specific identifier for proof uniqueness
 * @property targetRegion - Region (si/do) to prove residency in, in Korean
 *   (e.g., '경기도', '서울특별시'). Chosen by the dapp; the proof succeeds only
 *   if the license address matches.
 *
 * @example
 * ```typescript
 * const inputs: MdlKrRegionInputs = { scope: 'myapp.com', targetRegion: '경기도' };
 * ```
 */
export interface MdlKrRegionInputs {
  scope: string;
  targetRegion: string;
}

/**
 * Empty input type for circuits that retrieve all data from the mobile app.
 * Used when SDK doesn't need to provide any circuit-specific parameters.
 */
export interface EmptyInputs {}


/**
 * Input parameters for circuits that can bind an EIP-712 action
 * (`giwa_attestation`).
 *
 * The wallet signs a typed action instead of an opaque signal hash. The proof's
 * public inputs then carry the action's domain separator and struct hash, so a
 * verifier checks WHICH action was authorised — not merely that somebody
 * eligible signed something.
 *
 * @property scope - Scope string for nullifier derivation
 * @property action - The EIP-712 action the wallet signs
 * @property userAddress - Ethereum address to prove ownership of (optional)
 * @property rawTransaction - Raw attestation transaction data (optional)
 */
export interface ActionBoundInputs {
  scope: string;
  userAddress?: string;
  rawTransaction?: string;
  /**
   * The EIP-712 action this proof authorizes.
   *
   * Optional in the TYPE; whether a circuit requires it is the circuit's
   * property (`giwa_attestation` signs its signal hash instead when none is
   * given). That difference lives in `CIRCUIT_ACTION_BINDING` and is
   * enforced by `createRelayRequest` and the deep-link validator, so it is not
   * written a second time here -- two copies of one rule drift, and the copy
   * that drifts is the one nobody is looking at.
   */
  action?: TypedAction;
}

/** The same shape, for the circuit whose action is optional. */
export type GiwaAttestationInputs = ActionBoundInputs;

/** Dojang Playground takes the same shape: its action is optional too. */
export type DojangPlaygroundInputs = ActionBoundInputs;

/**
 * Union type of all circuit-specific input types.
 * Each circuit type has a corresponding input interface.
 */
export type CircuitInputs =
  | CoinbaseKycInputs
  | ActionBoundInputs
  | CoinbaseCountryInputs
  | OidcDomainInputs
  | MdlKrOwnershipInputs
  | MdlKrAgeInputs
  | MdlKrRegionInputs
  | EmptyInputs;

/**
 * Zero-knowledge proof request sent to mobile app via deep link.
 *
 * This structure is serialized into a deep link URL that opens the ZKProofport mobile app.
 * The app generates the proof and sends the result to the callbackUrl.
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   requestId: 'req_123',
 *   circuit: 'coinbase_attestation',
 *   inputs: { scope: 'myapp.com' },
 *   dappName: 'My DApp',
 *   createdAt: Date.now(),
 *   expiresAt: Date.now() + 600000 // 10 minutes
 * };
 * ```
 */
export interface ProofRequest {
  /** Unique request identifier (used to match request with response) */
  requestId: string;
  /** Circuit type to use for proof generation */
  circuit: CircuitType;
  /** Circuit-specific input parameters */
  inputs: CircuitInputs;
  /** @internal URL where mobile app will POST the proof response (set by relay server internally, never by SDK users) */
  callbackUrl?: string;
  /** Optional: Custom message to display to user in mobile app */
  message?: string;
  /** Optional: DApp name displayed in mobile app UI */
  dappName?: string;
  /** Optional: DApp icon URL displayed in mobile app UI */
  dappIcon?: string;
  /**
   * Optional: which app the ZKProofport app should bring back to the foreground
   * once it has finished — a bare custom scheme such as `mydapp://`.
   *
   * Not a URL, and an https origin is not accepted: opening one launches a new
   * browser tab on a fresh page instead of returning the user to the tab they
   * started from. A web requester therefore has nothing valid to put here and
   * omits the field. See {@link ProofportSDK.createRelayRequest}.
   */
  returnScheme?: string;
  /** Unix timestamp (ms) when request was created */
  createdAt: number;
  /** Optional: Unix timestamp (ms) when request expires */
  expiresAt?: number;
}

/**
 * Zero-knowledge proof response received from mobile app.
 *
 * This structure is returned via the callbackUrl after the mobile app generates the proof.
 * For successful proofs, includes the proof data and public inputs needed for on-chain verification.
 *
 * @example
 * ```typescript
 * const response: ProofResponse = {
 *   requestId: 'req_123',
 *   circuit: 'coinbase_attestation',
 *   status: 'completed',
 *   proof: '0x1234...',
 *   publicInputs: ['0xabcd...', '0xef01...'],
 *   numPublicInputs: 2,
 *   verifierAddress: '0x5678...',
 *   chainId: 84532,
 *   timestamp: Date.now()
 * };
 * ```
 */
export interface ProofResponse {
  /** Original request ID (matches ProofRequest.requestId) */
  requestId: string;
  /** Circuit type used for proof generation */
  circuit: CircuitType;
  /** Request status (completed, error, cancelled) */
  status: ProofRequestStatus;
  /** Proof data as hex string (present if status is completed) */
  proof?: string;
  /** Public inputs as array of hex strings (present if status is completed) */
  publicInputs?: string[];
  /** Number of public inputs (used for verification) */
  numPublicInputs?: number;
  /** Error message (present if status is error) */
  error?: string;
  /** Unix timestamp (ms) when proof was generated */
  timestamp?: number;
  /** Verifier contract address on target chain (provided by mobile app) */
  verifierAddress?: string;
  /** Chain ID where verifier contract is deployed (provided by mobile app) */
  chainId?: number;
  /**
   * Which of the circuit's packages made the proof (a `SignerVariant`,
   * provided by mobile app). Pass the relay result's `signerVariant` through
   * unchanged; a value the circuit has no package for is refused by name.
   * Omitted means `standard`; a proof whose length is another package's is
   * then refused.
   */
  signerVariant?: string;
}


/**
 * QR code generation options for deep link encoding.
 *
 * Controls the appearance and error correction level of generated QR codes.
 * Higher error correction allows for more damage tolerance but requires larger QR codes.
 *
 * @example
 * ```typescript
 * const options: QRCodeOptions = {
 *   width: 512,
 *   errorCorrectionLevel: 'M',
 *   darkColor: '#000000',
 *   lightColor: '#ffffff'
 * };
 * ```
 */
export interface QRCodeOptions {
  /** QR code width in pixels (default: 300) */
  width?: number;
  /** Error correction level: L (7%), M (15%), Q (25%), H (30%) (default: M) */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  /** Margin around QR code in module units (default: 4) */
  margin?: number;
  /** Foreground color as hex string (default: #000000) */
  darkColor?: string;
  /** Background color as hex string (default: #ffffff) */
  lightColor?: string;
}


/**
 * ZKProofport SDK configuration options.
 *
 * Allows customization of deep link scheme, default callback URL,
 * and verifier contract addresses.
 *
 * @example
 * ```typescript
 * // Recommended: use environment preset
 * const sdk = ProofportSDK.create('production');
 *
 * // Or custom config:
 * const config: ProofportConfig = {
 *   relayUrl: 'https://relay.zkproofport.app',
 *   verifiers: {
 *     coinbase_attestation: {
 *       address: '0x1234...',
 *       chainId: 84532,
 *       abi: VERIFIER_ABI
 *     }
 *   }
 * };
 * const sdk = new ProofportSDK(config);
 * ```
 */
/**
 * SDK environment preset names.
 * Used with `ProofportSDK.create('production')` for zero-config initialization.
 *
 * - `production` — relay.zkproofport.app
 * - `staging` — stg-relay.zkproofport.app
 * - `local` — localhost:4001
 */
export type SDKEnvironment = 'production' | 'staging' | 'local';

export interface ProofportConfig {
  /** Deep link URL scheme (default: 'zkproofport') */
  scheme?: string;
  /** Relay server URL (e.g., 'https://relay.zkproofport.app'). Required for relay features. */
  relayUrl?: string;
  /** Custom verifier contract addresses per circuit type (overrides defaults) */
  verifiers?: Partial<Record<CircuitType, VerifierContract>>;
  /**
   * @internal Which environment's chains a circuit with no configured
   * verifier is verified on (the pinned verifier on that chain).
   * `ProofportSDK.create(env)` sets it; set it yourself only alongside a custom
   * `relayUrl`, e.g. a local relay on a LAN address. Without it, and without a
   * configured verifier, verification fails rather than guessing.
   */
  environment?: SDKEnvironment;
}

/**
 * Parsed deep link URL components.
 *
 * Internal representation of a deep link URL broken into its constituent parts.
 * Used for deep link generation and parsing.
 */
export interface DeepLinkComponents {
  /** URL scheme (e.g., 'zkproofport') */
  scheme: string;
  /** URL host (e.g., 'proof-request') */
  host: string;
  /** URL path (e.g., '/verify') */
  path: string;
  /** Query parameters as key-value pairs */
  params: Record<string, string>;
}

/**
 * Challenge response from relay server.
 *
 * The relay server issues a random challenge that must be signed
 * by the user's wallet to authenticate proof requests.
 *
 * @example
 * ```typescript
 * const challenge: ChallengeResponse = {
 *   challenge: '0xabcdef...',
 *   expiresAt: 1707234567890
 * };
 * ```
 */
export interface ChallengeResponse {
  /** Session identifier (used as requestId) */
  requestId: string;
  /** Hex-encoded 32-byte random challenge */
  challenge: string;
  /** Unix timestamp (ms) when challenge expires */
  expiresAt: number;
}

/**
 * Wallet signer interface for challenge signing.
 * Compatible with ethers v6 Signer.
 *
 * Any object implementing `signMessage` and `getAddress` can be used,
 * including ethers v6 `Signer` instances.
 *
 * @example
 * ```typescript
 * import { BrowserProvider } from 'ethers';
 *
 * const provider = new BrowserProvider(window.ethereum);
 * const signer = await provider.getSigner();
 * // signer implements WalletSigner
 * ```
 */
export interface WalletSigner {
  signMessage(message: string | Uint8Array): Promise<string>;
  getAddress(): Promise<string>;
}

/**
 * Result from creating a proof request via relay.
 * Contains relay-issued requestId, deep link, and poll URL.
 */
export interface RelayProofRequest {
  /** Relay-issued unique request ID (UUID format) */
  requestId: string;
  /** Deep link URL to open ZKProofport app (built by relay) */
  deepLink: string;
  /** Relay status at creation: always 'pending' */
  status: string;
  /** Relative poll URL for checking proof status (e.g., /api/v1/proof/{requestId}) */
  pollUrl: string;
}

/**
 * The states a relay request ends in (see `RELAY_TERMINAL_STATUSES`). Once reached, the status never changes
 * and `waitForProof()` / `waitForResult()` resolve with it.
 *
 * - `completed` — a proof came back.
 * - `error` — the app could not produce a proof; `error` says why, `errorCode`
 *   (e.g. `E2007`) names the cause when the app sent one.
 * - `failed` — the older name for `error`, still sent by older app versions.
 * - `cancelled` — the user declined in the ZKProofport app.
 * - `expired` — the app did not answer in time, so the relay answered for it.
 */
export type RelayTerminalStatus = 'completed' | 'error' | 'failed' | 'cancelled' | 'expired';

/** Every status a relay request can report: `pending`, `generating` while the app works, then a terminal one. */
export type RelayProofStatus = 'pending' | 'generating' | RelayTerminalStatus;

/**
 * Proof result retrieved from the relay, by polling or over the socket.
 */
export interface RelayProofResult {
  requestId: string;
  status: RelayProofStatus;
  deepLink?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Present when status is 'completed' */
  proof?: string;
  publicInputs?: string[];
  verifierAddress?: string;
  chainId?: number;
  circuit?: string;
  /** Which of the circuit's packages made the proof; copy it into `ProofResponse.signerVariant`. */
  signerVariant?: string;
  /** Human-readable reason, present when status is 'error', 'failed' or 'expired' */
  error?: string;
  /** The app's error code (`E` + four digits, e.g. `E2007`), present on some 'error' results */
  errorCode?: string;
}
