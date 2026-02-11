# @zkproofport-app/sdk

[![npm version](https://img.shields.io/npm/v/@zkproofport-app/sdk)](https://www.npmjs.com/package/@zkproofport-app/sdk)
[![license](https://img.shields.io/npm/l/@zkproofport-app/sdk)](./LICENSE)

TypeScript SDK for requesting zero-knowledge proofs from the [ZKProofport](https://zkproofport.com) mobile app and verifying them on-chain.

> **Beta** — Currently deployed on **Base Sepolia (testnet)** only. APIs may change before the stable release.

## How It Works

```
┌──────────────┐     ┌─────────┐     ┌──────────────┐     ┌──────────────────┐
│ Your Web App │────>│   SDK   │────>│ Relay Server │────>│ ZKProofport App  │
│              │     │         │     │              │     │                  │
│              │     │ login + │     │ issues ID,   │     │ - Connects wallet│
│              │     │ create  │     │ tracks state │     │ - Fetches data   │
│              │     │ request │     │              │     │ - Generates proof│
└──────┬───────┘     └─────────┘     └──────┬───────┘     └────────┬─────────┘
       │                                    │                      │
       │                                    │<─────────────────────┘
       │  ┌─────────────────────────────────┘  Proof result via
       │  │                                    relay callback
       │  v
       │  ┌──────────────────────────────────────────────────┐
       │  │  SDK receives result (WebSocket / polling)       │
       │  │  (proof, publicInputs, nullifier, status)        │
       │  └─────────────────────┬────────────────────────────┘
       │                        │
       v                        v
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Verify      │────>│  On-chain verify  │────>│  Access granted   │
│  on-chain    │     │  (Base Sepolia)   │     │  or denied        │
└──────────────┘     └──────────────────┘     └───────────────────┘
```

1. Your app authenticates with the relay and creates a proof request via the SDK
2. The relay issues a tracked request ID and returns a deep link
3. The SDK displays a QR code (desktop) or opens the deep link (mobile)
4. The user opens the ZKProofport app, which generates the ZK proof
5. The proof result flows back through the relay to your app via WebSocket (or polling)
6. Your app verifies the proof on-chain

## Installation

```bash
npm install @zkproofport-app/sdk@beta
```

> Published under the `beta` dist-tag. Use `@beta` to install.

**Peer dependency (required for on-chain verification):**

```bash
npm install ethers
```

## Quick Start

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

// 1. Initialize
const sdk = ProofportSDK.create();

// 2. Authenticate
await sdk.login({ clientId: 'your-client-id', apiKey: 'your-api-key' });

// 3. Create proof request via relay
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
});

// 4. Show QR code to user
const qrDataUrl = await sdk.generateQRCode(relay.deepLink);
document.getElementById('qr').src = qrDataUrl;

// 5. Wait for proof (WebSocket primary, HTTP polling fallback)
const result = await sdk.waitForProof(relay.requestId);

if (result.status === 'completed') {
  // 6. Verify on-chain
  const verification = await sdk.verifyOnChain(
    result.circuit,
    result.proof,
    result.publicInputs
  );
  console.log('Valid:', verification.valid);
}
```

## Supported Circuits

### `coinbase_attestation`

Proves that a user has completed Coinbase KYC identity verification without revealing any personal information.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (e.g., your domain). Generates a unique nullifier per app to prevent cross-app tracking. |

```typescript
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
});
```

### `coinbase_country_attestation`

Proves a user's country based on Coinbase verification, supporting inclusion and exclusion checks, without revealing the actual country.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier |
| `countryList` | `string[]` | Yes | ISO 3166-1 alpha-2 country codes (e.g., `['US', 'KR']`) |
| `isIncluded` | `boolean` | Yes | `true` = prove user IS from listed countries; `false` = prove user is NOT |

```typescript
const relay = await sdk.createRelayRequest('coinbase_country_attestation', {
  scope: 'myapp.com',
  countryList: ['US', 'KR'],
  isIncluded: true,
});
```

> The ZKProofport mobile app handles wallet connection and attestation data retrieval automatically. You only provide the inputs above.

## Integration Guide

### Step 1: Initialize

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

const sdk = ProofportSDK.create();
```

`ProofportSDK.create()` returns an SDK instance pre-configured with the relay server, verifier contracts, and nullifier registry. No manual configuration is needed.

### Step 2: Authenticate

Authenticate with the relay server using your client credentials. The SDK stores the JWT token internally for subsequent requests.

```typescript
await sdk.login({
  clientId: process.env.CLIENT_ID,
  apiKey: process.env.API_KEY,
});

// Check auth status at any time
sdk.isAuthenticated(); // true
sdk.getAuthToken();    // AuthToken object
sdk.logout();          // Clear stored token
```

Get your `clientId` and `apiKey` from the [ZKProofport Dashboard](https://zkproofport.com).

### Step 3: Create Request (via Relay)

`createRelayRequest` is the **recommended** method. The relay server issues a tracked request ID, manages credits, and builds the deep link with the relay callback URL.

```typescript
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
}, {
  dappName: 'My DApp',
  dappIcon: 'https://myapp.com/icon.png',
  message: 'Verify your identity to continue',
  nonce: 'unique-nonce-123',  // Optional: replay prevention
});

// relay.requestId  — Relay-issued UUID
// relay.deepLink   — Deep link URL for the mobile app
// relay.status     — 'pending'
// relay.pollUrl    — Relative URL for HTTP polling
```

### Step 4: Display QR Code

Generate a QR code from the relay deep link for the user to scan with the ZKProofport mobile app:

```typescript
const qrDataUrl = await sdk.generateQRCode(relay.deepLink, {
  width: 400,
  darkColor: '#1a1a1a',
  margin: 4,
});
document.getElementById('qr').src = qrDataUrl;
```

**Other QR formats:**

```typescript
// SVG string
const svg = await sdk.generateQRCodeSVG(relay.deepLink);

// Render to canvas
await sdk.renderQRCodeToCanvas(canvasElement, relay.deepLink, { width: 400 });

// Check if data fits QR limits
const { size, withinLimit } = sdk.checkQRCodeSize(relay.deepLink);
```

**Mobile:** On mobile browsers, you can redirect directly to the deep link instead of showing a QR code:

```typescript
if (ProofportSDK.isMobile()) {
  window.location.href = relay.deepLink;
}
```

### Step 5: Wait for Proof

**`waitForProof` (recommended)** — Uses WebSocket (Socket.IO) for instant delivery, with automatic HTTP polling fallback if `socket.io-client` is not installed or connection fails.

```typescript
const result = await sdk.waitForProof(relay.requestId, {
  timeoutMs: 300000, // 5 minutes (default)
  onStatusChange: (update) => {
    console.log('Status:', update.status);
  },
});
```

**Alternative: Subscribe to real-time updates directly:**

```typescript
const unsubscribe = await sdk.subscribe(relay.requestId, {
  onStatus: (data) => console.log('Status:', data.status),
  onResult: (result) => {
    if (result.status === 'completed') {
      console.log('Proof received:', result.proof);
    }
    unsubscribe();
  },
  onError: (err) => console.error(err.error),
});
```

**Alternative: HTTP polling only:**

```typescript
// Single poll
const result = await sdk.pollResult(relay.requestId);

// Poll until terminal state
const result = await sdk.waitForResult(relay.requestId, {
  intervalMs: 2000,
  timeoutMs: 300000,
  onStatusChange: (result) => console.log(result.status),
});
```

### Step 6: Verify On-Chain

Verify the proof cryptographically by calling the deployed Solidity verifier contract.

```typescript
if (result.status === 'completed') {
  const verification = await sdk.verifyOnChain(
    result.circuit,
    result.proof,
    result.publicInputs
  );

  if (verification.valid) {
    console.log('Proof verified on-chain!');
  } else {
    console.error('Verification failed:', verification.error);
  }
}
```

**Or verify from a `ProofResponse` object:**

```typescript
const verification = await sdk.verifyResponseOnChain(response);
```

### Step 7: Check Nullifier (Optional)

Nullifiers prevent the same user from submitting duplicate proofs for the same scope. The SDK is pre-configured with the nullifier registry contract.

```typescript
// Extract nullifier from proof result
const nullifier = sdk.extractNullifier(result.publicInputs, result.circuit);
const scope = sdk.extractScope(result.publicInputs, result.circuit);

// Check if already used
const isDuplicate = await sdk.checkNullifier(nullifier);
if (isDuplicate) {
  console.log('This user has already submitted a proof for this scope');
}

// Get registration details
const info = await sdk.getNullifierDetails(nullifier);
if (info) {
  console.log('Registered at:', new Date(info.registeredAt * 1000));
  console.log('Circuit:', info.circuitId);
  console.log('Scope:', info.scope);
}
```

## Complete Example

End-to-end integration using the relay flow:

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

async function verifyUser() {
  // Initialize and authenticate
  const sdk = ProofportSDK.create();
  await sdk.login({
    clientId: process.env.CLIENT_ID,
    apiKey: process.env.API_KEY,
  });

  // Create proof request via relay
  const relay = await sdk.createRelayRequest('coinbase_attestation', {
    scope: 'myapp.com',
  }, {
    dappName: 'My DApp',
    message: 'Verify your identity',
  });

  // Display QR code
  const qrDataUrl = await sdk.generateQRCode(relay.deepLink, { width: 400 });
  document.getElementById('qr-image').src = qrDataUrl;
  document.getElementById('status').textContent = 'Scan the QR code with ZKProofport';

  // Wait for proof result
  const result = await sdk.waitForProof(relay.requestId, {
    onStatusChange: (update) => {
      document.getElementById('status').textContent = `Status: ${update.status}`;
    },
  });

  if (result.status === 'completed') {
    // Verify on-chain
    const verification = await sdk.verifyOnChain(
      result.circuit,
      result.proof,
      result.publicInputs
    );

    if (verification.valid) {
      document.getElementById('status').textContent = 'Identity verified!';
      // Grant access to your application
    }
  } else {
    document.getElementById('status').textContent = `Failed: ${result.error}`;
  }

  // Cleanup
  sdk.disconnect();
}
```

## Advanced Usage

### Nullifier Duplicate Detection

All nullifier operations are instance methods on the SDK:

```typescript
const nullifier = sdk.extractNullifier(publicInputs, circuit);
const isDuplicate = await sdk.checkNullifier(nullifier);
const details = await sdk.getNullifierDetails(nullifier);
```

## Configuration

`ProofportSDK.create()` returns a fully configured SDK instance. No manual configuration is needed for standard usage.

For advanced scenarios (e.g., custom verifier deployments), see the `ProofportConfig` type exported by the SDK.

## Types Reference

All 15 exported types:

```typescript
import type {
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
  AuthCredentials,
  AuthToken,
  RelayProofRequest,
  RelayProofResult,
  SDKEnvironment,
} from '@zkproofport-app/sdk';
```

| Type | Description |
|------|-------------|
| `CircuitType` | `'coinbase_attestation' \| 'coinbase_country_attestation'` |
| `ProofRequestStatus` | `'pending' \| 'completed' \| 'error' \| 'cancelled'` |
| `CoinbaseKycInputs` | Inputs for `coinbase_attestation` (`{ scope, userAddress?, rawTransaction? }`) |
| `CoinbaseCountryInputs` | Inputs for `coinbase_country_attestation` (`{ scope, countryList, isIncluded, ... }`) |
| `CircuitInputs` | Union: `CoinbaseKycInputs \| CoinbaseCountryInputs` |
| `ProofRequest` | Proof request object with `requestId`, `circuit`, `inputs`, metadata, and expiry |
| `ProofResponse` | Proof response with `status`, `proof`, `publicInputs`, `nullifier`, `verifierAddress`, `chainId` |
| `QRCodeOptions` | QR customization: `width`, `margin`, `darkColor`, `lightColor`, `errorCorrectionLevel` |
| `VerifierContract` | Verifier contract info: `{ address, chainId, abi }` |
| `ProofportConfig` | SDK configuration (for advanced usage only) |
| `AuthCredentials` | Login credentials: `{ clientId, apiKey }` |
| `AuthToken` | JWT token: `{ token, clientId, dappId, tier, expiresIn, expiresAt }` |
| `RelayProofRequest` | Relay response: `{ requestId, deepLink, status, pollUrl }` |
| `RelayProofResult` | Relay result: `{ requestId, status, proof?, publicInputs?, nullifier?, circuit?, error? }` |
| `SDKEnvironment` | SDK environment preset |

## Error Handling

All async SDK methods throw standard `Error` objects. Common error scenarios:

```typescript
try {
  await sdk.login({ clientId: 'bad-id', apiKey: 'bad-key' });
} catch (err) {
  // "Authentication failed: HTTP 401"
}

try {
  await sdk.createRelayRequest('coinbase_attestation', { scope: 'app.com' });
} catch (err) {
  // "Not authenticated. Call login() first."
}

try {
  await sdk.waitForProof(relay.requestId, { timeoutMs: 60000 });
} catch (err) {
  // "Waiting for proof timed out after 60000ms"
}
```

Relay request validation errors:

```typescript
try {
  await sdk.createRelayRequest('coinbase_country_attestation', {
    scope: 'app.com',
    countryList: [],
    isIncluded: true,
  });
} catch (err) {
  // Relay or input validation error
}
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
