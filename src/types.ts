/**
 * ZKProofPort SDK Types
 */

/**
 * Supported zero-knowledge circuit types.
 * Uses canonical circuit names matching Nargo.toml circuit definitions.
 *
 * @example
 * ```typescript
 * const circuit: CircuitType = 'coinbase_attestation';
 * ```
 */
export type CircuitType = 'coinbase_attestation' | 'coinbase_country_attestation';

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
 * Empty input type for circuits that retrieve all data from the mobile app.
 * Used when SDK doesn't need to provide any circuit-specific parameters.
 */
export interface EmptyInputs {}

/**
 * Union type of all circuit-specific input types.
 * Each circuit type has a corresponding input interface.
 */
export type CircuitInputs = CoinbaseKycInputs | CoinbaseCountryInputs | EmptyInputs;

/**
 * Zero-knowledge proof request sent to mobile app via deep link.
 *
 * This structure is serialized into a deep link URL that opens the ZKProofPort mobile app.
 * The app generates the proof and sends the result to the callbackUrl.
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   requestId: 'req_123',
 *   circuit: 'coinbase_attestation',
 *   inputs: { scope: 'myapp.com' },
 *   callbackUrl: 'https://myapp.com/callback',
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
  /** URL where mobile app will POST the proof response */
  callbackUrl: string;
  /** Optional: Custom message to display to user in mobile app */
  message?: string;
  /** Optional: DApp name displayed in mobile app UI */
  dappName?: string;
  /** Optional: DApp icon URL displayed in mobile app UI */
  dappIcon?: string;
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
 *   nullifier: '0x9abc...',
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
  /** Nullifier for proof uniqueness (prevents double-use, derived from scope) */
  nullifier?: string;
}

/**
 * Parsed and formatted proof data ready for on-chain verification.
 *
 * Internal representation used by the SDK to prepare proof data
 * for smart contract verification calls.
 */
export interface ParsedProof {
  /** Proof bytes as hex string with 0x prefix */
  proofHex: string;
  /** Public inputs as array of hex strings with 0x prefix */
  publicInputsHex: string[];
  /** Number of public inputs (must match circuit specification) */
  numPublicInputs: number;
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
 * Verifier smart contract configuration.
 *
 * Contains the address and ABI for a circuit's verifier contract on a specific chain.
 * Each circuit has its own verifier contract that validates proofs on-chain.
 */
export interface VerifierContract {
  /** Verifier contract address (checksummed) */
  address: string;
  /** Chain ID where contract is deployed (e.g., 84532 for Base Sepolia) */
  chainId: number;
  /** Contract ABI for verify function (ethers v6 format) */
  abi: string[];
}

/**
 * ZKProofPort SDK configuration options.
 *
 * Allows customization of deep link scheme, default callback URL,
 * and verifier contract addresses.
 *
 * @example
 * ```typescript
 * const config: ProofPortConfig = {
 *   scheme: 'myapp',
 *   defaultCallbackUrl: 'https://myapp.com/proof-callback',
 *   verifiers: {
 *     coinbase_attestation: {
 *       address: '0x1234...',
 *       chainId: 84532,
 *       abi: VERIFIER_ABI
 *     }
 *   }
 * };
 *
 * const sdk = new ProofPortSDK(config);
 * ```
 */
export interface ProofPortConfig {
  /** Deep link URL scheme (default: 'zkproofport') */
  scheme?: string;
  /** Default callback URL for proof responses (can be overridden per request) */
  defaultCallbackUrl?: string;
  /** Custom verifier contract addresses per circuit type (overrides defaults) */
  verifiers?: Partial<Record<CircuitType, VerifierContract>>;
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
 * Nullifier verification status returned by smart contract.
 *
 * Mirrors the NullifierVerifyStatus enum in the ZKProofPortNullifierRegistry contract.
 * Indicates the result of verifying and registering a proof's nullifier on-chain.
 *
 * - `verified_and_registered`: Proof verified and nullifier registered successfully
 * - `already_registered`: Proof verified but nullifier was already used (duplicate)
 * - `expired_and_reregistered`: Previous nullifier expired, new one registered
 * - `verification_failed`: Proof verification failed (invalid proof)
 * - `circuit_not_found`: Circuit not registered in the registry
 */
export type NullifierVerifyStatus =
  | 'verified_and_registered'
  | 'already_registered'
  | 'expired_and_reregistered'
  | 'verification_failed'
  | 'circuit_not_found';

/**
 * On-chain nullifier record from smart contract storage.
 *
 * Contains information about a registered nullifier retrieved from
 * the ZKProofPortNullifierRegistry contract.
 *
 * @example
 * ```typescript
 * const record: NullifierRecord = {
 *   registeredAt: 1707234567,
 *   scope: '0xabcd...',
 *   circuitId: '0x1234...'
 * };
 * ```
 */
export interface NullifierRecord {
  /** Unix timestamp (seconds) when nullifier was registered */
  registeredAt: number;
  /** Scope bytes32 (application identifier) */
  scope: string;
  /** Circuit ID bytes32 (circuit identifier) */
  circuitId: string;
}

/**
 * ZKProofPortNullifierRegistry smart contract configuration.
 *
 * Contains the address and ABI for the nullifier registry contract,
 * which tracks used nullifiers to prevent proof replay attacks.
 *
 * @example
 * ```typescript
 * const registryConfig: NullifierRegistryConfig = {
 *   address: '0x5678...',
 *   chainId: 84532,
 *   abi: ZKPROOFPORT_NULLIFIER_REGISTRY_ABI
 * };
 * ```
 */
export interface NullifierRegistryConfig {
  /** Registry contract address (checksummed) */
  address: string;
  /** Chain ID where registry is deployed */
  chainId: number;
  /** Contract ABI (ethers v6 format) */
  abi: string[];
}
