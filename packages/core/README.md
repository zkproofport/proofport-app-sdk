# @zkproofport-app/core

What every ZKProofport integration shares, with no heavy dependencies:

- circuit identifiers and their rules (`@zkproofport-app/core/circuits`, no dependencies)
- the EIP-712 action check for proofs that bind one (`@zkproofport-app/core/typedAction`, no dependencies)
- on-chain proof verification (`verifyProofOnChain`, needs `ethers` v5 or v6)

```ts
import { verifyProofOnChain, CIRCUIT_IDS } from '@zkproofport-app/core';
```

`@zkproofport-app/sdk` re-exports all of this and adds proof requests, QR codes,
the relay and off-chain verification.

## What every verify function checks besides the proof

`verifyProofOnChain` (and the SDK's verify methods, which call the same checks)
refuse a proof the contract would accept when its public inputs do not say what
a verifier needs:

- **Signer-list root** (Coinbase KYC, Coinbase country, GIWA): must be the root
  of the published signer set.
- **OIDC domain** (`oidc_domain_attestation`, 214 public inputs): the token's
  audience must be a ZKProofport sign-in client, its nonce mode must be the one
  that client uses, `now` must be within 15 minutes behind and 5 minutes ahead
  of the verifier's clock, and the RSA key must be one Google or Microsoft
  publishes. Pass `{ request: { scope, requestId } }` in the options to require
  that an app proof's nonce is bound to that request (`checkOidcPolicy`,
  `deriveOidcNonceBinding`). A 148-input proof from the earlier circuit version
  is refused.
