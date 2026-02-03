# @proofport/sdk

ProofPort SDK for requesting zero-knowledge proofs from the ProofPort mobile app and verifying them on-chain.

## Overview

The ProofPort SDK enables web applications to:

1. Create proof requests for ZK circuits (Coinbase KYC attestations)
2. Generate deep links or QR codes for users to complete proofs on mobile
3. Handle proof responses and verify them on-chain via Ethereum smart contracts

## Installation

```bash
npm install @proofport/sdk
```

## Quick Start

```typescript
import { ProofPortSDK } from '@proofport/sdk';

// Create SDK instance
const sdk = new ProofPortSDK({
  defaultCallbackUrl: 'https://myapp.com/verify'
});

// Create Coinbase KYC request
const request = sdk.createCoinbaseKycRequest({
  // No inputs required - app handles wallet connection
});

// Generate deep link URL
const deepLink = sdk.getDeepLinkUrl(request);

// Or generate QR code
const qrDataUrl = await sdk.generateQRCode(request);

// Open ProofPort app (browser only)
sdk.openProofRequest(request);
```

## Supported Circuits

### coinbase_attestation

Proves Coinbase KYC identity verification without revealing the user's identity.

- **Verifier Address**: Provided by the ProofPort app in the proof response
- **Public Inputs**: `signal_hash`, `signer_list_merkle_root`, `scope`, `nullifier`
- **Status**: Production-ready

**Inputs:**
```typescript
{
  userAddress?: string;      // Optional - app will connect wallet if not provided
  rawTransaction?: string;   // Optional - app can fetch from Etherscan
}
```

### coinbase_country_attestation

Proves Coinbase country attestation without revealing the country.

- **Verifier Address**: Provided by the ProofPort app in the proof response
- **Public Inputs**: `signal_hash`, `signer_list_merkle_root`, `scope`, `nullifier`
- **Status**: Production-ready

## API Reference

### ProofPortSDK Constructor

```typescript
const sdk = new ProofPortSDK(config?: ProofPortConfig);
```

**Configuration:**
```typescript
interface ProofPortConfig {
  scheme?: string;                                    // Default: 'zkproofport'
  defaultCallbackUrl?: string;                        // Default callback URL for all requests
  verifiers?: Partial<Record<CircuitType, VerifierContract>>;  // Custom verifier contracts
}
```

### Create Proof Requests

#### createCoinbaseKycRequest(inputs, options?)

Creates a Coinbase KYC verification request.

```typescript
const request = sdk.createCoinbaseKycRequest(
  {
    // No inputs required - app handles wallet connection
  },
  {
    callbackUrl: 'https://myapp.com/callback',  // Optional
    message: 'Please verify with Coinbase',      // Optional
    dappName: 'My App',                          // Optional
    dappIcon: 'https://myapp.com/icon.png',      // Optional
    expiresInMs: 600000                          // Optional: 10 minutes default
  }
);
```

#### createProofRequest(circuit, inputs, options?)

Generic proof request creation.

```typescript
const request = sdk.createProofRequest('coinbase_attestation', inputs, options);
```

### Deep Link Generation

#### getDeepLinkUrl(request)

Generates a deep link URL for a proof request.

```typescript
const deepLink = sdk.getDeepLinkUrl(request);
// Returns: zkproofport://proof-request?data=<encoded_request>
```

#### openProofRequest(request)

Opens the ProofPort app with a proof request (browser only).

```typescript
sdk.openProofRequest(request);
```

### QR Code Generation

#### generateQRCode(request, options?)

Generates QR code as data URL.

```typescript
const qrDataUrl = await sdk.generateQRCode(request, {
  width: 300,
  errorCorrectionLevel: 'M',
  margin: 2,
  darkColor: '#000000',
  lightColor: '#ffffff'
});

// Use in HTML
document.getElementById('qr').src = qrDataUrl;
```

#### generateQRCodeSVG(request, options?)

Generates QR code as SVG string.

```typescript
const svgString = await sdk.generateQRCodeSVG(request);
```

#### renderQRCodeToCanvas(canvas, request, options?)

Renders QR code directly to canvas element.

```typescript
const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
await sdk.renderQRCodeToCanvas(canvas, request);
```

### Response Handling

#### parseResponse(url)

Parses proof response from callback URL.

```typescript
const response = sdk.parseResponse(callbackUrl);

interface ProofResponse {
  requestId: string;
  circuit: 'coinbase_attestation' | 'coinbase_country_attestation';
  status: 'completed' | 'error' | 'cancelled' | 'pending';
  proof?: string;              // Hex string with 0x prefix
  publicInputs?: string[];     // Array of hex strings
  numPublicInputs?: number;
  error?: string;              // Error message if status is 'error'
  timestamp?: number;
}
```

#### isProofPortResponse(url)

Checks if a URL is a ProofPort response.

```typescript
if (sdk.isProofPortResponse(url)) {
  const response = sdk.parseResponse(url);
}
```

### Proof Verification

#### verifyOnChain(circuit, proof, publicInputs, providerOrSigner?)

Verifies a proof on-chain via smart contract.

```typescript
const result = await sdk.verifyOnChain(
  'coinbase_attestation',
  '0x...',  // proof hex string
  ['0x...', '0x...'],  // public inputs as hex strings
  provider  // Optional: ethers.Provider or ethers.Signer
);

// Returns: { valid: boolean; error?: string }
```

#### verifyResponseOnChain(response, providerOrSigner?)

Verifies a complete proof response on-chain.

```typescript
const response = sdk.parseResponse(callbackUrl);
const result = await sdk.verifyResponseOnChain(response, provider);
```

### Utility Methods

#### getVerifierAddress(circuit)

Gets the verifier contract address for a circuit (requires verifier configuration in SDK config).

```typescript
const address = sdk.getVerifierAddress('coinbase_attestation');
// Returns the address configured via SDK verifiers option
```

#### getVerifierChainId(circuit)

Gets the chain ID where the verifier is deployed (requires verifier configuration in SDK config).

```typescript
const chainId = sdk.getVerifierChainId('coinbase_attestation');
// Returns the chainId configured via SDK verifiers option
```

#### getCircuitMetadata(circuit)

Gets metadata about a circuit.

```typescript
const metadata = sdk.getCircuitMetadata('coinbase_attestation');
// Returns: { name, description, publicInputsCount, publicInputNames }
```

#### getSupportedCircuits()

Gets all supported circuit types.

```typescript
const circuits = sdk.getSupportedCircuits();
// Returns: ['coinbase_attestation', 'coinbase_country_attestation']
```

#### validateRequest(request)

Validates a proof request structure.

```typescript
const validation = sdk.validateRequest(request);
// Returns: { valid: boolean; error?: string }
```

## Deep Link Protocol

The SDK uses the `zkproofport://` scheme for deep linking.

**Format:**
```
zkproofport://proof-request?data=<base64url_encoded_request>
```

**Request structure (encoded):**
```json
{
  "requestId": "req-...",
  "circuit": "coinbase_attestation",
  "inputs": { ... },
  "callbackUrl": "https://myapp.com/callback",
  "message": "Please verify with Coinbase",
  "dappName": "My App",
  "dappIcon": "https://myapp.com/icon.png",
  "createdAt": 1234567890,
  "expiresAt": 1234567890
}
```

**Response (callback URL):**
```
https://myapp.com/callback?requestId=req-...&status=completed&proof=0x...&publicInputs=0x...,0x...
```

## Demo

Run the included demo server to test the SDK:

```bash
npm run demo
```

Visit `http://localhost:3333` in your browser.

**Demo Features:**
- Create Coinbase KYC requests
- Generate QR codes and deep links
- Poll for proof results from the mobile app
- Verify proofs on-chain (Sepolia testnet)

**Endpoints:**
- `GET /` - Demo page
- `POST /callback` - Receive proof from app
- `GET /status/:requestId` - Poll for result

## Development

**Install dependencies:**
```bash
npm install
```

**Build SDK:**
```bash
npm run build
```

Output is in `dist/` directory.

**Watch mode:**
```bash
npm run dev
```

**Run tests:**
```bash
npm test
```

**Run demo:**
```bash
npm run demo
```

## Integration Guide

### 1. Initialize SDK

```typescript
const sdk = new ProofPortSDK({
  defaultCallbackUrl: 'https://myapp.com/api/proof-callback',
  scheme: 'zkproofport'  // Optional: custom scheme
});
```

### 2. Create Proof Request

```typescript
const request = sdk.createCoinbaseKycRequest(
  {
    // No inputs required - app handles wallet connection
  },
  {
    message: 'Please verify with Coinbase to continue'
  }
);
```

### 3. Show User Options

```typescript
// Option A: Deep link
const deepLink = sdk.getDeepLinkUrl(request);
// Show button: <a href={deepLink}>Open ProofPort</a>

// Option B: QR code
const qrUrl = await sdk.generateQRCode(request);
// Show QR code image: <img src={qrUrl} />
```

### 4. Handle Callback

```typescript
// In your callback endpoint
app.post('/api/proof-callback', (req, res) => {
  const { requestId, status, proof, publicInputs } = req.body;

  if (status === 'completed') {
    // Store proof and public inputs
    // Verify on-chain when needed

    const result = await sdk.verifyOnChain(
      'coinbase_attestation',
      proof,
      publicInputs.split(',')
    );

    if (result.valid) {
      // User is verified!
    }
  }

  res.json({ success: true });
});
```

### 5. Verify On-Chain (Optional)

```typescript
// Use ethers.js provider
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(
  'https://sepolia.infura.io/v3/...'
);

const result = await sdk.verifyOnChain(
  'coinbase_attestation',
  proof,
  publicInputs,
  provider
);

if (result.valid) {
  console.log('Proof verified on Sepolia!');
} else {
  console.log('Proof verification failed:', result.error);
}
```

## Types

All TypeScript types are exported from the SDK:

```typescript
import type {
  CircuitType,
  ProofRequest,
  ProofResponse,
  CoinbaseKycInputs,
  QRCodeOptions,
  VerifierContract,
  ProofPortConfig
} from '@proofport/sdk';
```

## Error Handling

```typescript
try {
  const result = await sdk.verifyOnChain(circuit, proof, publicInputs);

  if (!result.valid) {
    console.error('Proof is invalid:', result.error);
  }
} catch (error) {
  console.error('Verification error:', error.message);
}
```

## Network Configuration

The SDK supports multiple networks via configuration:

```typescript
const sdk = new ProofPortSDK({
  verifiers: {
    coinbase_attestation: {
      address: '0x...',
      chainId: 1,  // Mainnet
      abi: [...]
    }
  }
});
```

By default, it uses Sepolia testnet verifiers.

## Monorepo Structure

This SDK is part of the `proofport-app-dev` ecosystem:

- **circuits/** - Noir ZK circuit implementations
- **proofport-app/** - React Native mobile app
- **proofport-app-sdk/** - This SDK (TypeScript)
- **proofport-relay/** - Express + Socket.IO relay server
- **proofport-api/** - Fastify + PostgreSQL backend
- **proofport-dashboard/** - Next.js admin dashboard
- **mopro/** - Rust mobile ZK library

See the root README for the complete architecture.

## License

MIT
