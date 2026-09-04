# @zkproofport-app/sdk

[![npm version](https://img.shields.io/npm/v/@zkproofport-app/sdk)](https://www.npmjs.com/package/@zkproofport-app/sdk)
[![license](https://img.shields.io/npm/l/@zkproofport-app/sdk)](./LICENSE)

TypeScript SDK for requesting zero-knowledge proofs from the [ZKProofport](https://zkproofport.com) mobile app and verifying them on-chain. Three circuits are officially supported today — Coinbase KYC, Coinbase country attestation, and OIDC email-domain attestation (Google, Microsoft 365). Four more identifiers are reserved and planned: GIWA attestation and the three Korean mobile ID (mDL) circuits. [Circuit Identifiers](#circuit-identifiers) has the full list and what each status means.

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
6. Your app verifies the proof on-chain, then reads its public inputs to confirm it answers the question that was asked

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

## Circuit Identifiers

Circuit IDs are canonical, lowercase and case-sensitive: each one is the `name` field of that circuit's `Nargo.toml`, verbatim. Hyphenated spellings such as `coinbase-kyc` or `mdl-kr-age` are route and directory names from elsewhere — they are not circuit IDs, and passing one does not fail with a clear error. It produces a nullifier mismatch or a verifier lookup that finds nothing.

This SDK is the single source of truth for that list. Import the constants rather than typing the strings, and a rename becomes a compile error instead of a runtime surprise:

```typescript
import { CIRCUIT_IDS } from '@zkproofport-app/sdk';

const relay = await sdk.createRelayRequest(CIRCUIT_IDS.COINBASE_ATTESTATION, {
  scope: 'myapp.com',
});
```

The same names are also published on their own subpath, which holds nothing but the list — no `ethers`, no `socket.io-client`, no SDK code. A server, a worker or a build script can read it without pulling the SDK in:

```typescript
import { CIRCUIT_IDS, CIRCUIT_SUPPORT_STATUS } from '@zkproofport-app/sdk/circuits';
```

### Status

| Constant | Circuit ID | Status |
|----------|-----------|--------|
| `CIRCUIT_IDS.COINBASE_ATTESTATION` | `coinbase_attestation` | **Supported** |
| `CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION` | `coinbase_country_attestation` | **Supported** |
| `CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION` | `oidc_domain_attestation` | **Supported** |
| `CIRCUIT_IDS.GIWA_ATTESTATION` | `giwa_attestation` | Planned |
| `CIRCUIT_IDS.MDL_KR_OWNERSHIP` | `mdl_kr_ownership` | Planned |
| `CIRCUIT_IDS.MDL_KR_AGE` | `mdl_kr_age` | Planned |
| `CIRCUIT_IDS.MDL_KR_REGION` | `mdl_kr_region` | Planned |

**Supported** means generally available — build a product on it. **Planned** means the identifier is reserved and the circuit exists, but it is not officially supported yet: availability, inputs and public-input layout can change without a major version bump.

Every ID appears in `CircuitType` and in `sdk.getSupportedCircuits()`, planned ones included, so being assignable is not a support guarantee. Gate on the status, not on the type:

```typescript
import { CIRCUIT_SUPPORT_STATUS, isSupportedCircuitId } from '@zkproofport-app/sdk';

CIRCUIT_SUPPORT_STATUS.coinbase_attestation; // 'supported'
CIRCUIT_SUPPORT_STATUS.mdl_kr_age;           // 'planned'

isSupportedCircuitId('oidc_domain_attestation'); // true
isSupportedCircuitId('mdl_kr_age');              // false
isSupportedCircuitId('coinbase-kyc');            // false — not an ID at all
```

### Exports

| Export | Type | What it is |
|--------|------|------------|
| `CIRCUIT_IDS` | object | Every canonical ID, keyed by a stable constant name |
| `ALL_CIRCUIT_IDS` | `readonly CircuitId[]` | Every ID, in the order of the table above |
| `SUPPORTED_CIRCUIT_IDS` | `readonly CircuitId[]` | Only the officially supported ones |
| `PLANNED_CIRCUIT_IDS` | `readonly CircuitId[]` | Only the planned ones |
| `CIRCUIT_SUPPORT_STATUS` | `Readonly<Record<CircuitId, CircuitSupportStatus>>` | The status of each circuit |
| `isCircuitId(value)` | `value is CircuitId` | Narrows an unknown value; `false` for hyphenated names |
| `isSupportedCircuitId(value)` | `value is CircuitId` | The same, and additionally requires `supported` |
| `getCircuitSupportStatus(id)` | `CircuitSupportStatus` | Status of one ID; throws on an unknown one |
| `CircuitId` | type | Union of the seven IDs. `CircuitType` is an alias of it |
| `CircuitSupportStatus` | type | `'supported' \| 'planned'` |

Both objects and all three arrays are frozen. `ALL_CIRCUIT_IDS`, `SUPPORTED_CIRCUIT_IDS` and `PLANNED_CIRCUIT_IDS` are derived from `CIRCUIT_SUPPORT_STATUS` at load time, so they cannot disagree with it.

## Supported Circuits

The circuits below are officially supported. Pass their IDs exactly as written, or use the `CIRCUIT_IDS` constants. `sdk.getSupportedCircuits()` returns every known ID at runtime, planned ones included — see [Circuit Identifiers](#circuit-identifiers).

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

## Planned Circuits

The identifiers below are reserved and exported, and the circuits exist — but they are **not officially supported yet**. Availability, input shape and public-input layout can change without a major version bump, so treat anything here as provisional. `CIRCUIT_SUPPORT_STATUS` reports each of them as `planned`.

### `giwa_attestation`

Reserved identifier for GIWA attestation. It is a fork of `coinbase_attestation` and carries the same four public inputs, but there is no dedicated input type for it and no supported request flow. The ID is exported so that every layer spells it the same way; do not build on it yet.

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

The challenge-signature mechanism exists **for replay prevention**. Each challenge is one-time use and is consumed immediately. The relay recovers the signer's address from the signature and logs it; the address is not fed into the circuit, and it does not have to be the address that holds the attestation — the mobile app decides that, from `userAddress` or from the wallet the user connects.

So for server-side or headless environments an ephemeral random wallet is fine. A persistent wallet (fixed private key) is **not recommended**: it adds key management for no functional benefit.

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
  returnScheme: 'mydapp://',  // Optional: native apps only, see below
});

// relay.requestId  — Relay-issued UUID
// relay.deepLink   — Deep link URL for the mobile app
// relay.status     — 'pending'
// relay.pollUrl    — Relative URL for HTTP polling
```

Every field of the third argument is optional: `message`, `dappName` and `dappIcon` are shown to the user in the ZKProofport app, `nonce` is a value of your own choosing that the relay refuses to accept twice, and `returnScheme` is described next.

#### Switching back: `returnScheme`

When ZKProofport finishes a proof, the user is sitting in the ZKProofport app. `returnScheme` answers one question: **which app should come back to the foreground?**

It names an app. It is not a URL, not a return address, and the proof is never sent to it — the proof still reaches you exactly as before, through `waitForProof()` / `waitForResult()`. This is the same handoff a wallet performs after a signature (`redirect.native`).

**One form is accepted:**

| Form | Example |
|------|---------|
| Bare custom scheme | `'mydapp://'` — an RFC 3986 scheme followed by exactly `://` |

**If you are a native app**, pass the scheme your app registers:

```typescript
await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' }, {
  returnScheme: 'mydapp://',
});
```

**If you are a web page, pass nothing.** You have no app to come back to, so there is no value you can honestly put here — and the SDK handles the browser case for you:

```typescript
// Correct. Do not pass returnScheme from a web page.
await sdk.createRelayRequest('coinbase_attestation', { scope: 'myapp.com' });
```

##### What the SDK does automatically

With the option omitted, the SDK looks at the page's own user agent and decides:

| Where your page is running | What the SDK sends | What the user sees when the proof is done |
|---|---|---|
| **Chrome for iOS** (`CriOS`) | `googlechrome://` | Chrome comes forward on **the tab they were already reading** — no new tab, no reload, page state intact |
| **Firefox for iOS** (`FxiOS`) | `firefox://` | Same: Firefox comes forward on the tab they were already reading |
| **Android**, any browser | nothing | The ZKProofport app puts itself in the background and the browser resumes exactly as it was |
| **Safari, Brave, Arc, Edge, Opera on iOS** | nothing | ZKProofport tells them the proof was delivered and to switch back; the system "‹ Back" breadcrumb is still at the top left |
| **In-app webviews** (KakaoTalk, Naver, Line, Instagram) | nothing | Same notice. Any scheme would destroy the page they are on |
| **Desktop** | nothing | This is the QR flow: the proof happens on a different device, and your page updates over the relay socket |

Only Chrome and Firefox are auto-detected, each from a positive UA token, because they are the two iOS browsers whose bare scheme is **verified in their own source** to bring the app forward without navigating anywhere. There is no Safari equivalent. Brave and Arc are indistinguishable from Safari on iOS, so guessing would eject those users into a browser they were not using — worse than doing nothing. Edge and Opera are closed source and stay out until someone can show their bare schemes behave the same way.

An explicit `returnScheme` always wins; the SDK never overrides a value you set.

##### `https://` origins are not accepted

An https origin such as `'https://myapp.com'` used to be allowed. **It is now rejected** by the SDK, the relay and the ZKProofport app alike.

Opening one does not return anybody anywhere. The OS hands the URL to the browser, and the browser opens a **new tab** on a freshly loaded page — the tab your user actually started in is left behind, along with everything in it, including the socket waiting for the proof you just generated. The round trip the field exists to complete was the thing it broke.

##### What is rejected

These throw before the SDK makes a single network call, so no challenge is consumed and nothing is wasted on a typo:

- **https and http origins** — `'https://myapp.com'`, `'https://myapp.com:8443'` (see above)
- **bare `https://` and `http://`** — a browser with no page to open is not a return target
- a host, path, query string or fragment — `'mydapp://transfer?to=0x...'` — which is what stops a request driving your app to a specific action rather than just opening it
- an empty or whitespace-containing value, or one longer than 128 characters
- non-ASCII schemes (use punycode if you somehow need one)
- schemes the OS treats specially: `about`, `blob`, `content`, `data`, `facetime`, `facetime-audio`, `file`, `ftp`, `intent`, `javascript`, `jar`, `mailto`, `sms`, `tel`, `vbscript`

The value is matched case-insensitively and stored lowercased by the relay.

##### When nothing happens

There is no auto-switch when proof generation **fails** — the error has to be read in the ZKProofport app first. And when no target is sent and none can be inferred, ZKProofport shows the user a notice saying the proof was delivered and to switch back themselves. That is the intended outcome on iOS outside Chrome, not a bug.

**OIDC Domain Attestation:**

```typescript
// Email domain verification
const relayDomain = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
}, {
  dappName: 'My DApp',
  dappIcon: 'https://myapp.com/icon.png',
  message: 'Verify your email domain',
});

// Organization membership verification (Google Workspace)
const relayGoogle = await sdk.createRelayRequest('oidc_domain_attestation', {
  domain: 'company.com',
  scope: 'myapp.com',
  provider: 'google',
}, {
  dappName: 'My DApp',
  message: 'Verify your organization membership',
});

// Organization membership verification (Microsoft 365)
const relayMicrosoft = await sdk.createRelayRequest('oidc_domain_attestation', {
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
  margin: 4,           // quiet zone in modules (default: 2)
});
(document.getElementById('qr') as HTMLImageElement).src = qrDataUrl;
```

`QRCodeOptions` accepts `width` (default `300`), `margin` (default `2`), `darkColor` (default `'#000000'`), `lightColor` (default `'#ffffff'`) and `errorCorrectionLevel` (`'L' | 'M' | 'Q' | 'H'`, default `'M'`).

**Other QR formats:**

```typescript
// SVG string
const svg = await sdk.generateQRCodeSVG(relay.deepLink);

// Render to canvas
await sdk.renderQRCodeToCanvas(canvasElement, relay.deepLink, { width: 400 });

// Check if data fits QR limits (2953 bytes)
const { size, withinLimit } = sdk.checkQRCodeSize(relay.deepLink);
```

All three generators throw `QR code data too large (… bytes). Maximum is 2953 bytes.` rather than emitting an unscannable image. Relay deep links are far below that; the check matters if you build your own link.

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

`waitForProof` settles once the request reaches a terminal state. Step 6 walks through the object it hands back, field by field, and through the states that are not terminal.

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

### Step 6: Read the Result

`waitForProof()`, `waitForResult()` and `pollResult()` all hand back the same object, a `RelayProofResult`. A completed one looks like this (long values elided):

```typescript
{
  requestId: '9f1c8a02-4e2b-4f0a-9c3e-1d5a7b0e2f44',
  status: 'completed',
  circuit: 'coinbase_attestation',
  proof: '0x1f8b0a…',                       // proof bytes, opaque
  publicInputs: ['0x00…2f', '0x00…a1', …],  // ordered — 128 entries for this circuit
  verifierAddress: '0x…',                   // contract that can check this proof
  chainId: …,                               // network that contract lives on
  deepLink: 'zkproofport://proof-request?data=…',
  createdAt: '2026-02-07T09:14:02.101Z',
  updatedAt: '2026-02-07T09:14:48.902Z',
}
```

| Field | Type | Present when | What it is |
|-------|------|--------------|------------|
| `requestId` | `string` | always | The relay-issued id you waited on. Echoed back so one handler can serve many requests. |
| `status` | `string` | always | Lifecycle state — see below. |
| `circuit` | `string` | terminal results | Which circuit produced the proof, as reported by the mobile app. You need it to read `publicInputs`, because the layout is per circuit. Undefined while the request is still pending. |
| `proof` | `string` | `'completed'` | The proof bytes as a `0x` hex string. Opaque: the only thing to do with it is hand it to a verifier. |
| `publicInputs` | `string[]` | `'completed'` | The circuit's public inputs **in circuit order**. This is the part that carries meaning — what each index holds is in [Public Input Layout Constants](#public-input-layout-constants). |
| `verifierAddress` | `string` | `'completed'` | Address of the Solidity verifier contract that can check this exact proof. It comes from the mobile app — forward it, do not hardcode one. |
| `chainId` | `number` | `'completed'` | The chain that `verifierAddress` lives on. Same rule: forward it. |
| `error` | `string` | failures | Human-readable reason from the mobile app or the relay. |
| `deepLink` | `string` | polling path only | The deep link the request was created with. |
| `createdAt`, `updatedAt` | `string` | polling path only | ISO timestamps of creation and last update. |

The last three come from the relay's polling endpoint. `waitForProof()` normally resolves over the WebSocket, whose payload does not carry them, so do not build logic on their presence.

#### What `status` can be

| `status` | Terminal | What happened | What you do |
|----------|----------|---------------|-------------|
| `'pending'` | no | The request exists; no proof yet | Keep waiting — `waitForProof()` does that for you |
| `'completed'` | yes | A proof came back | `proof`, `publicInputs`, `verifierAddress` and `chainId` are set. Verify it (Step 7) before trusting anything in it |
| `'error'` | yes | The app could not produce a proof — no attestation on that address, sign-in refused, generation failed | Read `error`, show it, let the user start over |
| `'failed'` | yes | Same meaning and same handling as `'error'` | Handle the pair; the type declares `'failed'`, the app sends `'error'` |
| `'cancelled'` | see below | The user declined the request in the ZKProofport app | Reset your UI |

`RelayProofResult` declares `status` as `'pending' | 'completed' | 'failed'`, which is narrower than what the relay can deliver, so TypeScript rejects a direct comparison against `'error'`. Widen it once and branch on the string:

```typescript
const status: string = result.status;

if (status === 'completed') {
  // verify it
} else if (status === 'error' || status === 'failed') {
  showError(result.error ?? 'Proof generation failed');
}
```

`waitForProof()` settles on `'completed'`, `'error'` and `'failed'`. It does **not** settle on `'cancelled'` — a cancellation arrives as a status update, and if you ignore it the call sits there until `timeoutMs` expires. Watch for it if you want to drop the QR dialog the moment the user says no:

```typescript
const result = await sdk.waitForProof(relay.requestId, {
  onStatusChange: (update) => {
    if (update.status === 'cancelled') {
      // The user declined in the app. This promise will not settle on its own.
      hideQrDialog();
    }
  },
});
```

`waitForResult()`, the polling path, is narrower still: it returns only on `'completed'` and `'failed'`, and keeps polling through `'error'` and `'cancelled'` until `timeoutMs`. Prefer `waitForProof()`, or drive `pollResult()` in a loop of your own if you want to decide what counts as terminal.

#### What is not on the result

- **No `nullifier` field.** The nullifier is inside `publicInputs`. Read it with `sdk.extractNullifier()` — Step 8.
- **No `numPublicInputs` field.** It is `publicInputs.length`.
- **A `'completed'` result can arrive with `proof` and `publicInputs` missing.** That means the relay's buffered copy of the result has expired — results are kept for a short window only. There is nothing left to fetch for that `requestId`; the user has to make a new request.

#### Retry, or show the user?

| Situation | Retry automatically | Show the user |
|-----------|--------------------|----------------|
| `createRelayRequest()` throws `Too many requests. Please try again later.` | Yes, with backoff | No |
| Network failure reaching the relay | Yes | No |
| `pollResult()` throws `Request not found or expired` | No — that id is gone | Yes, ask them to start again |
| `status: 'error'` / `'failed'` | No — a retry re-runs the same failing thing | Yes: `error` says what went wrong, and it is usually the user's move (connect the right wallet, sign in, use the device holding the licence) |
| `status: 'cancelled'` | No | Nothing to say — they just declined |
| `waitForProof()` timeout | Only if the user asks for it | Yes |
| `verifyResponseOnChain()` returns `{ valid: false }` | No | Treat it as a rejected proof, not an outage — Step 7 |

#### `ProofResponse` — the shape on-chain verification takes

`verifyResponseOnChain()` does not take the relay result directly. It takes a `ProofResponse`, which you build from it:

| `ProofResponse` field | Type | Required | Where it comes from |
|-----------------------|------|----------|---------------------|
| `requestId` | `string` | Yes | `result.requestId` |
| `circuit` | `CircuitType` | Yes | `result.circuit`, narrowed — the relay types it as a plain `string` |
| `status` | `'pending' \| 'completed' \| 'error' \| 'cancelled'` | Yes | `'completed'`. Anything else and verification returns `{ valid: false, error: 'Invalid or incomplete response' }` without touching the chain. Note the relay says `'failed'` where this type says `'error'` |
| `proof` | `string` | When completed | `result.proof` |
| `publicInputs` | `string[]` | When completed | `result.publicInputs` |
| `verifierAddress` | `string` | When completed | `result.verifierAddress`. Without it there is no contract to call and verification fails with `No verifier address provided…` |
| `chainId` | `number` | When completed | `result.chainId`. Used to pick a network when you pass no provider of your own |
| `numPublicInputs` | `number` | No | Never delivered by the relay, and never read during verification — `publicInputs.length` is used instead. Omit it |
| `timestamp` | `number` | No | Not delivered by the relay. Omit it |
| `error` | `string` | On failure | `result.error`. Carried for your own logging; verification ignores it |

There is no `nullifier` field here either.

### Step 7: Verify On-Chain

Verify the proof cryptographically by calling the deployed Solidity verifier contract.

The relay result tells you which contract to call (`verifierAddress`) and on which chain (`chainId`), so verification goes through `verifyResponseOnChain`, which reads both off the response:

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

`verifyResponseOnChain` reports failures instead of throwing them. An incomplete response (`status` other than `'completed'`, or a missing `proof` / `publicInputs`) returns `{ valid: false, error: 'Invalid or incomplete response' }` without making a network call; a missing `verifierAddress` returns `{ valid: false, error: 'No verifier address provided…' }`; and a reverting contract call returns `{ valid: false, error }` carrying the revert message. It does throw in one case: a response carrying a `chainId` the SDK has no built-in endpoint for, when you passed no provider of your own. Pass your own provider if you ever hit that.

`valid: true` means the verifier contract accepted the proof: it is a real proof for that circuit, and its public inputs are the ones it was proved against. It does **not** yet mean the proof answers *your* question — that it was bound to your scope, or that the domain or country in it is the one you asked for. Those live in the public inputs, and reading them is Step 8. `valid: false` is a rejected proof, not an outage: do not retry it, refuse the user.

> **Why not `verifyOnChain`?** `sdk.verifyOnChain(circuit, proof, publicInputs, providerOrSigner?)` takes the same proof in raw pieces. Those pieces carry no verifier address, and it never looks at a response for one — it consults only the `verifiers` map the SDK was constructed with, which `ProofportSDK.create()` leaves empty. Out of the box it therefore returns `{ valid: false, error: 'No verifier address provided. Configure via SDK or ensure proof response includes verifierAddress.' }`. Use `verifyResponseOnChain`.

### Step 8: Extract Scope, Nullifier, and Domain

A verified proof tells you the public inputs are genuine. It does not tell you what they say. Reading them is a separate step, and it is the step that decides whether the proof answers the question you asked.

Do it **after** `verifyResponseOnChain()` returns `valid: true`. These helpers are plain parsers — they will happily decode an array that no verifier has ever seen.

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

All three return `null` rather than throwing when the public inputs are too short for the circuit's layout. Pass the wrong circuit id and you get no error at all, just the wrong 32 entries decoded into a plausible-looking value — always pass the `circuit` the result came with.

#### Check the scope

Every circuit publishes `scope` as `keccak256` of the scope string you sent. Comparing it is how you find out that the proof was made for *your* request and not replayed from someone else's app:

```typescript
import { keccak256, toUtf8Bytes } from 'ethers';

const expectedScope = keccak256(toUtf8Bytes('myapp.com'));

if (sdk.extractScope(publicInputs, circuit) !== expectedScope) {
  throw new Error('Proof was generated for a different scope');
}
```

#### Use the nullifier

The nullifier is a deterministic hash over the user's credential and the scope:

- **Deterministic** — same user, same scope, same nullifier, every time. That is what makes duplicate detection possible.
- **Privacy-preserving** — the wallet address (Coinbase), the email (OIDC) and the licence (mDL) stay hidden. There is no way back from the nullifier to the person.
- **Scope-bound** — the same user proving to a different scope produces an unrelated nullifier, so your users cannot be correlated across apps.

On your side, it is the primary key of a verified user. Store it once verification succeeds, with a unique constraint, and check it before granting anything:

```typescript
const nullifier = sdk.extractNullifier(publicInputs, circuit);
if (!nullifier) throw new Error('Public inputs too short for this circuit');

// One claim per user, forever: the insert is the double-proof check.
const inserted = await db.verifiedUsers.insertIfAbsent({
  nullifier,          // '0xabc123…'
  circuit,
  claimedAt: new Date(),
});

if (!inserted) {
  // This credential has already been used for this scope.
  throw new Error('Already claimed');
}
```

Keep the scope you used fixed for the lifetime of that record. Change the scope string and every returning user looks brand new, because every nullifier changes with it.

> **OIDC Domain:** The nullifier is a hash of the user's email and scope. The same email + scope always produces the same nullifier, enabling Sybil resistance without revealing the email address.

#### Check the domain

`extractDomain()` (OIDC Domain Attestation only) returns the email domain the proof was made for, decoded from the public inputs — up to 64 ASCII characters. It returns `null` for every other circuit.

The circuit binds it to the signed token: the part of the email after `@` has to equal this domain, exactly, to the end of the address. What the circuit does not decide is *which* domain — the prover picks it. So compare it with what you asked for:

```typescript
const domain = sdk.extractDomain(publicInputs, 'oidc_domain_attestation');
if (domain !== 'company.com') {
  throw new Error(`Proof is for ${domain}, not company.com`);
}
```

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
import { BrowserProvider, keccak256, toUtf8Bytes } from 'ethers';

const SCOPE = 'myapp.com';

async function verifyUser() {
  // Initialize
  const sdk = ProofportSDK.create();

  // Set wallet signer
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  sdk.setSigner(signer);

  // Create proof request via relay
  const relay = await sdk.createRelayRequest('coinbase_attestation', {
    scope: SCOPE,
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
    const circuit = result.circuit as CircuitType;
    const publicInputs = result.publicInputs ?? [];

    // Verify on-chain
    const response: ProofResponse = {
      requestId: result.requestId,
      circuit,
      status: 'completed',
      proof: result.proof,
      publicInputs,
      verifierAddress: result.verifierAddress,
      chainId: result.chainId,
    };

    const verification = await sdk.verifyResponseOnChain(response);

    if (!verification.valid) {
      document.getElementById('status')!.textContent = `Invalid proof: ${verification.error}`;
      sdk.disconnect();
      return;
    }

    // A real proof is not yet a proof of what you asked: check the scope.
    if (sdk.extractScope(publicInputs, circuit) !== keccak256(toUtf8Bytes(SCOPE))) {
      document.getElementById('status')!.textContent = 'Proof was made for another scope';
      sdk.disconnect();
      return;
    }

    // Key the user on the nullifier — same person + same scope, same value
    const nullifier = sdk.extractNullifier(publicInputs, circuit);
    document.getElementById('status')!.textContent = 'Identity verified!';
    console.log('Verified user:', nullifier);
    // Grant access to your application
  } else {
    document.getElementById('status')!.textContent = `Failed: ${result.error}`;
  }

  // Cleanup
  sdk.disconnect();
}
```

## Configuration

`ProofportSDK.create()` returns a fully configured SDK instance. No manual configuration is needed: the relay endpoint is built in, and the verifier contract and network to check a proof against arrive with the proof itself (`verifierAddress`, `chainId`).

## Types Reference

Types you can import:

```typescript
import type {
  CircuitId,
  CircuitSupportStatus,
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
| `CircuitId` | Union of the seven canonical circuit IDs — `'coinbase_attestation' \| 'coinbase_country_attestation' \| 'oidc_domain_attestation' \| 'giwa_attestation' \| 'mdl_kr_ownership' \| 'mdl_kr_age' \| 'mdl_kr_region'`. Also exported from `@zkproofport-app/sdk/circuits` |
| `CircuitSupportStatus` | `'supported' \| 'planned'` — see [Circuit Identifiers](#circuit-identifiers) |
| `CircuitType` | Alias of `CircuitId`. Kept as the name used throughout `ProofRequest`, `ProofResponse` and the SDK methods |
| `ProofRequestStatus` | `'pending' \| 'completed' \| 'error' \| 'cancelled'` — the status on a `ProofResponse` |
| `CoinbaseKycInputs` | Inputs for `coinbase_attestation`: `{ scope, userAddress?, rawTransaction? }` |
| `CoinbaseCountryInputs` | Inputs for `coinbase_country_attestation`: `{ scope, countryList, isIncluded, userAddress?, rawTransaction? }` |
| `OidcDomainInputs` | Inputs for `oidc_domain_attestation`: `{ domain, scope, provider? }` |
| `MdlKrOwnershipInputs` | Inputs for `mdl_kr_ownership`: `{ scope, discloseFlags? }` |
| `MdlKrAgeInputs` | Inputs for `mdl_kr_age`: `{ scope, ageThreshold }` |
| `MdlKrRegionInputs` | Inputs for `mdl_kr_region`: `{ scope, targetRegion }` |
| `CircuitInputs` | Union of every input type above (plus an empty-input form for circuits that need nothing from the dApp) |
| `ProofRequest` | Request object: `requestId`, `circuit`, `inputs`, `createdAt`, plus optional `message`, `dappName`, `dappIcon`, `returnScheme` (a bare scheme such as `mydapp://`), `expiresAt` |
| `ProofResponse` | What `verifyResponseOnChain()` takes: `requestId`, `circuit`, `status`, and — when completed — `proof`, `publicInputs`, `verifierAddress`, `chainId`; `error` when it failed. `numPublicInputs` and `timestamp` also exist but the relay never fills them, so omit them. Field by field in [Step 6](#step-6-read-the-result) |
| `QRCodeOptions` | QR customization: `width`, `margin`, `darkColor`, `lightColor`, `errorCorrectionLevel` |
| `VerifierContract` | Verifier contract info: `{ address, chainId, abi }` |
| `ProofportConfig` | Constructor configuration — `ProofportSDK.create()` fills it in for you |
| `ChallengeResponse` | Challenge from the relay: `{ requestId, challenge, expiresAt }` |
| `WalletSigner` | Signer interface: `{ signMessage(message), getAddress() }` |
| `RelayProofRequest` | Result of `createRelayRequest()`: `{ requestId, deepLink, status, pollUrl }` |
| `RelayProofResult` | Result of `waitForProof()` / `waitForResult()` / `pollResult()`: `{ requestId, status, deepLink?, createdAt?, updatedAt?, proof?, publicInputs?, verifierAddress?, chainId?, circuit?, error? }`. `status` is declared as `'pending' \| 'completed' \| 'failed'` but the relay also delivers `'error'` and `'cancelled'` — [Step 6](#step-6-read-the-result) |

The `OidcDomainInputs` interface:

```typescript
interface OidcDomainInputs {
  domain: string;                    // Target email domain (e.g., 'company.com')
  scope: string;                     // dApp scope identifier
  provider?: 'google' | 'microsoft'; // Workspace provider for org membership
}
```

Note that `RelayProofResult` (what you get back from the relay) and `ProofResponse` (what `verifyResponseOnChain` takes) are different types: the relay result's `status` uses `'failed'`, and its `circuit` is a plain `string`. Step 6 shows both shapes side by side and Step 7 does the conversion.

## Public Input Layout Constants

`publicInputs` is an **ordered array whose layout is fixed by the circuit**. Index 64 in one circuit has nothing to do with index 64 in another. Reading it with the wrong layout does not fail loudly — it returns a well-formed value that means something else, which is how a proof ends up verifying a claim nobody asked for. Prefer `sdk.extractScope()` / `extractNullifier()` / `extractDomain()`, and reach for these constants only for the fields those do not cover.

```typescript
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  MDL_KR_PUBLIC_INPUT_LAYOUT,
} from '@zkproofport-app/sdk';
```

Two rules hold for every table below:

- **Every number is an index into `publicInputs`, and `_END` is inclusive.** Slice with `slice(START, END + 1)`.
- **One entry is one field element, not one 32-byte value.** A `bytes32` such as a scope or a nullifier is spread over 32 consecutive entries, each holding a single byte in its low byte: `publicInputs[64] === '0x00…2f'` is the byte `0x2f`. Rebuild it by concatenating those 32 low bytes. The one exception is the OIDC RSA modulus, whose 18 entries each hold a 128-bit limb.

```typescript
const L = COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT;

// Rebuild a bytes32 value from 32 single-byte entries.
const toBytes32 = (fields: string[]): string =>
  '0x' + fields.map((f) => (BigInt(f) & 0xffn).toString(16).padStart(2, '0')).join('');

const signalHash = toBytes32(publicInputs.slice(L.SIGNAL_HASH_START, L.SIGNAL_HASH_END + 1));
```

### `coinbase_attestation` — 128 entries

| Index | Constants | Circuit field | What it is |
|-------|-----------|---------------|------------|
| 0–31 | `SIGNAL_HASH_START` / `_END` | `signal_hash` | `bytes32` anti-replay challenge for the request |
| 32–63 | `MERKLE_ROOT_START` / `_END` | `signer_list_merkle_root` | `bytes32` root of the Coinbase attestation-signer list the proof was checked against |
| 64–95 | `SCOPE_START` / `_END` | `scope` | `bytes32` — `keccak256` of your scope string. Compare it (Step 8) |
| 96–127 | `NULLIFIER_START` / `_END` | `nullifier` | `bytes32`, unique per user and scope |

### `coinbase_country_attestation` — 150 entries

| Index | Constants | Circuit field | What it is |
|-------|-----------|---------------|------------|
| 0–31 | `SIGNAL_HASH_START` / `_END` | `signal_hash` | `bytes32` anti-replay challenge |
| 32–63 | `MERKLE_ROOT_START` / `_END` | `signer_list_merkle_root` | `bytes32` signer-list root |
| 64–83 | `COUNTRY_LIST_START` / `_END` | `country_list` | 10 slots of 2 ASCII bytes, one byte per entry — entries 64–65 are the first code, 66–67 the second, and so on, in the order you sent them. Only the first `country_list_length` slots are meaningful; the rest are zero |
| 84 | `COUNTRY_LIST_LENGTH` | `country_list_length` | How many of those 10 slots count |
| 85 | `IS_INCLUDED` | `is_included` | `1` = the user **is** in the list, `0` = the user is **not** |
| 86–117 | `SCOPE_START` / `_END` | `scope` | `bytes32` scope hash |
| 118–149 | `NULLIFIER_START` / `_END` | `nullifier` | `bytes32`, unique per user and scope |

The country list and the `is_included` flag are public inputs, which means the proof is only as strong as the list it was proved against. Read indices 64–85 back and confirm they are the list and the direction you asked for; a valid proof against a different list is still a valid proof.

### `oidc_domain_attestation` — 148 entries

| Index | Constants | Circuit field | What it is |
|-------|-----------|---------------|------------|
| 0–17 | `PUBKEY_MODULUS_START` / `_END` | `pubkey_modulus_limbs` | The RSA modulus of the OIDC issuer's signing key, as 18 × 128-bit limbs. Not single bytes |
| 18–81 | `DOMAIN_STORAGE_START` / `_END` | `domain` storage | The domain as ASCII, one byte per entry. Entries past the length at index 82 are zero |
| 82 | `DOMAIN_LEN` | `domain` length | How many of those 64 bytes are the domain. `extractDomain()` does this decoding for you |
| 83–114 | `SCOPE_START` / `_END` | `scope` | `bytes32` scope hash |
| 115–146 | `NULLIFIER_START` / `_END` | `nullifier` | `bytes32` over the user's email and the scope |
| 147 | `PROVIDER` | `provider` | `0` = Google, `1` = Microsoft. The circuit accepts no other value |

`DOMAIN_START` and `DOMAIN_END` are kept as deprecated aliases of `DOMAIN_STORAGE_START` and `DOMAIN_LEN`. Use the current names — the old pair reads as a range and is not one.

Index 147 tells you which issuer signed the token, not whether the account belongs to an organisation. Workspace and Microsoft 365 membership is checked on-device only when you set `provider` in the request; if you did not set it, do not read a membership guarantee out of this field.

### Korea Mobile ID (mDL) — one layout, three circuits

All three mDL circuits share the same first 64 entries and differ after that. Entries are single bytes, except `age_threshold` and `current_year`, which each hold their whole value in one entry.

| Index | Constants | Circuit field | Applies to |
|-------|-----------|---------------|------------|
| 0–31 | `SCOPE_START` / `_END` | `scope` | all three |
| 32–63 | `NULLIFIER_START` / `_END` | `nullifier_value` | all three |
| 64 | `OWNERSHIP_DISCLOSE_FLAGS` | `disclose_flags` | `mdl_kr_ownership` (97 entries) — the bitmask that was actually proved (`0x01` name, `0x02` birth, `0x04` sex, `0x08` phone) |
| 65–96 | `OWNERSHIP_OWNER_COMMIT_START` / `_END` | `owner_commit` | `mdl_kr_ownership` — `bytes32` commitment to the disclosed attributes. All zero when `disclose_flags` is `0`, which is the anonymous case |
| 64 | `AGE_THRESHOLD` | `age_threshold` | `mdl_kr_age` (66 entries) — the age the proof actually clears. Read it back; it is a public input, so confirm it is the threshold you asked for |
| 65 | `AGE_CURRENT_YEAR` | `current_year` | `mdl_kr_age` — the year the comparison was made in |
| 64–95 | `REGION_CODE_START` / `_END` | `region_code` | `mdl_kr_region` (96 entries) — `bytes32`, not a readable region name. See below |

`region_code` is `keccak256` over the region name, UTF-8 and zero-padded to 64 bytes. The circuit proves that the region on the licence hashes to this value, but the value itself is a public input — so recompute it from the region you asked for and compare, exactly as you do with the scope:

```typescript
import { keccak256 } from 'ethers';

const regionCodeFor = (region: string): string => {
  const padded = new Uint8Array(64);
  padded.set(new TextEncoder().encode(region));
  return keccak256(padded);
};

// regionCodeFor('경기도') — compare against indices 64–95, rebuilt with toBytes32()
```

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
    returnScheme: 'https://myapp.com',
  });
} catch (err) {
  // "returnScheme must be a bare custom scheme such as "mydapp://" — hosts,
  //  paths, query strings and fragments are not accepted, and an https URL is
  //  not a return target"  (thrown before any network call)
}

try {
  await sdk.waitForProof(relay.requestId, { timeoutMs: 60000 });
} catch (err) {
  // "Waiting for proof timed out after 60000ms"
}
```

A relay rejection surfaces as its message, e.g. `Duplicate nonce (replay detected)` for a reused `nonce`, or `Request not found or expired` from `pollResult()`.

Verification is the exception: `verifyResponseOnChain` and `verifyOnChain` report failures as `{ valid: false, error }` instead of throwing.

A proof that fails on the phone is not an exception either — it comes back as a result with `status: 'error'` and an `error` string. Step 6 covers those, and which of them are worth retrying.

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
