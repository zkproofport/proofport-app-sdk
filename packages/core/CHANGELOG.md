# Changelog

## [0.4.0-beta.6](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.5...core-v0.4.0-beta.6) (2026-10-31)


### Features

* **core:** accept a Human Passport score from every chain Passport records it on ([aa0507b](https://github.com/zkproofport/proofport-app-sdk/commit/aa0507be4930595d533462205d5efaf3ceda2ec2))

## [0.4.0-beta.5](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.4...core-v0.4.0-beta.5) (2026-10-30)


### Features

* **core:** human_passport_score -- Human Passport issuer root, scorer, threshold and time checked on every verify path ([6850941](https://github.com/zkproofport/proofport-app-sdk/commit/6850941f1a35efed3a831a85cc1d497c402036f2))


### Bug Fixes

* **scripts:** read signer lists only from the provers, OpenStoa holds none since it verifies through core ([fd717d6](https://github.com/zkproofport/proofport-app-sdk/commit/fd717d671c71530ddcfb02806084728f66818436))

## [0.4.0-beta.4](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.3...core-v0.4.0-beta.4) (2026-10-30)


### Features

* **core:** pin the Coinbase Country v2 factory-key Android verifier on Ethereum mainnet ([266bdaa](https://github.com/zkproofport/proofport-app-sdk/commit/266bdaa1974a246c3e1da362806fb738f0cb61fb))

## [0.4.0-beta.3](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.2...core-v0.4.0-beta.3) (2026-10-30)


### Features

* **core:** pin the Coinbase Country v2 verifiers on Ethereum mainnet ([d7287ad](https://github.com/zkproofport/proofport-app-sdk/commit/d7287ad6690074086ae1068a9aa0fe0461c0132f))

## [0.4.0-beta.2](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.1...core-v0.4.0-beta.2) (2026-10-30)


### ⚠ BREAKING CHANGES

* **core:** judge Coinbase Country by the v2 layout

### Features

* **core:** hold a Coinbase Country proof to the list it was asked for ([acd8714](https://github.com/zkproofport/proofport-app-sdk/commit/acd87147fd6b6ade6d9fc664ec48d08456898c0e))
* **core:** judge Coinbase Country by the v2 layout ([abce345](https://github.com/zkproofport/proofport-app-sdk/commit/abce3457cbfb7eabb18748a370f5b26ea4db3b9d))
* **core:** pin the Coinbase Country v2 verifiers ([2f28885](https://github.com/zkproofport/proofport-app-sdk/commit/2f28885cb53693eb944f6f648f4e31aef621d81a))

## [0.4.0-beta.1](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.4.0-beta.0...core-v0.4.0-beta.1) (2026-10-29)


### ⚠ BREAKING CHANGES

* **core:** judge Coinbase KYC by the v2 layout and pin its verifiers

### Features

* **core:** judge Coinbase KYC by the v2 layout and pin its verifiers ([fae9d07](https://github.com/zkproofport/proofport-app-sdk/commit/fae9d07284bf5dd2dafff7b6d723a6ad3449940d)), closes [#34](https://github.com/zkproofport/proofport-app-sdk/issues/34)

## [0.4.0-beta.0](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.3.0...core-v0.4.0-beta.0) (2026-10-29)


### ⚠ BREAKING CHANGES

* **core:** remove the Korean mobile ID circuits

### Features

* **core:** add the android_factory signer variant ([1ff194a](https://github.com/zkproofport/proofport-app-sdk/commit/1ff194ae5f8a3fc75417c86eff278e7518761cb1))
* **core:** keep a dropped provider key for 1 hour, not 24 ([a5c2df1](https://github.com/zkproofport/proofport-app-sdk/commit/a5c2df163cd86c72ac6065aae5acd91f17564ef0))
* **core:** pin the Android signer verifiers on the two testnets ([abf5291](https://github.com/zkproofport/proofport-app-sdk/commit/abf5291437f639d2f30cc9a25ceea6e527aef57d))
* **core:** pin the OIDC and Android signer verifiers on Base and Ethereum mainnet ([2f6a0da](https://github.com/zkproofport/proofport-app-sdk/commit/2f6a0da606f1aebdaf85a6a09f4ec8c758a0f46e))
* **core:** pin the OIDC claim-quote fix verifiers on the two testnets ([43a9098](https://github.com/zkproofport/proofport-app-sdk/commit/43a90980b04bbe89ae34d349a63e765422882ad0))
* **core:** pin the OIDC provider-key statement verifiers on the testnets ([304ccac](https://github.com/zkproofport/proofport-app-sdk/commit/304ccac23a6a63dcee0ed66b1715a14d9cb8a509))
* **core:** remove the Korean mobile ID circuits ([0f62c6f](https://github.com/zkproofport/proofport-app-sdk/commit/0f62c6fd4a04c7384323d8f0975a84f1a9578f51))
* **core:** verify android-signer proofs by signer variant ([2610f1f](https://github.com/zkproofport/proofport-app-sdk/commit/2610f1feda9d1935a417c4f2fb05ef588af1ea4f))

## [0.3.0](https://github.com/zkproofport/proofport-app-sdk/compare/core-v0.2.0...core-v0.3.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **core:** verify OIDC v2 proofs and their audience, nonce and time

### Features

* **core:** pin the OIDC v2 verifiers on the two testnets ([2a3340e](https://github.com/zkproofport/proofport-app-sdk/commit/2a3340e8870c546fb495499e90c00eb0eedc6acd))
* **core:** verify OIDC v2 proofs and their audience, nonce and time ([3ea28ea](https://github.com/zkproofport/proofport-app-sdk/commit/3ea28eab342788013feaf4028aeaa684031ba2df))

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
