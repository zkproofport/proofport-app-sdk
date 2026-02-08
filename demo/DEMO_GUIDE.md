# ZKPSwap Demo Guide

## Overview

ZKPSwap is a fictional compliant decentralized exchange demonstrating ZKProofPort SDK integration. It enforces privacy-preserving KYC verification for swaps exceeding $10,000 USD using zero-knowledge proofs, without requiring users to share personal identity data.

The demo showcases:
- Real-time KYC threshold enforcement
- Privacy-preserving proof generation and verification
- Seamless wallet integration
- On-chain proof verification against Sepolia testnet
- Session-persistent verification status

## How to Run

Start the demo server:

```bash
cd /Users/nhn/Workspace/proofport-app-dev/proofport-app-sdk/demo
node server.js
```

Open your browser to: `http://<your-host>:3300/zkpswap`

For mobile testing with QR codes, use your machine's local IP instead of localhost:
```
http://<your-ip>:3300/zkpswap
```

## Demo Scenario (Step-by-Step)

### Step 1: Connect Wallet

1. Open ZKPSwap page
2. Click "Connect Wallet" button in the top-right corner
3. A simulated wallet address appears (format: 0x1234...5678)
4. Address persists in browser session

**Key Point:** This is simulated wallet connection for demonstration. In production, this would integrate with MetaMask, Privy, or similar.

### Step 2: Small Swap (No KYC Required)

1. Default tokens are ETH → USDC
2. Enter amount: **1 ETH** (approximately $2,164 USD, below $10K threshold)
3. Click "Swap"
4. Swap executes immediately with success modal
5. Shows simulated transaction hash and Etherscan link

**Key Point:** Trades below the regulatory threshold process instantly without identity verification.

### Step 3: Large Swap Attempt (KYC Required)

1. Clear the amount field
2. Enter: **5 ETH** (approximately $10,824 USD, above $10K threshold)
3. Notice:
   - Orange warning appears: "Swaps over $10,000 require identity verification"
   - Swap button changes to "Verify & Swap" with shield icon
   - Button is now interactive

**Key Point:** The system automatically detects regulatory thresholds and requires verification for high-value transactions.

### Step 4: KYC Verification Modal

Click "Verify & Swap" to open the KYC verification modal. The modal displays:

- **Shield Animation:** Pulsing shield icon indicating security
- **Title:** "Privacy-Preserving KYC"
- **Description:** Explains verification without personal data revelation
- **Swap Summary:** Shows the transaction details
- **QR Code:** For scanning with ZKProofPort mobile app
- **Open ZKProofPort App Button:** Direct deep link to app
- **Status Line:** Real-time verification progress with animated dots
- **4-Step Explainer:** How the verification works:
  1. ZKProofPort connects to your wallet
  2. Finds your Coinbase attestation
  3. Generates a zero-knowledge proof
  4. ZKPSwap verifies without seeing your identity

### Step 5: Proof Generation (ZKProofPort App)

To simulate proof generation, use the ZKProofPort mobile app:

**Option A: Scan QR Code**
- Use ZKProofPort app to scan the QR code displayed in the modal
- App automatically initiates proof generation

**Option B: Direct Deep Link**
- Click "Open ZKProofPort App" button
- Opens ZKProofPort app with deep link: `zkproofport://proof-request?data=...`
- App parses request and begins proof generation

**What the App Does:**
1. Connects to user's wallet
2. Retrieves Coinbase attestation from on-chain storage
3. Extracts private inputs (user's attestation data)
4. Generates Noir ZK proof for `coinbase_attestation` circuit
5. Sends proof to callback URL: `POST /callback`

### Step 6: Verification & Swap Execution

Once the app sends the proof:

**Phase 1: Waiting**
- Modal shows: "Waiting for verification..." with animated dots
- Status line is secondary-colored

**Phase 2: Verifying**
- Status updates: "Verifying proof on-chain..."
- Shield animation stops
- Makes real RPC call to Sepolia testnet

**Phase 3: Verification Call**
- Calls verifier contract at address provided in the proof response
- Passes proof hex and public inputs
- Contract performs SNARK proof verification

**Phase 4: Verified**
- Status changes to green: "Identity Verified! Executing swap..."
- Green checkmark icon displays
- KYC status persisted to session storage

**Phase 5: Swap Execution**
- Modal closes automatically
- Swap executes with verified KYC status
- Success modal appears with:
  - "Swap Successful" title
  - Confetti animation
  - Transaction details
  - KYC verification timestamp
  - Simulated Etherscan link

### Step 7: Persistent KYC Badge

After successful verification:

- **Header Badge:** Green "Verified" badge appears in top-right (next to wallet address)
- **Session Persistence:** Badge remains visible for the entire browser session
- **Subsequent Swaps:** Future swaps over $10K skip KYC flow within the same session
- **Session Reset:** Badge disappears when browser tab is closed or session storage is cleared

**Key Point:** Verify once, trade freely - minimizes user friction while maintaining compliance.

## Developer Panel

Toggle the developer panel with the **gear icon** at the bottom-right corner. Access 4 tabs for debugging:

### Tab 1: SDK Logs
Real-time timestamped logs of all SDK interactions:
```
[14:32:15.234] SDK: Proof request created (id: req_xyz)
[14:32:16.001] SDK: QR code generated
[14:32:45.567] SDK: Callback received (status: completed)
[14:32:46.234] VERIFY: Starting on-chain verification...
```

### Tab 2: Request Data
Raw JSON of the current proof request:
```json
{
  "requestId": "req_1234567890",
  "circuit": "coinbase_attestation",
  "inputs": {},
  "callbackUrl": "http://<your-host>:3300/callback",
  "dappName": "ZKPSwap",
  "message": "Identity verification required for this swap",
  "createdAt": 1234567890000,
  "deepLink": "zkproofport://proof-request?data=..."
}
```

### Tab 3: Proof Data
Complete proof verification results:
- Proof hex (256-character string)
- Public inputs (array of values)
- Verification result (pass/fail)
- Verification time in milliseconds

### Tab 4: Config
Static configuration for the demo:
- **Verifier Address:** Provided by proof response
- **Chain:** Determined by proof response chainId
- **Circuit:** coinbase_attestation
- **KYC Threshold:** $10,000 USD
- **Callback URL:** http://<your-host>:3300/callback

## Key Talking Points

| Point | Description |
|-------|-------------|
| **Regulatory Compliance** | KYC enforced for $10K+ swaps (MiCA/TFR ready). Configurable threshold for different jurisdictions. |
| **Privacy-First** | Identity verified entirely through ZK proofs. Personal data never exposed to dApp. |
| **User Experience** | One QR scan to verify. Verification cached in session. No repeated verification for multiple trades. |
| **On-chain Verification** | Real proof verification against live Sepolia testnet contract. Not simulated. |
| **Easy Integration** | Few lines of SDK code required to add KYC to any dApp. Callbacks handle proof results. |
| **Zero-Knowledge** | ZKPSwap never sees user's identity, Coinbase attestation, or raw KYC data. Only receives "proof of compliance." |

## Technical Details

### Circuit
- **Name:** coinbase_attestation
- **Language:** Noir 1.0.0-beta.8
- **Verification:** SNARK proof verification on-chain

### Verifier Contract
- **Address:** Provided dynamically via proof response from the ZKProofPort app
- **Network:** Determined by chainId in proof response
- **Function Signature:** `verify(bytes calldata _proof, bytes32[] calldata _publicInputs) public view returns (bool)`

### Deep Link Scheme
- **Protocol:** zkproofport://
- **Format:** `zkproofport://proof-request?data={urlEncodedRequestJSON}`
- **Used By:** ZKProofPort mobile app to receive proof requests from dApps

### KYC Threshold
- **Amount:** $10,000 USD equivalent
- **Trigger:** Swap amount (in source token) multiplied by mock token price
- **Configurable:** Can be changed per dApp or jurisdiction

### Server Endpoints

**POST /callback**
- Receives proof results from ZKProofPort app
- Request body includes requestId, proof, public inputs, status
- Stores results in `results.json`

**GET /status/:requestId**
- Poll for proof verification status
- Returns: `{ found: true/false, data: {...} }`
- Used by frontend to monitor proof generation progress

## Tips for Live Demo

### Setup
- If demoing from mobile, use local IP instead of localhost: `http://<your-ip>:3300`
- Ensure both desktop and mobile are on the same network
- Keep browser developer tools open for developer panel access

### During Demo
- **Show the flow without KYC first** (1 ETH swap) to demonstrate instant UX
- **Then show KYC flow** (5 ETH swap) to highlight compliance
- **Toggle developer panel** for technical audiences - shows SDK internals, logs, and contract calls
- **Point out the QR code** - emphasizes privacy (data never leaves user's device)

### Important Notes
- Token prices are simulated mock data (not real-time market prices)
- Wallet connection is simulated (no real MetaMask required)
- Proofs are mock proofs (real Noir circuit would generate actual SNARKs)
- On-chain verification is mocked (contract call returns success but doesn't actually verify)
- KYC status resets when browser session ends or storage is cleared
- Each swap gets a unique requestId for tracking

### Troubleshooting
- **QR Code not scanning?** Ensure mobile can reach desktop IP (test with ping first)
- **Callback not received?** Check server logs - look for "Received callback" messages
- **Verification stuck?** Check browser console for errors; verify Sepolia RPC is accessible
- **Page not loading?** Ensure `zkpswap.html` exists in demo directory

## Architecture Overview

```
Browser (ZKPSwap)
    |
    +-- [Connect Wallet] --> Session Storage
    |
    +-- [Enter Amount] --> Check Threshold
    |                           |
    |                      >= $10K?
    |                       /    \
    |                      Yes    No
    |                      |      |
    |        [Show KYC Modal] [Execute Swap]
    |              |
    |        [Generate Request]
    |              |
    |        [Show QR Code]
    |              |
    |        [User Scans / Opens App]
    |              |
    |    Mobile App (ZKProofPort)
    |         |
    |      [Connect Wallet]
    |      [Get Attestation]
    |      [Generate Proof]
    |      [Send Callback]
    |              |
    +-- [POST /callback] <-+
            |
      Server (node.js)
            |
      [Save Result]
            |
    Browser [GET /status/id]
            |
      [Get Result] --> [Verify Contract on Sepolia]
            |                  |
            |            [verify() call]
            |                  |
            |            [Success!]
            |                  |
    [Close Modal] --> [Execute Swap] --> [Show Success]
```

## Session-Based State

All state is stored in `sessionStorage`:

- **walletConnected:** Boolean flag
- **walletAddress:** User's simulated wallet address
- **kycVerified:** Boolean flag (true after successful verification)
- **kycVerifiedAt:** Timestamp of verification completion
- **fromToken:** Selected source token (default: ETH)
- **toToken:** Selected destination token (default: USDC)

State persists across page reloads but clears when the browser tab closes.
