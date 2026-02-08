# ZKProofport SDK Internal Reference

> Internal documentation for SDK developers and maintainers. For user-facing documentation, see [README.md](./README.md).

This document covers low-level implementation details, contract ABIs, proof formats, and internal utility functions that are removed from the public README.

## Table of Contents

1. [Deep Link Protocol](#deep-link-protocol)
2. [Public Input Layouts](#public-input-layouts)
3. [Low-Level Utility Functions](#low-level-utility-functions)
4. [Contract ABIs](#contract-abis)
5. [Internal Types](#internal-types)
6. [Constants](#constants)
7. [ethers v5/v6 Compatibility](#ethers-v5v6-compatibility)

---

## Deep Link Protocol

The ZKProofport mobile app communicates with web applications via custom URL schemes and query parameters.

### Request Format

```
zkproofport://proof-request?data=<base64url_encoded_json>
```

The `data` parameter contains a base64url-encoded JSON payload with all `ProofRequest` fields:

```typescript
{
  "requestId": "req-1234567890abcdef-abc123def456",
  "circuit": "coinbase_attestation",
  "inputs": {
    "scope": "myapp.com",
    "userAddress": "0x1234567890123456789012345678901234567890",    // optional
    "rawTransaction": "0xdeadbeef..."                              // optional
  },
  "callbackUrl": "https://myapp.com/callback",
  "message": "Verify your identity",                                // optional
  "dappName": "My DApp",                                            // optional
  "dappIcon": "https://myapp.com/icon.png",                        // optional
  "createdAt": 1707234567000,
  "expiresAt": 1707235167000                                        // optional
}
```

**Encoding Details:**
- Uses RFC 4648 base64url encoding (§5): replaces `+` with `-`, `/` with `_`, removes padding
- Supports UTF-8 characters in string fields
- JSON is minified (no whitespace)
- Works in both browser and Node.js environments

### Callback Response Format

```
https://myapp.com/callback?requestId=req-...&status=completed&proof=0x...&publicInputs=0x...,0x...&nullifier=0x...
```

**Query Parameters (success case, status=completed):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `requestId` | string | Matches original request ID for correlation |
| `status` | string | `completed` for successful proofs |
| `proof` | string | Proof bytes as hex string with `0x` prefix |
| `publicInputs` | string | Comma-separated hex strings, each with `0x` prefix |
| `numPublicInputs` | number | Count of public inputs (must match circuit specification) |
| `nullifier` | string | Unique identifier for duplicate detection |
| `timestamp` | number | Unix timestamp (ms) when proof was generated |
| `circuit` | string | Circuit type used (for reference) |
| `verifierAddress` | string | Verifier contract address (optional, provided by app) |
| `chainId` | number | Chain ID where verifier is deployed (optional) |

**Query Parameters (error case, status=error):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `requestId` | string | Matches original request ID |
| `status` | string | `error` for failed proofs |
| `error` | string | Error message explaining the failure |

**Query Parameters (user cancellation, status=cancelled):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `requestId` | string | Matches original request ID |
| `status` | string | `cancelled` when user dismisses request |

---

## Public Input Layouts

The mobile app returns proof results with public inputs as a flattened array. Each circuit has a specific byte layout that must be respected for verification.

### Coinbase Attestation (coinbase_attestation)

**Circuit public inputs count: 2**

The public inputs array contains 2 bytes32 values (64 bytes total):

| Field | Bytes | Size | Description |
|-------|-------|------|-------------|
| signal_hash | 0-31 | 32 bytes | Hash of the user's wallet address and scope |
| merkle_root | 32-63 | 32 bytes | Root of the signer merkle tree from Coinbase |

**Nullifier and Scope Derivation:**

The on-chain registry extracts the nullifier and scope from the public inputs:

```
nullifier = keccak256(keccak256(address + signalHash) + scope)
```

Where:
- `address` is the user's wallet address
- `signalHash` is derived from the public inputs
- `scope` is the application-specific identifier

### Coinbase Country Attestation (coinbase_country_attestation)

**Circuit public inputs count: 14**

The public inputs array contains 14 bytes32 values (448 bytes total):

| Field | Bytes | Size | Description |
|-------|-------|------|-------------|
| signal_hash | 0-31 | 32 bytes | Hash of wallet address and scope |
| merkle_root | 32-63 | 32 bytes | Signer merkle tree root |
| country_list | 64-83 | 20 bytes | Packed country codes (ISO 3166-1 alpha-2) |
| country_list_length | 84 | 1 byte | Number of countries in the list |
| is_included | 85 | 1 byte | 1 if user IS in list, 0 if NOT in list |
| scope | 86-117 | 32 bytes | Application-specific identifier |
| reserved (padding) | 118-191 | 74 bytes | Unused; set to 0x00 |
| nullifier | 192-223 | 32 bytes | Unique proof identifier |
| reserved (padding) | 224-447 | 224 bytes | Unused; set to 0x00 |

**Country Codes:**

Country lists are packed as `uint160` (20 bytes), with each country code occupying 1 byte:

```typescript
// Example: ['US', 'KR', 'JP']
// Packed: 0x{US_BYTE}{KR_BYTE}{JP_BYTE}...
// where {COUNTRY_BYTE} = (char1 << 8) | char2
```

---

## Low-Level Utility Functions

### Deep Link Utilities

#### `generateRequestId()`

Generates a unique request ID combining a timestamp and random string.

**Returns:** `string` in format `"req-{timestamp36}-{random8}"`

**Implementation Details:**
- Timestamp is base36-encoded (8-10 characters)
- Random suffix is 8 characters of base36 from `Math.random()`
- Sufficient entropy for concurrent requests

```typescript
import { generateRequestId } from '@zkproofport-app/sdk';

const id = generateRequestId();
// "req-lh8k3f2g-a9b7c4d2"
```

#### `encodeData(data: object): string`

Encodes an object to base64url format for use in deep link URLs.

**Parameters:**
- `data` - Any serializable object

**Returns:** Base64url-encoded string (URL-safe)

**Example:**

```typescript
import { encodeData } from '@zkproofport-app/sdk';

const encoded = encodeData({ circuit: 'coinbase_attestation', requestId: 'req-123' });
// "eyJjaXJjdWl0IjoiY29pbmJhc2VfYXR0ZXN0YXRpb24iLCJyZXF1ZXN0SWQiOiJyZXEtMTIzIn0"
```

#### `decodeData<T>(encoded: string): T`

Decodes a base64url string back to a typed object.

**Type Parameters:**
- `T` - Expected type of decoded object

**Parameters:**
- `encoded` - Base64url-encoded string from `encodeData()`

**Returns:** Decoded object of type T

**Throws:** `SyntaxError` if decoded JSON is invalid

```typescript
import { decodeData } from '@zkproofport-app/sdk';

const request = decodeData<ProofRequest>(encodedString);
```

#### `buildProofRequestUrl(request: ProofRequest, scheme?: string): string`

Constructs a deep link URL from a proof request.

**Parameters:**
- `request` - ProofRequest to encode
- `scheme` - Custom URL scheme (default: `'zkproofport'`)

**Returns:** Complete deep link URL string

```typescript
import { buildProofRequestUrl } from '@zkproofport-app/sdk';

const url = buildProofRequestUrl(request);
// "zkproofport://proof-request?data=eyJ..."
```

#### `buildCallbackUrl(callbackUrl: string, response: ProofResponse): string`

Constructs a callback URL with proof response data as query parameters.

**Parameters:**
- `callbackUrl` - Base callback URL from the request
- `response` - ProofResponse object with status and proof data

**Returns:** Complete callback URL with response parameters

```typescript
import { buildCallbackUrl } from '@zkproofport-app/sdk';

const url = buildCallbackUrl('https://myapp.com/callback', response);
// "https://myapp.com/callback?requestId=req-123&status=completed&proof=0x..."
```

#### `parseProofRequestUrl(url: string): ProofRequest | null`

Parses a deep link URL back into a ProofRequest object.

**Parameters:**
- `url` - Deep link URL string

**Returns:** Decoded ProofRequest, or null if parsing fails

```typescript
import { parseProofRequestUrl } from '@zkproofport-app/sdk';

const url = "zkproofport://proof-request?data=eyJ...";
const request = parseProofRequestUrl(url);
```

#### `parseProofResponseUrl(url: string): ProofResponse | null`

Parses a callback URL into a ProofResponse object.

**Parameters:**
- `url` - Callback URL with response query parameters

**Returns:** Decoded ProofResponse, or null if parsing fails

```typescript
import { parseProofResponseUrl } from '@zkproofport-app/sdk';

const callbackUrl = "https://myapp.com/callback?requestId=req-123&status=completed&proof=0x...";
const response = parseProofResponseUrl(callbackUrl);
```

#### `parseDeepLink(url: string): DeepLinkComponents | null`

Parses a custom scheme URL into component parts.

**Parameters:**
- `url` - Custom scheme URL

**Returns:** Object with `scheme`, `host`, `path`, `params`, or null

```typescript
import { parseDeepLink } from '@zkproofport-app/sdk';

const url = "zkproofport://proof-request?data=abc123";
const components = parseDeepLink(url);
// {
//   scheme: "zkproofport",
//   host: "proof-request",
//   path: "",
//   params: { data: "abc123" }
// }
```

#### `isProofportDeepLink(url: string, scheme?: string): boolean`

Checks if a URL is a valid ZKProofport deep link.

**Parameters:**
- `url` - URL to check
- `scheme` - Expected scheme (default: `'zkproofport'`)

**Returns:** `true` if URL starts with the specified scheme (case-insensitive)

```typescript
import { isProofportDeepLink } from '@zkproofport-app/sdk';

isProofportDeepLink("zkproofport://proof-request?data=...");  // true
isProofportDeepLink("ZKPROOFPORT://proof-request");           // true
isProofportDeepLink("https://example.com");                   // false
```

#### `validateProofRequest(request: ProofRequest): { valid: boolean; error?: string }`

Validates a proof request for completeness and correctness.

**Parameters:**
- `request` - ProofRequest to validate

**Returns:** Object with `valid` boolean and optional `error` message

**Validation Checks:**
- Required fields: `requestId`, `circuit`, `callbackUrl`
- Circuit type is supported
- `userAddress` format (if provided): must be 42-character hex address
- `countryList` (if provided): non-empty string array
- `isIncluded` (if provided): boolean
- Expiration: `expiresAt` must not be in the past

```typescript
import { validateProofRequest } from '@zkproofport-app/sdk';

const result = validateProofRequest(request);
if (!result.valid) {
  console.error(result.error);
}
```

### QR Code Utilities

#### `generateQRCodeDataUrl(requestOrUrl: ProofRequest | string, options?: QRCodeOptions, scheme?: string): Promise<string>`

Generates a PNG QR code as a base64 data URL.

**Parameters:**
- `requestOrUrl` - ProofRequest object or pre-built deep link URL string
- `options` - QR code appearance options
- `scheme` - Custom URL scheme (default: `'zkproofport'`)

**Returns:** Promise resolving to `data:image/png;base64,...` string

**Throws:** Error if URL exceeds `MAX_QR_DATA_SIZE` (2953 bytes)

```typescript
import { generateQRCodeDataUrl } from '@zkproofport-app/sdk';

const dataUrl = await generateQRCodeDataUrl(request, { width: 400 });
// Use in HTML: <img src={dataUrl} alt="Scan to prove" />
```

#### `generateQRCodeSVG(requestOrUrl: ProofRequest | string, options?: QRCodeOptions, scheme?: string): Promise<string>`

Generates an SVG QR code as a string.

**Parameters:**
- `requestOrUrl` - ProofRequest object or deep link URL
- `options` - QR code appearance options
- `scheme` - Custom URL scheme (default: `'zkproofport'`)

**Returns:** Promise resolving to SVG markup string

```typescript
import { generateQRCodeSVG } from '@zkproofport-app/sdk';

const svg = await generateQRCodeSVG(request);
// Can be embedded directly in HTML or saved to file
```

#### `generateQRCodeToCanvas(canvas: HTMLCanvasElement, requestOrUrl: ProofRequest | string, options?: QRCodeOptions, scheme?: string): Promise<void>`

Renders a QR code directly onto an HTML canvas element.

**Parameters:**
- `canvas` - HTMLCanvasElement to render to
- `requestOrUrl` - ProofRequest object or deep link URL
- `options` - QR code appearance options
- `scheme` - Custom URL scheme (default: `'zkproofport'`)

**Returns:** Promise that resolves when rendering is complete

```typescript
import { generateQRCodeToCanvas } from '@zkproofport-app/sdk';

const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
await generateQRCodeToCanvas(canvas, request);
```

#### `estimateQRDataSize(requestOrUrl: ProofRequest | string, scheme?: string): { size: number; withinLimit: boolean }`

Estimates the size of encoded request data to check QR code compatibility.

**Parameters:**
- `requestOrUrl` - ProofRequest object or deep link URL
- `scheme` - Custom URL scheme (default: `'zkproofport'`)

**Returns:** Object with `size` (bytes) and `withinLimit` (boolean)

```typescript
import { estimateQRDataSize } from '@zkproofport-app/sdk';

const { size, withinLimit } = estimateQRDataSize(request);
if (!withinLimit) {
  console.warn(`Request too large for QR: ${size} bytes (max: 2953)`);
}
```

### Verification Utilities

#### `parseProofForOnChain(proof: string, publicInputs: string[], numPublicInputs: number): ParsedProof`

Formats proof data for on-chain verification by ensuring correct hex encoding and padding.

**Parameters:**
- `proof` - Proof hex string (with or without `0x` prefix)
- `publicInputs` - Array of public input hex strings
- `numPublicInputs` - Expected number of public inputs

**Returns:** `ParsedProof` object with formatted hex strings

**Details:**
- Zero-pads public inputs to bytes32 (32 bytes / 64 hex characters)
- Ensures all values have `0x` prefix
- Verifies public inputs count matches specification

```typescript
import { parseProofForOnChain } from '@zkproofport-app/sdk';

const parsed = parseProofForOnChain(response.proof, response.publicInputs, 2);
// { proofHex: "0x...", publicInputsHex: ["0x...", "0x..."], numPublicInputs: 2 }
```

#### `verifyProofOnChain(circuit: CircuitType, parsedProof: ParsedProof, provider?: Provider, customVerifier?: VerifierContract, responseVerifier?: { verifierAddress?: string; chainId?: number }): Promise<{ valid: boolean; error?: string }>`

Low-level on-chain verification by calling the verifier smart contract.

**Parameters:**
- `circuit` - Circuit type identifier
- `parsedProof` - Parsed proof from `parseProofForOnChain()`
- `provider` - ethers Provider (v5 or v6 compatible); if omitted, uses default RPC
- `customVerifier` - Custom verifier config (overrides all others)
- `responseVerifier` - Verifier info from proof response

**Returns:** Promise with verification result

**Verifier Resolution Order:**
1. `customVerifier` (if provided)
2. `responseVerifier` (from proof response)
3. Default verifier address (if any)

```typescript
import { verifyProofOnChain, parseProofForOnChain } from '@zkproofport-app/sdk';

const parsed = parseProofForOnChain(proof, publicInputs, 2);
const result = await verifyProofOnChain('coinbase_attestation', parsed, provider);
```

#### `getVerifierContract(providerOrSigner: Provider | Signer, verifier: VerifierContract): ethers.Contract`

Creates an ethers Contract instance for a verifier smart contract.

**Parameters:**
- `providerOrSigner` - ethers Provider or Signer (v5 or v6)
- `verifier` - Verifier configuration with address and ABI

**Returns:** ethers.Contract instance

```typescript
import { getVerifierContract, VERIFIER_ABI } from '@zkproofport-app/sdk';

const contract = getVerifierContract(provider, {
  address: '0x...',
  chainId: 84532,
  abi: VERIFIER_ABI
});

const isValid = await contract.verify(proofBytes, publicInputs);
```

#### `getDefaultProvider(chainId: number): JsonRpcProvider`

Creates a JsonRpcProvider for a chain using pre-configured RPC endpoints.

**Parameters:**
- `chainId` - Chain ID (e.g., 84532 for Base Sepolia, 8453 for Base Mainnet)

**Returns:** ethers.JsonRpcProvider instance

**Throws:** Error if no RPC endpoint is configured for the chain

```typescript
import { getDefaultProvider } from '@zkproofport-app/sdk';

const provider = getDefaultProvider(84532); // Base Sepolia
```

#### `getVerifierAddress(circuit: CircuitType, customVerifier?: VerifierContract): string | null`

Gets the verifier contract address for a circuit.

**Parameters:**
- `circuit` - Circuit type identifier
- `customVerifier` - Custom verifier config (if any)

**Returns:** Checksummed address string, or null if not found

#### `getVerifierChainId(circuit: CircuitType, customVerifier?: VerifierContract): number | null`

Gets the chain ID where a circuit's verifier is deployed.

**Parameters:**
- `circuit` - Circuit type identifier
- `customVerifier` - Custom verifier config (if any)

**Returns:** Chain ID number, or null if not found

#### `extractNullifierFromPublicInputs(publicInputsHex: string[], circuit?: CircuitType): string | null`

Extracts the nullifier (bytes32) from a public inputs array.

**Parameters:**
- `publicInputsHex` - Array of public input hex strings
- `circuit` - Circuit type (optional, for validation)

**Returns:** Nullifier as hex string with `0x` prefix, or null if not found

**Circuit-Specific Byte Offsets:**
- `coinbase_attestation`: fields at byte offsets 96-127 (32 consecutive field elements)
- `coinbase_country_attestation`: fields at byte offsets 118-149 (32 consecutive field elements)

```typescript
import { extractNullifierFromPublicInputs } from '@zkproofport-app/sdk';

const nullifier = extractNullifierFromPublicInputs(response.publicInputs, 'coinbase_attestation');
```

#### `extractScopeFromPublicInputs(publicInputsHex: string[], circuit?: CircuitType): string | null`

Extracts the scope (bytes32) from a public inputs array.

**Parameters:**
- `publicInputsHex` - Array of public input hex strings
- `circuit` - Circuit type (optional, for validation)

**Returns:** Scope as hex string with `0x` prefix, or null if not found

**Circuit-Specific Byte Offsets:**
- `coinbase_attestation`: fields at byte offsets 64-95 (32 consecutive field elements)
- `coinbase_country_attestation`: fields at byte offsets 86-117 (32 consecutive field elements)

#### `isNullifierRegistered(nullifier: string, registryAddress: string, provider: Provider): Promise<boolean>`

Checks if a nullifier has been registered on-chain.

**Parameters:**
- `nullifier` - Nullifier bytes32 value
- `registryAddress` - ZKProofportNullifierRegistry contract address
- `provider` - ethers Provider

**Returns:** Promise<boolean> - true if registered (already used)

```typescript
import { isNullifierRegistered } from '@zkproofport-app/sdk';

const isUsed = await isNullifierRegistered(nullifier, registryAddress, provider);
if (isUsed) {
  console.log('This proof has already been submitted');
}
```

#### `getNullifierInfo(nullifier: string, registryAddress: string, provider: Provider): Promise<NullifierRecord | null>`

Retrieves detailed registration information for a nullifier.

**Parameters:**
- `nullifier` - Nullifier bytes32 value
- `registryAddress` - ZKProofportNullifierRegistry contract address
- `provider` - ethers Provider

**Returns:** Promise<NullifierRecord | null> with registration details

**NullifierRecord fields:**
- `registeredAt` - Unix timestamp (seconds)
- `scope` - Scope bytes32 (application identifier)
- `circuitId` - Circuit ID bytes32

```typescript
import { getNullifierInfo } from '@zkproofport-app/sdk';

const info = await getNullifierInfo(nullifier, registryAddress, provider);
if (info) {
  console.log('Registered at:', new Date(info.registeredAt * 1000));
  console.log('Scope:', info.scope);
  console.log('Circuit:', info.circuitId);
}
```

---

## Contract ABIs

### Verifier ABI

Standard ABI for all Barretenberg-generated verifier contracts (ethers v6 human-readable format):

```typescript
const VERIFIER_ABI = [
  'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];
```

**Function Signature:**

```solidity
function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)
```

**Parameters:**
- `_proof` - Proof bytes from the mobile app
- `_publicInputs` - Array of bytes32 public inputs

**Returns:** `true` if proof is valid, `false` otherwise

**Example (ethers):**

```typescript
import { ethers } from 'ethers';
import { VERIFIER_ABI } from '@zkproofport-app/sdk';

const verifier = new ethers.Contract(verifierAddress, VERIFIER_ABI, provider);
const isValid = await verifier.verify(proofBytes, publicInputs);
```

### ZKProofportNullifierRegistry ABI (V2)

Current nullifier registry interface with relayer-only registration (ethers v6 format):

```typescript
const ZKPROOFPORT_NULLIFIER_REGISTRY_ABI = [
  'function isNullifierRegistered(bytes32 _nullifier) external view returns (bool)',
  'function getNullifierInfo(bytes32 _nullifier) external view returns (uint64 registeredAt, bytes32 scope, bytes32 circuitId)',
  'function verifyOnly(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
  'event NullifierRegistered(bytes32 indexed nullifier, bytes32 indexed scope, bytes32 indexed circuitId)',
];
```

**Functions:**

#### `isNullifierRegistered(bytes32 _nullifier): bool`

Checks if a nullifier has been registered.

**Returns:** `true` if already used, `false` if new

#### `getNullifierInfo(bytes32 _nullifier): (uint64, bytes32, bytes32)`

Retrieves registration details for a nullifier.

**Returns:** Tuple of `(registeredAt, scope, circuitId)`
- `registeredAt` - Unix timestamp in seconds
- `scope` - Application identifier
- `circuitId` - Circuit identifier

#### `verifyOnly(bytes32 _circuitId, bytes _proof, bytes32[] _publicInputs): bool`

Verifies a proof without registering the nullifier (public call).

**Parameters:**
- `_circuitId` - bytes32 circuit ID
- `_proof` - Proof bytes
- `_publicInputs` - Public inputs array

**Returns:** `true` if proof is valid

**Event:**

```solidity
event NullifierRegistered(bytes32 indexed nullifier, bytes32 indexed scope, bytes32 indexed circuitId)
```

Emitted when a nullifier is registered (by relayer only).

### Legacy NullifierRegistry ABI (V1 - Deprecated)

Do not use for new integrations. Kept for reference only:

```typescript
const NULLIFIER_REGISTRY_ABI = [
  'function registerCircuit(bytes32 _circuitId, address _verifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
  'function updateCircuit(bytes32 _circuitId, address _newVerifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
  'function verifyAndRegister(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external returns (bool)',
  'function isNullifierUsed(bytes32 _nullifier) external view returns (bool)',
  'function getScope(bytes32 _nullifier) external view returns (bytes32)',
  'function getCircuit(bytes32 _nullifier) external view returns (bytes32)',
  'function verifyOnly(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
  'event CircuitRegistered(bytes32 indexed circuitId, address verifier)',
  'event CircuitUpdated(bytes32 indexed circuitId, address newVerifier)',
  'event NullifierRegistered(bytes32 indexed nullifier, bytes32 indexed scope, bytes32 indexed circuitId)',
];
```

---

## Internal Types

### ParsedProof

Internal proof format for on-chain verification:

```typescript
interface ParsedProof {
  /** Proof bytes as hex string with 0x prefix */
  proofHex: string;
  /** Public inputs as array of hex strings with 0x prefix */
  publicInputsHex: string[];
  /** Number of public inputs (must match circuit specification) */
  numPublicInputs: number;
}
```

### DeepLinkComponents

Deep link URL broken into constituent parts:

```typescript
interface DeepLinkComponents {
  /** URL scheme (e.g., 'zkproofport') */
  scheme: string;
  /** URL host (e.g., 'proof-request') */
  host: string;
  /** URL path (usually empty for proof-request) */
  path: string;
  /** Query parameters as key-value pairs */
  params: Record<string, string>;
}
```

### NullifierVerifyStatus

Status returned by nullifier registry during proof verification:

```typescript
type NullifierVerifyStatus =
  | 'verified_and_registered'      // New proof, successfully verified and registered
  | 'already_registered'            // Proof verified but nullifier already used (duplicate)
  | 'expired_and_reregistered'      // Previous registration expired, new one registered
  | 'verification_failed'           // Proof verification failed (invalid proof)
  | 'circuit_not_found';            // Circuit not registered in the registry
```

### NullifierRecord

On-chain nullifier registration record:

```typescript
interface NullifierRecord {
  /** Unix timestamp (seconds) when nullifier was registered */
  registeredAt: number;
  /** Scope bytes32 (application identifier) */
  scope: string;
  /** Circuit ID bytes32 (circuit identifier) */
  circuitId: string;
}
```

### NullifierRegistryConfig

Nullifier registry contract configuration:

```typescript
interface NullifierRegistryConfig {
  /** Registry contract address (checksummed) */
  address: string;
  /** Chain ID where registry is deployed */
  chainId: number;
  /** Contract ABI (ethers v6 format) */
  abi: string[];
}
```

---

## Constants

### Default Values

```typescript
/** Default deep link URL scheme */
const DEFAULT_SCHEME = 'zkproofport';

/** Default proof request expiration time in milliseconds */
const DEFAULT_REQUEST_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)

/** Maximum data size for QR codes (Version 40, L error correction) */
const MAX_QR_DATA_SIZE = 2953; // bytes
```

### Deep Link Hosts

```typescript
const DEEP_LINK_HOSTS = {
  PROOF_REQUEST: 'proof-request',    // For requests sent to mobile app
  PROOF_RESPONSE: 'proof-response',   // For responses from mobile app (internal use)
} as const;
```

### RPC Endpoints

Pre-configured public RPC endpoints by chain ID:

```typescript
const RPC_ENDPOINTS: Record<number, string> = {
  84532: 'https://sepolia.base.org',  // Base Sepolia (testnet)
  8453: 'https://mainnet.base.org',   // Base Mainnet (production)
};
```

### Circuit Metadata

Metadata for all supported circuits:

```typescript
const CIRCUIT_METADATA: Record<CircuitType, {
  name: string;
  description: string;
  publicInputsCount: number;
  publicInputNames: string[];
}> = {
  coinbase_attestation: {
    name: 'Coinbase KYC',
    description: 'Prove Coinbase identity verification',
    publicInputsCount: 2,
    publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
  },
  coinbase_country_attestation: {
    name: 'Coinbase Country',
    description: 'Prove Coinbase country verification',
    publicInputsCount: 14,
    publicInputNames: [
      'signal_hash',
      'signer_list_merkle_root',
      'country_list',
      'country_list_length',
      'is_included',
      // ... additional padding
    ],
  },
};
```

### Public Input Byte Layouts

Offsets for extracting values from public inputs arrays:

**Coinbase Attestation:**

```typescript
const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  SCOPE_START: 64,
  SCOPE_END: 95,
  NULLIFIER_START: 96,
  NULLIFIER_END: 127,
} as const;
```

**Coinbase Country Attestation:**

```typescript
const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  COUNTRY_LIST_START: 64,
  COUNTRY_LIST_END: 83,
  COUNTRY_LIST_LENGTH: 84,
  IS_INCLUDED: 85,
  SCOPE_START: 86,
  SCOPE_END: 117,
  NULLIFIER_START: 118,
  NULLIFIER_END: 149,
} as const;
```

---

## ethers v5/v6 Compatibility

The SDK supports both ethers v5 and v6 through compatibility shims.

### Version Detection

The SDK detects the ethers version at runtime and uses the appropriate API:

```typescript
// ethers v6 API
const hexZeroPad = ethers.zeroPadValue(value, 32);
const provider = new ethers.JsonRpcProvider(rpcUrl);

// ethers v5 API (fallback)
const hexZeroPad = ethers.utils.hexZeroPad(value, 32);
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
```

### Provider/Signer Compatibility

Both v5 and v6 provider/signer instances work with SDK verification methods:

**ethers v6:**

```typescript
import { ethers } from 'ethers';
import { verifyResponseOnChain } from '@zkproofport-app/sdk';

const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const result = await verifyResponseOnChain(response, provider);
```

**ethers v5:**

```typescript
import { ethers } from 'ethers';
import { verifyResponseOnChain } from '@zkproofport-app/sdk';

const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
const result = await verifyResponseOnChain(response, provider);
```

### Utility Functions

Key utility function signatures that differ between versions:

| Function | ethers v6 | ethers v5 |
|----------|-----------|-----------|
| Zero-pad hex | `ethers.zeroPadValue(value, 32)` | `ethers.utils.hexZeroPad(value, 32)` |
| JSON-RPC Provider | `new ethers.JsonRpcProvider(url)` | `new ethers.providers.JsonRpcProvider(url)` |
| Create Contract | `new ethers.Contract(addr, abi, provider)` | `new ethers.Contract(addr, abi, provider)` |

The SDK handles version detection automatically, so you don't need to worry about these differences.

---

## Advanced: Pre-filling Wallet Address and Attestation Data

The SDK supports optional pre-filling of wallet address and raw attestation data for advanced integrations:

```typescript
const request = sdk.createCoinbaseKycRequest({
  scope: 'myapp.com',
  userAddress: '0x1234567890123456789012345678901234567890',
  rawTransaction: '0xdeadbeef...',
});
```

**When provided:**
- `userAddress` - The mobile app skips the wallet connection step
- `rawTransaction` - The mobile app skips the attestation data fetch from Etherscan

**When not provided:**
- The mobile app prompts the user to connect their wallet
- The mobile app fetches attestation data from Etherscan automatically

This is useful for applications that already have access to the user's wallet address or have pre-cached attestation data.

---

## See Also

- [README.md](./README.md) - User-facing documentation
- [src/types.ts](./src/types.ts) - Full TypeScript type definitions
- [src/constants.ts](./src/constants.ts) - All SDK constants
- [src/deeplink.ts](./src/deeplink.ts) - Deep link utilities
- [src/qrcode.ts](./src/qrcode.ts) - QR code generation
- [src/verifier.ts](./src/verifier.ts) - On-chain verification
