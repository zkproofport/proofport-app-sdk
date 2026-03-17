# @zkproofport-app/sdk

[![npm version](https://img.shields.io/npm/v/@zkproofport-app/sdk)](https://www.npmjs.com/package/@zkproofport-app/sdk)
[![license](https://img.shields.io/npm/l/@zkproofport-app/sdk)](./LICENSE)

TypeScript SDK for requesting zero-knowledge proofs from the [ZKProofport](https://zkproofport.com) mobile app and verifying them on-chain.

## How It Works

```
┌──────────────┐     ┌─────────┐     ┌──────────────┐     ┌──────────────────┐
│ Your Web App │────>│   SDK   │────>│ Relay Server │────>│ ZKProofport App  │
│              │     │         │     │              │     │                  │
│              │     │ setSigner│    │ issues ID,   │     │ - Connects wallet│
│              │     │ + create │    │ tracks state │     │ - Fetches data   │
│              │     │ request  │    │              │     │ - Generates proof│
└──────┬───────┘     └─────────┘     └──────┬───────┘     └────────┬─────────┘
       │                                    │                      │
       │                                    │<─────────────────────┘
       │  ┌─────────────────────────────────┘  Proof result via
       │  │                                    relay callback
       │  v
       │  ┌──────────────────────────────────────────────────┐
       │  │  SDK receives result (WebSocket / polling)       │
       │  │  (proof, publicInputs, status)                    │
       │  └─────────────────────┬────────────────────────────┘
       │                        │
       v                        v
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Verify      │────>│  On-chain verify  │────>│  Access granted   │
│  on-chain    │     │  (Base Mainnet)   │     │  or denied        │
└──────────────┘     └──────────────────┘     └───────────────────┘
```

1. Your app sets a wallet signer and creates a proof request via the SDK
2. The SDK authenticates with the relay using challenge-signature (EIP-191) and gets a tracked request ID
3. The SDK displays a QR code (desktop) or opens the deep link (mobile)
4. The user opens the ZKProofport app, which generates the ZK proof
5. The proof result flows back through the relay to your app via WebSocket (or polling)
6. Your app verifies the proof on-chain

## Installation

```bash
npm install @zkproofport-app/sdk
```

**Peer dependency (required for on-chain verification):**

```bash
npm install ethers
```

## Quick Start

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';
import { BrowserProvider } from 'ethers';

// 1. Initialize
const sdk = ProofportSDK.create();

// 2. Set wallet signer (ethers v6 Signer)
const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
sdk.setSigner(signer);

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
| `scope` | `string` | Yes | Application-specific identifier (e.g., your domain). Ensures proof uniqueness per app. |

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

### `oidc_domain_attestation`

Prove email domain affiliation via Google Sign-In. The mobile app handles authentication and proof generation entirely on-device — the user's email is never revealed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | `string` | Yes | Target email domain to prove (e.g., `'google.com'`, `'company.com'`) |
| `scope` | `string` | Yes | dApp scope identifier for proof uniqueness |

```typescript
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
});
```

> The mobile app prompts Google Sign-In, generates the ZK proof locally, and returns the result via relay. The `domain` is a public input — verifiers can confirm which domain was proven.

## Integration Guide

### Step 1: Initialize

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

const sdk = ProofportSDK.create();
```

`ProofportSDK.create()` returns an SDK instance pre-configured with the relay server and verifier contracts. No configuration needed.

### Step 2: Set Wallet Signer

The SDK uses challenge-signature authentication (EIP-191). Set a wallet signer that can sign messages:

```typescript
import { BrowserProvider } from 'ethers';

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
sdk.setSigner(signer);
```

The `WalletSigner` interface requires two methods:

```typescript
interface WalletSigner {
  signMessage(message: string): Promise<string>;
  getAddress(): Promise<string>;
}
```

Any ethers v5/v6 `Signer` is compatible.

> **OIDC Domain note:** Wallet signer is not required for OIDC Domain proofs. See Step 3 for OIDC-specific usage.

#### About challenge-signature

The challenge-signature mechanism was developed **for relay nonce replay prevention**. Each challenge is one-time use and consumed immediately. The signer's recovered address is recorded as `clientId` in relay server logs, which helps the relay operator track requests.

For server-side or headless environments, using an ephemeral random wallet is fine. A persistent wallet (fixed private key) is **not recommended** as it adds unnecessary key management overhead with no functional benefit.

```typescript
import { Wallet } from 'ethers';

// Server-side: ephemeral wallet per request
sdk.setSigner(Wallet.createRandom());
```

### Step 3: Create Request (via Relay)

`createRelayRequest` authenticates with the relay (challenge-signature), creates a tracked proof request, and returns a deep link.

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

**OIDC Domain Attestation:**

```typescript
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
}, {
  dappName: 'My DApp',
  dappIcon: 'https://myapp.com/icon.png',
  message: 'Verify your email domain',
});
```

The mobile app will prompt the user to sign in with Google. The circuit proves the user's email ends with `@company.com` without revealing the full email address. The `domain` field is a **public input** — verifiers can confirm which domain was proven.

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

**Mobile:** On mobile browsers, redirect directly to the deep link instead of showing a QR code:

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

### Step 7: Extract Scope and Nullifier

After verification, extract the scope and nullifier from the public inputs:

```typescript
if (result.status === 'completed') {
  // Extract scope — the keccak256 hash of the scope string you provided
  const scope = sdk.extractScope(result.publicInputs, result.circuit);

  // Extract nullifier — a unique, deterministic hash per user + scope
  // Same user with the same scope always produces the same nullifier
  const nullifier = sdk.extractNullifier(result.publicInputs, result.circuit);

  console.log('Scope:', scope);       // '0x7a6b70726f...'
  console.log('Nullifier:', nullifier); // '0xabc123...'
}
```

The **nullifier** serves as a privacy-preserving user identifier:
- Deterministic: same user + same scope = same nullifier (enables duplicate detection)
- Privacy-preserving: the wallet address (Coinbase) or email (OIDC) is never revealed
- Scope-bound: different scopes produce different nullifiers for the same user

> **OIDC Domain:** The nullifier is a hash of the user's email and scope. The same email + scope always produces the same nullifier, enabling Sybil resistance without revealing the email address.

**Standalone utility functions** are also available for use outside the SDK class:

```typescript
import {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
} from '@zkproofport-app/sdk';

const scope = extractScopeFromPublicInputs(publicInputs, 'coinbase_attestation');
const nullifier = extractNullifierFromPublicInputs(publicInputs, 'coinbase_attestation');
```

## Complete Example

End-to-end integration using the relay flow:

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';
import { BrowserProvider } from 'ethers';

async function verifyUser() {
  // Initialize
  const sdk = ProofportSDK.create();

  // Set wallet signer
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  sdk.setSigner(signer);

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

## Configuration

`ProofportSDK.create()` returns a fully configured SDK instance. No manual configuration is needed — relay URLs, verifier contracts, and chain settings are all built-in.

## Types Reference

All 15 exported types:

```typescript
import type {
  CircuitType,
  ProofRequestStatus,
  CoinbaseKycInputs,
  CoinbaseCountryInputs,
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
} from '@zkproofport-app/sdk';
```

| Type | Description |
|------|-------------|
| `CircuitType` | `'coinbase_attestation' \| 'coinbase_country_attestation' \| 'oidc_domain_attestation'` |
| `ProofRequestStatus` | `'pending' \| 'completed' \| 'error' \| 'cancelled'` |
| `CoinbaseKycInputs` | Inputs for `coinbase_attestation` (`{ scope, userAddress?, rawTransaction? }`) |
| `CoinbaseCountryInputs` | Inputs for `coinbase_country_attestation` (`{ scope, countryList, isIncluded, ... }`) |
| `OidcDomainInputs` | Inputs for `oidc_domain_attestation` (`{ domain, scope }`) |
| `CircuitInputs` | Union: `CoinbaseKycInputs \| CoinbaseCountryInputs \| OidcDomainInputs` |
| `ProofRequest` | Proof request object with `requestId`, `circuit`, `inputs`, metadata, and expiry |
| `ProofResponse` | Proof response with `status`, `proof`, `publicInputs`, `verifierAddress`, `chainId` |
| `QRCodeOptions` | QR customization: `width`, `margin`, `darkColor`, `lightColor`, `errorCorrectionLevel` |
| `VerifierContract` | Verifier contract info: `{ address, chainId, abi }` |
| `ProofportConfig` | SDK configuration (internal use — `ProofportSDK.create()` handles defaults) |
| `ChallengeResponse` | Challenge from relay: `{ challenge, expiresAt }` |
| `WalletSigner` | Signer interface: `{ signMessage(msg), getAddress() }` |
| `RelayProofRequest` | Relay response: `{ requestId, deepLink, status, pollUrl }` |
| `RelayProofResult` | Relay result: `{ requestId, status, proof?, publicInputs?, circuit?, error? }` |

The `OidcDomainInputs` interface:

```typescript
interface OidcDomainInputs {
  domain: string;    // Target email domain (e.g., 'google.com')
  scope: string;     // dApp scope identifier
}
```

## Error Handling

All async SDK methods throw standard `Error` objects:

```typescript
try {
  await sdk.createRelayRequest('coinbase_attestation', { scope: 'app.com' });
} catch (err) {
  // "Signer not set. Call setSigner() first."
}

try {
  await sdk.waitForProof(relay.requestId, { timeoutMs: 60000 });
} catch (err) {
  // "Waiting for proof timed out after 60000ms"
}
```

## Networks

Proofs are verified on **Base** (Ethereum L2). The SDK handles network configuration automatically — no manual setup required.

## Development

```bash
npm install       # Install dependencies
npm run build     # Build SDK (output in dist/)
npm run dev       # Watch mode
npm test          # Run tests
```

## License

MIT
