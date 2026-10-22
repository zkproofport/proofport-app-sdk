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
