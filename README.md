# @zkproofport-app/sdk

[![npm version](https://img.shields.io/npm/v/@zkproofport-app/sdk)](https://www.npmjs.com/package/@zkproofport-app/sdk)
[![license](https://img.shields.io/npm/l/@zkproofport-app/sdk)](./LICENSE)

TypeScript SDK for requesting zero-knowledge proofs from the [ZKProofport](https://zkproofport.com) mobile app and verifying them on-chain. Six circuits are supported: Coinbase KYC and country attestations, OIDC email-domain attestations (Google, Microsoft 365), and the three Korean mobile ID (mDL) circuits.

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
       │  │  SDK receives result (WebSocket / polling)        │
       │  │  (proof, publicInputs, status)                    │
       │  └─────────────────────┬────────────────────────────┘
       │                        │
       v                        v
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Verify      │────>│  On-chain verify  │────>│  Access granted   │
│  on-chain    │     │  (Base)           │     │  or denied        │
└──────────────┘     └──────────────────┘     └───────────────────┘
```

1. Your app creates a proof request through the SDK
2. The SDK asks the relay for a one-time challenge and a tracked request ID. For the Coinbase circuits it also signs that challenge with your wallet signer (EIP-191); the OIDC and mDL circuits need no signature
3. Your app shows the returned deep link as a QR code (desktop) or navigates to it (mobile)
4. The user opens the ZKProofport app, which generates the ZK proof on-device
5. The proof result flows back through the relay to your app over WebSocket (HTTP polling as fallback)
6. Your app verifies the proof on-chain

## Installation

```bash
npm install @zkproofport-app/sdk
```

**Peer dependency (required for on-chain verification):**

```bash
npm install ethers
```

`ethers` v6 is recommended; v5 also works. Real-time delivery uses `socket.io-client`, which ships as a dependency of this package — nothing extra to install.

## Quick Start

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';
import type { CircuitType, ProofResponse } from '@zkproofport-app/sdk';
import { BrowserProvider } from 'ethers';

// 1. Initialize
const sdk = ProofportSDK.create();

// 2. Set wallet signer (ethers v6 Signer) — required for the Coinbase circuits
const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
sdk.setSigner(signer);

// 3. Create proof request via relay
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
});

// 4. Show QR code to user
const qrDataUrl = await sdk.generateQRCode(relay.deepLink);
(document.getElementById('qr') as HTMLImageElement).src = qrDataUrl;

// 5. Wait for proof (WebSocket primary, HTTP polling fallback)
const result = await sdk.waitForProof(relay.requestId);

if (result.status === 'completed') {
  // 6. Verify on-chain — the relay result carries the verifier to call
  const response: ProofResponse = {
    requestId: result.requestId,
    circuit: result.circuit as CircuitType,
    status: 'completed',
    proof: result.proof,
    publicInputs: result.publicInputs,
    verifierAddress: result.verifierAddress,
    chainId: result.chainId,
  };

  const verification = await sdk.verifyResponseOnChain(response);
  console.log('Valid:', verification.valid);
}
```

## Supported Circuits

Circuit IDs are canonical and case-sensitive — pass them exactly as written here. `sdk.getSupportedCircuits()` returns the same list at runtime.

### `coinbase_attestation`

Proves that a user has completed Coinbase KYC identity verification without revealing any personal information. Requires a wallet signer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (e.g., your domain). Ensures proof uniqueness per app. |
| `userAddress` | `string` | No | Address to prove the attestation for. Omit it and the mobile app asks the user to connect a wallet. |
| `rawTransaction` | `string` | No | Pre-fetched attestation transaction data. Omit it and the app fetches the attestation itself. |

```typescript
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
});
```

### `coinbase_country_attestation`

Proves a user's country based on Coinbase verification, supporting inclusion and exclusion checks, without revealing the actual country. Requires a wallet signer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier |
| `countryList` | `string[]` | Yes | ISO 3166-1 alpha-2 country codes (e.g., `['US', 'KR']`) |
| `isIncluded` | `boolean` | Yes | `true` = prove user IS from listed countries; `false` = prove user is NOT |
| `userAddress` | `string` | No | Address to prove the attestation for (optional, as above) |
| `rawTransaction` | `string` | No | Pre-fetched attestation transaction data (optional, as above) |

```typescript
const relay = await sdk.createRelayRequest('coinbase_country_attestation', {
  scope: 'myapp.com',
  countryList: ['US', 'KR'],
  isIncluded: true,
});
```

### `oidc_domain_attestation`

Prove email domain affiliation via OIDC Sign-In. The mobile app handles authentication and proof generation entirely on-device — the user's email is never revealed. No wallet signer is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | `string` | Yes | Target email domain to prove (e.g., `'google.com'`, `'company.com'`) |
| `scope` | `string` | Yes | dApp scope identifier for proof uniqueness |
| `provider` | `'google' \| 'microsoft'` | No | OIDC workspace provider for organization membership verification. Supported: `'google'` (Google Workspace), `'microsoft'` (Microsoft 365). |

**Email domain verification (default):**

```typescript
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'gmail.com',
  scope: 'myapp.com',
});
```

**Organization membership verification (Google Workspace):**

```typescript
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
  provider: 'google',
});
```

**Organization membership verification (Microsoft 365):**

```typescript
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
  provider: 'microsoft',
});
```

> When `provider` is set, the mobile app verifies the user's account is managed by the specified workspace provider (e.g., Google Workspace `hd` claim, Microsoft 365 `tid` claim). Without `provider`, only the email domain is verified.

### `mdl_kr_ownership`

Proves the user holds a valid Korean mobile driver's license (모바일 신분증). The license data stays on-device; only the attributes selected by `discloseFlags` are revealed. No wallet signer is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier for proof uniqueness. Non-empty, 256 characters or fewer, no control characters. |
| `discloseFlags` | `number` | No | Attribute disclosure bitmask, integer 0–15 (`0x01` name, `0x02` birth, `0x04` sex, `0x08` phone). Omit or `0` for a fully anonymous ownership proof. |

```typescript
// Anonymous "holds a valid Korean mobile ID" proof
const relay = await sdk.createRelayRequest('mdl_kr_ownership', {
  scope: 'myapp.com',
});
```

### `mdl_kr_age`

Proves the user is at least `ageThreshold` years old according to their Korean mobile driver's license, without revealing the birth date. No wallet signer is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (same rules as above) |
| `ageThreshold` | `number` | Yes | Minimum age to prove — integer between 1 and 150 (e.g. `19` for Korean adult verification) |

```typescript
const relay = await sdk.createRelayRequest('mdl_kr_age', {
  scope: 'myapp.com',
  ageThreshold: 19,
});
```

### `mdl_kr_region`

Proves the user's registered address is in the specified si/do region without revealing the full address. No wallet signer is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `string` | Yes | Application-specific identifier (same rules as above) |
| `targetRegion` | `string` | Yes | Region (si/do) to prove residency in, in Korean (e.g. `'경기도'`, `'서울특별시'`). Non-empty, 256 characters or fewer, no control characters. |

```typescript
const relay = await sdk.createRelayRequest('mdl_kr_region', {
  scope: 'myapp.com',
  targetRegion: '경기도',
});
```

> mDL inputs are checked before the request leaves your process: a missing `scope`, an out-of-range `discloseFlags`, a non-integer `ageThreshold` or an empty `targetRegion` throws locally instead of coming back as a relay error.

> The mDL circuits do not require `setSigner()` — the proof is bound to the license via an on-device nullifier (`nullifier_value` public input), not a wallet address. Use `sdk.extractNullifier(publicInputs, circuit)` for sybil-resistant user identification.

## Integration Guide

### Step 1: Initialize

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

const sdk = ProofportSDK.create();
```

`ProofportSDK.create()` returns an SDK instance pre-configured with the relay server. No configuration needed.

### Step 2: Set Wallet Signer

The Coinbase circuits (`coinbase_attestation`, `coinbase_country_attestation`) authenticate with a signed challenge (EIP-191). Set a wallet signer that can sign messages:

```typescript
import { BrowserProvider } from 'ethers';

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
sdk.setSigner(signer);
```

The `WalletSigner` interface requires two methods:

```typescript
interface WalletSigner {
  signMessage(message: string | Uint8Array): Promise<string>;
  getAddress(): Promise<string>;
}
```

Any ethers v5/v6 `Signer` is compatible.

> **When you can skip this step:** the OIDC Domain and the three mDL circuits never sign a challenge. Calling `createRelayRequest` for those circuits without a signer works. Calling it for a Coinbase circuit without one throws `Signer not set. Call setSigner() first. Wallet signature is required for this circuit.`

#### About challenge-signature

The challenge-signature mechanism was developed **for relay nonce replay prevention**. Each challenge is one-time use and consumed immediately. The signer's recovered address is recorded as `clientId` in relay server logs, which helps the relay operator track requests.

For server-side or headless environments, using an ephemeral random wallet is fine. A persistent wallet (fixed private key) is **not recommended** as it adds unnecessary key management overhead with no functional benefit.

```typescript
import { Wallet } from 'ethers';

// Server-side: ephemeral wallet per request
sdk.setSigner(Wallet.createRandom());
```

### Step 3: Create Request (via Relay)

`createRelayRequest` fetches a challenge and request ID from the relay, signs the challenge when the circuit needs it, creates a tracked proof request, and returns a deep link.

```typescript
const relay = await sdk.createRelayRequest('coinbase_attestation', {
  scope: 'myapp.com',
}, {
  dappName: 'My DApp',
  dappIcon: 'https://myapp.com/icon.png',
  message: 'Verify your identity to continue',
  nonce: 'unique-nonce-123',  // Optional: replay prevention
  returnScheme: 'mydapp://',  // Optional: mobile-only, see below
});

// relay.requestId  — Relay-issued UUID
// relay.deepLink   — Deep link URL for the mobile app
// relay.status     — 'pending'
// relay.pollUrl    — Relative URL for HTTP polling
```

Every field of the third argument is optional: `message`, `dappName` and `dappIcon` are shown to the user in the ZKProofport app, `nonce` is a value of your own choosing that the relay refuses to accept twice, and `returnScheme` is described next.

#### Switching back to your app: `returnScheme`

By default the user stays in the ZKProofport app after generating a proof and switches back to your app themselves. Pass `returnScheme` and the ZKProofport app brings your app to the foreground once the proof has been delivered — the same handoff a wallet performs after a signature.

```typescript
// Native app: your own registered scheme
await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
  returnScheme: 'mydapp://',
});

// Web app: your own origin
await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
  returnScheme: 'https://myapp.com',
});
```

**Only set it in the mobile deep-link flow.** The switch happens on the phone that generated the proof, so it makes sense only when that phone is also where the user started — i.e. when you navigated the browser to `relay.deepLink` on the same device. In the desktop QR flow the user is watching the desktop screen while the proof happens on their phone; opening a page or an app on the phone at that moment surfaces something nobody asked for. Gate it:

```typescript
const relay = await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' },
  ProofportSDK.isMobile() ? { returnScheme: 'https://myapp.com' } : {});
```

`returnScheme` is **not** a return address. It says which app to open, nothing more — the proof still reaches you the usual way, through `waitForProof()` / `waitForResult()`, and the ZKProofport app never posts anything to it.

Two shapes are accepted, and nothing else:

| Form | Example | Notes |
|------|---------|-------|
| Bare custom scheme | `'mydapp://'` | An RFC 3986 scheme followed by exactly `://` |
| https origin | `'https://myapp.com'`, `'https://myapp.com:8443'` | Host (and optional port) only |

Anything else throws before the SDK makes a single network call — no challenge is consumed, so nothing is wasted on a typo:

- a path, query string or fragment (`'mydapp://transfer?to=0x...'`, `'https://myapp.com/done'`), which is what keeps a request from driving your app to a specific action
- an empty or whitespace-containing value, or one longer than 128 characters
- userinfo (`'https://user:pass@myapp.com'`) and non-ASCII hosts (use punycode)
- `http://` and other schemes the OS treats specially: `about`, `blob`, `content`, `data`, `facetime`, `facetime-audio`, `file`, `ftp`, `intent`, `javascript`, `jar`, `mailto`, `sms`, `tel`, `vbscript`

The value is matched case-insensitively and stored lowercased by the relay.

Omit `returnScheme` and nothing changes: the request is created without it and the user stays in the ZKProofport app when the proof is done. There is no auto-switch when proof generation fails either — the error has to be read in the ZKProofport app first.

**OIDC Domain Attestation:**

```typescript
// Email domain verification
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
}, {
  dappName: 'My DApp',
  dappIcon: 'https://myapp.com/icon.png',
  message: 'Verify your email domain',
});

// Organization membership verification (Google Workspace)
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
  provider: 'google',
}, {
  dappName: 'My DApp',
  message: 'Verify your organization membership',
});

// Organization membership verification (Microsoft 365)
const relay = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
  provider: 'microsoft',
}, {
  dappName: 'My DApp',
  message: 'Verify your organization membership',
});
```

The mobile app prompts OIDC Sign-In (Google or Microsoft) and generates the proof locally. When `provider` is set, the app additionally verifies organization membership (e.g., Google Workspace `hd` claim, Microsoft 365 `tid` claim).

### Step 4: Display QR Code

Generate a QR code from the relay deep link for the user to scan with the ZKProofport mobile app:

```typescript
const qrDataUrl = await sdk.generateQRCode(relay.deepLink, {
  width: 400,          // pixels (default: 300)
  darkColor: '#1a1a1a',
  margin: 4,
});
(document.getElementById('qr') as HTMLImageElement).src = qrDataUrl;
```

`QRCodeOptions` accepts `width`, `margin`, `darkColor`, `lightColor` and `errorCorrectionLevel` (`'L' | 'M' | 'Q' | 'H'`, default `'M'`).

**Other QR formats:**

```typescript
// SVG string
const svg = await sdk.generateQRCodeSVG(relay.deepLink);

// Render to canvas
await sdk.renderQRCodeToCanvas(canvasElement, relay.deepLink, { width: 400 });

// Check if data fits QR limits (2953 bytes)
const { size, withinLimit } = sdk.checkQRCodeSize(relay.deepLink);
```

**Mobile:** On mobile browsers, redirect directly to the deep link instead of showing a QR code:

```typescript
if (ProofportSDK.isMobile()) {
  window.location.href = relay.deepLink;
}
```

### Step 5: Wait for Proof

**`waitForProof` (recommended)** — Uses WebSocket (Socket.IO) for instant delivery and falls back to HTTP polling automatically if the socket connection fails.

```typescript
const result = await sdk.waitForProof(relay.requestId, {
  timeoutMs: 300000, // 5 minutes (default)
  onStatusChange: (update) => {
    console.log('Status:', update.status);
  },
});
```

`result.status` is `'pending'`, `'completed'` or `'failed'`. On `'failed'`, `result.error` explains why.

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
const once = await sdk.pollResult(relay.requestId);

// Poll until terminal state
const result = await sdk.waitForResult(relay.requestId, {
  intervalMs: 2000,
  timeoutMs: 300000,
  onStatusChange: (result) => console.log(result.status),
});
```

When you are done, `sdk.disconnect()` closes any open socket.

### Step 6: Verify On-Chain

Verify the proof cryptographically by calling the deployed Solidity verifier contract.

The relay result tells you which verifier contract to call (`verifierAddress`, `chainId`), so verification goes through `verifyResponseOnChain`:

```typescript
import type { CircuitType, ProofResponse } from '@zkproofport-app/sdk';

if (result.status === 'completed') {
  const response: ProofResponse = {
    requestId: result.requestId,
    circuit: result.circuit as CircuitType,
    status: 'completed',
    proof: result.proof,
    publicInputs: result.publicInputs,
    verifierAddress: result.verifierAddress,
    chainId: result.chainId,
  };

  const verification = await sdk.verifyResponseOnChain(response);

  if (verification.valid) {
    console.log('Proof verified on-chain!');
  } else {
    console.error('Verification failed:', verification.error);
  }
}
```

The SDK connects to the right network on its own. Pass your own ethers `Provider` or `Signer` as the second argument if you would rather use your existing connection:

```typescript
const verification = await sdk.verifyResponseOnChain(response, myProvider);
```

`verifyResponseOnChain` never throws for a bad response: an incomplete one (`status` other than `'completed'`, missing `proof` or `publicInputs`) returns `{ valid: false, error: 'Invalid or incomplete response' }`, and a reverting contract call returns `{ valid: false, error }` with the revert message.

> `sdk.verifyOnChain(circuit, proof, publicInputs, providerOrSigner?)` takes the same proof in raw pieces, but those pieces carry no verifier address — it returns `{ valid: false, error: 'No verifier address provided...' }` unless the SDK was constructed with a verifier for that circuit. Prefer `verifyResponseOnChain`.

### Step 7: Extract Scope, Nullifier, and Domain

After verification, extract data from the public inputs:

```typescript
import type { CircuitType } from '@zkproofport-app/sdk';

if (result.status === 'completed' && result.publicInputs && result.circuit) {
  const circuit = result.circuit as CircuitType;

  // Extract scope — the bytes32 scope value carried in the public inputs
  const scope = sdk.extractScope(result.publicInputs, circuit);

  // Extract nullifier — a unique, deterministic hash per user + scope
  // Same user with the same scope always produces the same nullifier
  const nullifier = sdk.extractNullifier(result.publicInputs, circuit);

  console.log('Scope:', scope);         // '0x7a6b70726f...'
  console.log('Nullifier:', nullifier); // '0xabc123...'

  // Extract domain — only for OIDC Domain Attestation
  if (circuit === 'oidc_domain_attestation') {
    const domain = sdk.extractDomain(result.publicInputs, circuit);
    console.log('Domain:', domain); // 'example.com'
  }
}
```

All three return `null` rather than throwing when the public inputs are too short for the circuit's layout.

The **nullifier** serves as a privacy-preserving user identifier:
- Deterministic: same user + same scope = same nullifier (enables duplicate detection)
- Privacy-preserving: the wallet address (Coinbase), the email (OIDC) or the license (mDL) is never revealed
- Scope-bound: different scopes produce different nullifiers for the same user

> **OIDC Domain:** The nullifier is a hash of the user's email and scope. The same email + scope always produces the same nullifier, enabling Sybil resistance without revealing the email address.

The **domain** (OIDC Domain Attestation only) is the email domain the user proved:
- Decoded from the circuit's public inputs, up to 64 ASCII characters
- Matches the domain parameter provided during proof request
- `extractDomain` returns `null` for every other circuit

**Standalone utility functions** are also available for use outside the SDK class:

```typescript
import {
  extractScopeFromPublicInputs,
  extractNullifierFromPublicInputs,
  extractDomainFromPublicInputs,
} from '@zkproofport-app/sdk';

// Scope and nullifier work for all six circuits — the layout is picked from the
// circuit id, so always pass it:
const scope = extractScopeFromPublicInputs(publicInputs, 'coinbase_attestation');
const nullifier = extractNullifierFromPublicInputs(publicInputs, 'coinbase_attestation');

// OIDC domain attestation uses a different public input layout (148 fields)
const oidcScope = extractScopeFromPublicInputs(publicInputs, 'oidc_domain_attestation');
const oidcNullifier = extractNullifierFromPublicInputs(publicInputs, 'oidc_domain_attestation');

// The three mDL circuits share one layout
const mdlNullifier = extractNullifierFromPublicInputs(publicInputs, 'mdl_kr_age');

// Extract domain from OIDC Domain Attestation
const domain = extractDomainFromPublicInputs(publicInputs, 'oidc_domain_attestation');
// domain: 'example.com', or null if the circuit doesn't match or inputs are insufficient
```

Omitting the circuit argument falls back to the `coinbase_attestation` layout, which is why the examples above always pass it explicitly.

## Complete Example

End-to-end integration using the relay flow:

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';
import type { CircuitType, ProofResponse } from '@zkproofport-app/sdk';
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
  (document.getElementById('qr-image') as HTMLImageElement).src = qrDataUrl;
  document.getElementById('status')!.textContent = 'Scan the QR code with ZKProofport';

  // Wait for proof result
  const result = await sdk.waitForProof(relay.requestId, {
    onStatusChange: (update) => {
      document.getElementById('status')!.textContent = `Status: ${update.status}`;
    },
  });

  if (result.status === 'completed') {
    // Verify on-chain
    const response: ProofResponse = {
      requestId: result.requestId,
      circuit: result.circuit as CircuitType,
      status: 'completed',
      proof: result.proof,
      publicInputs: result.publicInputs,
      verifierAddress: result.verifierAddress,
      chainId: result.chainId,
    };

    const verification = await sdk.verifyResponseOnChain(response);

    if (verification.valid) {
      document.getElementById('status')!.textContent = 'Identity verified!';
      // Grant access to your application
    } else {
      document.getElementById('status')!.textContent = `Invalid proof: ${verification.error}`;
    }
  } else {
    document.getElementById('status')!.textContent = `Failed: ${result.error}`;
  }

  // Cleanup
  sdk.disconnect();
}
```

## Configuration

`ProofportSDK.create()` returns a fully configured SDK instance. No manual configuration is needed — the relay endpoint and the network used for verification are built in.

## Types Reference

Types you can import:

```typescript
import type {
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
} from '@zkproofport-app/sdk';
```

| Type | Description |
|------|-------------|
| `CircuitType` | `'coinbase_attestation' \| 'coinbase_country_attestation' \| 'oidc_domain_attestation' \| 'mdl_kr_ownership' \| 'mdl_kr_age' \| 'mdl_kr_region'` |
| `ProofRequestStatus` | `'pending' \| 'completed' \| 'error' \| 'cancelled'` — the status on a `ProofResponse` |
| `CoinbaseKycInputs` | Inputs for `coinbase_attestation`: `{ scope, userAddress?, rawTransaction? }` |
| `CoinbaseCountryInputs` | Inputs for `coinbase_country_attestation`: `{ scope, countryList, isIncluded, userAddress?, rawTransaction? }` |
| `OidcDomainInputs` | Inputs for `oidc_domain_attestation`: `{ domain, scope, provider? }` |
| `MdlKrOwnershipInputs` | Inputs for `mdl_kr_ownership`: `{ scope, discloseFlags? }` |
| `MdlKrAgeInputs` | Inputs for `mdl_kr_age`: `{ scope, ageThreshold }` |
| `MdlKrRegionInputs` | Inputs for `mdl_kr_region`: `{ scope, targetRegion }` |
| `CircuitInputs` | Union of every input type above (plus an empty-input form for circuits that need nothing from the dApp) |
| `ProofRequest` | Request object: `requestId`, `circuit`, `inputs`, `createdAt`, plus optional `message`, `dappName`, `dappIcon`, `returnScheme`, `expiresAt` |
| `ProofResponse` | Proof response: `requestId`, `circuit`, `status`, and — when completed — `proof`, `publicInputs`, `numPublicInputs`, `verifierAddress`, `chainId`, `timestamp`; `error` when it failed |
| `QRCodeOptions` | QR customization: `width`, `margin`, `darkColor`, `lightColor`, `errorCorrectionLevel` |
| `VerifierContract` | Verifier contract info: `{ address, chainId, abi }` |
| `ProofportConfig` | Constructor configuration — `ProofportSDK.create()` fills it in for you |
| `ChallengeResponse` | Challenge from the relay: `{ requestId, challenge, expiresAt }` |
| `WalletSigner` | Signer interface: `{ signMessage(message), getAddress() }` |
| `RelayProofRequest` | Result of `createRelayRequest()`: `{ requestId, deepLink, status, pollUrl }` |
| `RelayProofResult` | Result of `waitForProof()` / `waitForResult()` / `pollResult()`: `{ requestId, status: 'pending' \| 'completed' \| 'failed', deepLink?, createdAt?, updatedAt?, proof?, publicInputs?, verifierAddress?, chainId?, circuit?, error? }` |

The `OidcDomainInputs` interface:

```typescript
interface OidcDomainInputs {
  domain: string;                    // Target email domain (e.g., 'company.com')
  scope: string;                     // dApp scope identifier
  provider?: 'google' | 'microsoft'; // Workspace provider for org membership
}
```

Note that `RelayProofResult` (what you get back from the relay) and `ProofResponse` (what `verifyResponseOnChain` takes) are different types: the relay result's `status` uses `'failed'`, and its `circuit` is a plain `string`. Step 6 shows the conversion.

## Public Input Layout Constants

The SDK exports constants defining the field positions in each circuit's public inputs array. These are useful when working with standalone extraction functions or building custom verification logic.

```typescript
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  MDL_KR_PUBLIC_INPUT_LAYOUT,
} from '@zkproofport-app/sdk';
```

**Coinbase KYC Attestation** (128 fields):
```typescript
COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,      // Signal hash
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,     // Merkle root of the attestation signer list
  MERKLE_ROOT_END: 63,
  SCOPE_START: 64,           // Scope value
  SCOPE_END: 95,
  NULLIFIER_START: 96,       // Unique identifier per user+scope
  NULLIFIER_END: 127,
}
```

**Coinbase Country Attestation** (150 fields):
```typescript
COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
  SIGNAL_HASH_START: 0,
  SIGNAL_HASH_END: 31,
  MERKLE_ROOT_START: 32,
  MERKLE_ROOT_END: 63,
  COUNTRY_LIST_START: 64,    // Packed country codes
  COUNTRY_LIST_END: 83,
  COUNTRY_LIST_LENGTH: 84,   // Number of countries
  IS_INCLUDED: 85,           // Boolean: user in list or not
  SCOPE_START: 86,
  SCOPE_END: 117,
  NULLIFIER_START: 118,
  NULLIFIER_END: 149,
}
```

**OIDC Domain Attestation** (148 fields):
```typescript
OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
  PUBKEY_MODULUS_START: 0,   // RSA modulus limbs (JWT issuer key)
  PUBKEY_MODULUS_END: 17,
  DOMAIN_STORAGE_START: 18,  // Domain bytes (up to 64 ASCII characters)
  DOMAIN_STORAGE_END: 81,
  DOMAIN_LEN: 82,            // Domain string length
  SCOPE_START: 83,           // Scope value
  SCOPE_END: 114,
  NULLIFIER_START: 115,      // Unique identifier per user+scope
  NULLIFIER_END: 146,
  PROVIDER: 147,             // OIDC provider code (0=none, 1=Google, 2=Microsoft)

  // Deprecated aliases (use the names above)
  DOMAIN_START: 18,          // @deprecated Use DOMAIN_STORAGE_START
  DOMAIN_END: 82,            // @deprecated Use DOMAIN_LEN
}
```

**Korea Mobile ID (mDL)** — one layout shared by the three mDL circuits. The prefix is identical everywhere; the suffix depends on which predicate the circuit proves (`mdl_kr_ownership` 97 fields, `mdl_kr_age` 66, `mdl_kr_region` 96):
```typescript
MDL_KR_PUBLIC_INPUT_LAYOUT = {
  SCOPE_START: 0,                   // Scope value
  SCOPE_END: 31,
  NULLIFIER_START: 32,              // nullifier_value
  NULLIFIER_END: 63,

  // mdl_kr_ownership only
  OWNERSHIP_DISCLOSE_FLAGS: 64,
  OWNERSHIP_OWNER_COMMIT_START: 65,
  OWNERSHIP_OWNER_COMMIT_END: 96,

  // mdl_kr_age only
  AGE_THRESHOLD: 64,
  AGE_CURRENT_YEAR: 65,

  // mdl_kr_region only
  REGION_CODE_START: 64,
  REGION_CODE_END: 95,
}
```

> **Note on field positions:** Each position in the public inputs array corresponds to a field element in the circuit. For bytes32 values (scope, nullifier, signal hash), 32 consecutive fields are concatenated to form the final value.

## Error Handling

Async SDK methods throw standard `Error` objects. The messages are stable enough to log, not to switch on:

```typescript
try {
  // Coinbase circuit without a signer
  await sdk.createRelayRequest('coinbase_attestation', { scope: 'app.com' });
} catch (err) {
  // "Signer not set. Call setSigner() first. Wallet signature is required for this circuit."
}

try {
  await sdk.createRelayRequest('mdl_kr_age', { scope: 'app.com', ageThreshold: 0 });
} catch (err) {
  // "ageThreshold is required and must be an integer between 1 and 150 (circuit: mdl_kr_age)"
}

try {
  await sdk.createRelayRequest('coinbase_attestation', { scope: 'app.com' }, {
    returnScheme: 'https://myapp.com/done',
  });
} catch (err) {
  // "returnScheme must be a bare custom scheme such as "mydapp://" or an https
  //  origin such as "https://myapp.com" — paths, query strings and fragments are
  //  not accepted"  (thrown before any network call)
}

try {
  await sdk.waitForProof(relay.requestId, { timeoutMs: 60000 });
} catch (err) {
  // "Waiting for proof timed out after 60000ms"
}
```

A relay rejection surfaces as its message, e.g. `Duplicate nonce (replay detected)` for a reused `nonce`, or `Request not found or expired` from `pollResult()`.

Verification is the exception: `verifyResponseOnChain` and `verifyOnChain` report failures as `{ valid: false, error }` instead of throwing.

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
