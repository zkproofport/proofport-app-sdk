# Changelog

## [0.2.0](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.1.2...core-v0.2.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **core:** Coinbase, Country and GIWA proofs whose public inputs do not carry the published signer root, or have the wrong count, now return { valid: false, error } from every verify function.
* **core:** verifyProofOnChain's 4th argument is a VerifierTarget (VerifierContract or { chainId }); passing only the response's verifier as the 5th argument now returns { valid: false }. verifyProofOnChain and verifyProofOffChain return { valid: false, error } for an unknown circuit and for OIDC proofs whose key the provider does not publish.

### Features

* **core:** check OIDC provider keys and pinned verifiers in every verify ([609e398](https://github.com/zkproofport/proofport-app-sdk/commit/609e398b9b8760f869b29d4795057d8e448683c9))
* **core:** pin verifier addresses generated from circuits records ([332b121](https://github.com/zkproofport/proofport-app-sdk/commit/332b121a789ecd67731ee21cd96e91a5acd8171f))
* **core:** refuse proofs whose signer-list root is not the published one ([521deb4](https://github.com/zkproofport/proofport-app-sdk/commit/521deb41da09b6de0ca0d5136ef2990f0c96932b))

## [0.1.2](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.1.1...core-v0.1.2) (2026-10-22)


### Bug Fixes

* **core:** ship ESM as .mjs so every Node version loads it ([229d0cf](https://github.com/zkproofport/proofport-app-sdk/commit/229d0cffe6eb467982a82265d0bdfa2f9c3d5cee))

## [0.1.1](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.1.0...core-v0.1.1) (2026-10-22)


### Features

* add @zkproofport-app/core for what every consumer shares ([2b92c2e](https://github.com/zkproofport/proofport-app-sdk/commit/2b92c2e45a2d7797952d0d14d1b9cc8d7e7fe544))


### Bug Fixes

* **sdk:** release the rewritten documentation to npm ([4e65258](https://github.com/zkproofport/proofport-app-sdk/commit/4e652584b357be97e966a9fd79327a4dcad20c20))


### Miscellaneous

* release the toolchain upgrade as a beta ([9b161a1](https://github.com/zkproofport/proofport-app-sdk/commit/9b161a14fabbc155bfd5c6ae577e71689fb28922))
