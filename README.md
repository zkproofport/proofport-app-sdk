# @zkproofport-app/sdk

> **Beta** — Currently deployed on **Base Sepolia (testnet)** only. APIs may change before the stable release.

TypeScript SDK for requesting zero-knowledge proofs from the [ZKProofPort](https://zkproofport.com) mobile app and verifying them on-chain.

## How It Works

```
┌──────────────┐     ┌─────────┐     ┌──────────────┐     ┌──────────────────┐
│ Your Web App │────>│   SDK   │────>│ QR Code /    │────>│ ZKProofPort App  │
│              │     │         │     │ Deep Link    │     │                  │
│              │     │ creates │     │              │     │ - Connects wallet│
│              │     │ request │     │ User scans / │     │ - Fetches data   │
│              │     │         │     │ taps link    │     │ - Generates proof│
└──────┬───────┘     └─────────┘     └──────────────┘     └────────┬─────────┘
       │                                                           │
       │  ┌─────────────────────────────────────────────────┐      │
       │  │              Callback URL                       │<─────┘
       │  │  (proof, publicInputs, nullifier, status)       │
       │  └─────────────────────┬───────────────────────────┘
       │                        │
       v                        v
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  SDK parses  │────>│  On-chain verify  │────>│  Access granted   │
│  response    │     │  (Base Sepolia)   │     │  or denied        │
└──────────────┘     └──────────────────┘     └───────────────────┘
```

1. Your app uses the SDK to create a proof request
2. The SDK generates a QR code (desktop) or deep link (mobile) for the user
3. The user opens the ZKProofPort app, which connects their wallet, fetches attestation data, and generates the ZK proof
4. The app redirects to your callback URL with the proof result
5. Your app uses the SDK to parse the response and verify the proof on-chain

## Installation

```bash
npm install @zkproofport-app/sdk@beta
```

> This package is published under the `beta` dist-tag. Use `@beta` to install.

**Peer dependency:**

```bash
npm install ethers
# Supports ethers >=5.7.0 || >=6.0.0
```

## Quick Start

```typescript
import { ProofPortSDK } from '@zkproofport-app/sdk';

// 1. Initialize SDK
const sdk = new ProofPortSDK({
  defaultCallbackUrl: 'https://myapp.com/callback',
});

// 2. Create a proof request
const request = sdk.createCoinbaseKycRequest({
  scope: 'myapp.com',
});

// 3. Generate QR code (desktop) or deep link (mobile)
const result = await sdk.requestProof(request);

if (result.mobile) {
  // App opened directly on mobile
} else {
  // Show QR code for desktop users to scan
  document.getElementById('qr').src = result.qrDataUrl;
}

// 4. Parse the proof response from your callback endpoint
const response = sdk.parseResponse(callbackUrl);

if (response?.status === 'completed') {
  console.log('Proof:', response.proof);
  console.log('Nullifier:', response.nullifier);

  // 5. Verify the proof on-chain
  const verification = await sdk.verifyResponseOnChain(response);
  console.log('Valid:', verification.valid);
}
```

## Supported Circuits

### `coinbase_attestation`

Proves that a user has completed Coinbase KYC identity verification without revealing any personal information.

**Your inputs:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (e.g., your domain name). Used to generate a unique nullifier per app, preventing cross-app tracking. |

> The ZKProofPort app handles wallet connection and attestation data retrieval automatically. You only need to provide the `scope`.

```typescript
const request = sdk.createCoinbaseKycRequest({
  scope: 'myapp.com',
});
```

### `coinbase_country_attestation`

Proves a user's country based on Coinbase verification, supporting both inclusion and exclusion checks, without revealing the actual country.

**Your inputs:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (e.g., your domain name) |
| `countryList` | `string[]` | Yes | ISO 3166-1 alpha-2 country codes (e.g., `['US', 'KR']`) |
| `isIncluded` | `boolean` | Yes | `true` = prove user IS from listed countries; `false` = prove user is NOT |

> The ZKProofPort app handles wallet connection and attestation data retrieval automatically.

```typescript
// Prove the user is from the US or South Korea
const request = sdk.createCoinbaseCountryRequest({
  scope: 'myapp.com',
  countryList: ['US', 'KR'],
  isIncluded: true,
});
```

## Integration Guide

### Step 1: Initialize the SDK

```typescript
import { ProofPortSDK } from '@zkproofport-app/sdk';

const sdk = new ProofPortSDK({
  defaultCallbackUrl: 'https://myapp.com/callback',
});
```

**Configuration:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultCallbackUrl` | `string` | No | Default callback URL for receiving proof responses. Can be overridden per request. |
| `verifiers` | `object` | No | Custom verifier contract addresses per circuit. See [Custom Verifier Contracts](#custom-verifier-contracts). |
| `scheme` | `string` | No | Custom deep link URL scheme (default: `'zkproofport'`). For advanced use only. |

### Step 2: Create a Proof Request

Use circuit-specific methods to create a request:

```typescript
// Coinbase KYC
const kycRequest = sdk.createCoinbaseKycRequest(
  { scope: 'myapp.com' },
  {
    callbackUrl: 'https://myapp.com/callback',
    message: 'Please verify your identity',
    dappName: 'My DApp',
    dappIcon: 'https://myapp.com/icon.png',
    expiresInMs: 600000,  // 10 minutes (default)
  }
);

// Coinbase Country
const countryRequest = sdk.createCoinbaseCountryRequest(
  {
    scope: 'myapp.com',
    countryList: ['US', 'KR'],
    isIncluded: true,
  },
  { dappName: 'My DApp' }
);
```

For dynamic circuit selection at runtime, use the generic method:

```typescript
const request = sdk.createProofRequest('coinbase_attestation', { scope: 'myapp.com' });
```

**Request options** (second argument, shared across all creation methods):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `callbackUrl` | `string` | No | URL to redirect after proof generation. Overrides `defaultCallbackUrl`. |
| `message` | `string` | No | Custom message displayed to the user in the ZKProofPort app |
| `dappName` | `string` | No | Your app name shown in the ZKProofPort app |
| `dappIcon` | `string` | No | Your app icon URL shown in the ZKProofPort app |
| `expiresInMs` | `number` | No | Request expiration in milliseconds (default: `600000` = 10 minutes) |

### Step 3: Display QR Code or Open App

#### `requestProof(request, qrOptions?)` -- recommended

Automatically detects the platform: opens the app on mobile, generates a QR code on desktop.

```typescript
const result = await sdk.requestProof(request, { width: 400 });
```

**Return fields:**

| Field | Type | Description |
|-------|------|-------------|
| `deepLink` | `string` | The `zkproofport://` deep link URL |
| `qrDataUrl` | `string \| undefined` | PNG data URL of the QR code. Only present on desktop (`mobile === false`). |
| `mobile` | `boolean` | `true` if the app was opened directly on mobile |

#### `generateQRCode(requestOrUrl, options?)`

Generates a QR code as a PNG data URL. Accepts a `ProofRequest` or a deep link URL string.

```typescript
const dataUrl = await sdk.generateQRCode(request, { width: 300 });
document.getElementById('qr').src = dataUrl;
```

**QR code options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `width` | `number` | `300` | Width in pixels |
| `errorCorrectionLevel` | `'L'\|'M'\|'Q'\|'H'` | `'M'` | Error correction level |
| `margin` | `number` | `4` | Quiet zone margin |
| `darkColor` | `string` | `'#000000'` | Foreground color |
| `lightColor` | `string` | `'#ffffff'` | Background color |

**Other QR methods:**

- **`generateQRCodeSVG(requestOrUrl, options?)`** -- Returns an SVG string instead of a PNG data URL.
- **`renderQRCodeToCanvas(canvas, requestOrUrl, options?)`** -- Renders directly onto an `HTMLCanvasElement`.
- **`checkQRCodeSize(requestOrUrl)`** -- Checks whether the encoded request fits within QR code data limits. Returns `{ size, withinLimit }`.

### Step 4: Handle the Callback

When the user completes proof generation, the ZKProofPort app redirects to your callback URL with query parameters containing the result.

#### `parseResponse(url)`

Parses the callback URL into a structured response object.

```typescript
// In your callback endpoint
const response = sdk.parseResponse(callbackUrl);
```

Returns `ProofResponse | null`.

**ProofResponse fields:**

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Matches the original request ID |
| `circuit` | `CircuitType` | Circuit used for proof generation |
| `status` | `'completed' \| 'error' \| 'cancelled'` | Result status |
| `proof` | `string` | Hex-encoded proof (when status is `'completed'`) |
| `publicInputs` | `string[]` | Public inputs array (when status is `'completed'`) |
| `nullifier` | `string` | Unique nullifier for duplicate detection |
| `timestamp` | `number` | Unix timestamp (ms) when the proof was generated |
| `error` | `string` | Error message (when status is `'error'`) |

#### `isProofPortResponse(url)`

Checks if a URL contains ZKProofPort response parameters. Useful for filtering incoming requests.

```typescript
if (sdk.isProofPortResponse(url)) {
  const response = sdk.parseResponse(url);
}
```

#### Request tracking

The SDK caches created requests in memory so you can match responses to requests:

- **`getPendingRequest(requestId)`** -- Retrieves the original `ProofRequest` by ID.
- **`clearPendingRequest(requestId)`** -- Removes a request from the cache after processing.

```typescript
const original = sdk.getPendingRequest(response.requestId);
// ... process ...
sdk.clearPendingRequest(response.requestId);
```

### Step 5: Verify On-Chain

#### `verifyResponseOnChain(response, providerOrSigner?)` -- recommended

The simplest way to verify a proof. Pass the entire `ProofResponse` object and the SDK handles everything.

```typescript
if (response?.status === 'completed') {
  const result = await sdk.verifyResponseOnChain(response);

  if (result.valid) {
    console.log('Proof verified on-chain!');
  } else {
    console.error('Verification failed:', result.error);
  }
}
```

Returns `Promise<{ valid: boolean; error?: string }>`.

If no `providerOrSigner` is provided, the SDK uses a default public RPC endpoint based on the chain ID in the response.

#### `verifyOnChain(circuit, proof, publicInputs, providerOrSigner?)` -- lower-level

For cases where you need more control over the verification parameters:

```typescript
const result = await sdk.verifyOnChain(
  response.circuit,
  response.proof,
  response.publicInputs,
  provider  // optional ethers Provider or Signer
);
```

Returns `Promise<{ valid: boolean; error?: string }>`.

## Advanced Usage

### Custom Verifier Contracts

By default, the SDK uses the verifier address returned by the ZKProofPort app in the proof response. To override with your own deployed verifier contracts:

```typescript
import { ProofPortSDK, VERIFIER_ABI } from '@zkproofport-app/sdk';

const sdk = new ProofPortSDK({
  defaultCallbackUrl: 'https://myapp.com/callback',
  verifiers: {
    coinbase_attestation: {
      address: '0xYourVerifierAddress',
      chainId: 8453,
      abi: VERIFIER_ABI,
    },
  },
});
```

**VerifierContract fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | `string` | Yes | Verifier contract address (checksummed) |
| `chainId` | `number` | Yes | Chain ID where the contract is deployed |
| `abi` | `string[]` | Yes | Contract ABI for the verify function |

Custom verifier configuration takes priority over the verifier address returned in the proof response.

### Nullifier Duplicate Detection

Nullifiers prevent the same user from submitting duplicate proofs for the same scope. The SDK provides utilities for checking nullifier status on-chain:

```typescript
import { isNullifierRegistered, getNullifierInfo } from '@zkproofport-app/sdk';

// Check if a nullifier has already been used
const isUsed = await isNullifierRegistered(nullifier, registryAddress, provider);
if (isUsed) {
  console.log('Duplicate proof detected');
}

// Get detailed registration info
const info = await getNullifierInfo(nullifier, registryAddress, provider);
if (info) {
  console.log('Registered at:', new Date(info.registeredAt * 1000));
}
```

### ethers v5/v6 Compatibility

The SDK works with both ethers v5 and v6. Provider/signer instances from either version can be passed to verification methods.

**ethers v6:**

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const result = await sdk.verifyResponseOnChain(response, provider);
```

**ethers v5:**

```typescript
import { ethers } from 'ethers';

const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
const result = await sdk.verifyResponseOnChain(response, provider);
```

### Network Configuration

The SDK includes pre-configured public RPC endpoints:

| Network | Chain ID | RPC Endpoint | Status |
|---------|----------|--------------|--------|
| Base Sepolia (testnet) | 84532 | `https://sepolia.base.org` | Active (Beta) |
| Base Mainnet | 8453 | `https://mainnet.base.org` | Coming soon |

When no provider is passed to verification methods, the SDK automatically uses the appropriate RPC endpoint based on the chain ID from the proof response.

## Types

All public types are exported from the package:

| Type | Description |
|------|-------------|
| `CircuitType` | Supported circuit identifiers (`'coinbase_attestation' \| 'coinbase_country_attestation'`) |
| `ProofRequest` | Proof request sent to the ZKProofPort app |
| `ProofResponse` | Proof response received from the ZKProofPort app |
| `ProofRequestStatus` | Request lifecycle status (`'pending' \| 'completed' \| 'error' \| 'cancelled'`) |
| `ProofPortConfig` | SDK configuration options |
| `QRCodeOptions` | QR code generation options |
| `VerifierContract` | Custom verifier contract configuration |
| `CoinbaseKycInputs` | Inputs for `coinbase_attestation` circuit |
| `CoinbaseCountryInputs` | Inputs for `coinbase_country_attestation` circuit |
| `NullifierRecord` | On-chain nullifier registration record |

```typescript
import type {
  CircuitType,
  ProofRequest,
  ProofResponse,
  ProofRequestStatus,
  ProofPortConfig,
  QRCodeOptions,
  VerifierContract,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
  NullifierRecord,
} from '@zkproofport-app/sdk';
```

## Development

```bash
npm install       # Install dependencies
npm run build     # Build SDK (output in dist/)
npm run dev       # Watch mode
npm test          # Run tests
```

## License

MIT
