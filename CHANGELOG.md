# Changelog

## [0.1.1-beta.1](https://github.com/zkproofport/proofport-app-sdk/compare/v0.1.0-beta.1...v0.1.1-beta.1) (2026-02-11)


### Features

* add beta invite modal to demo landing page ([ae1d03a](https://github.com/zkproofport/proofport-app-sdk/commit/ae1d03afa1fe44437ec41e086904bc18c567e3c7))
* add required organization field to beta invite modal ([f1cabf6](https://github.com/zkproofport/proofport-app-sdk/commit/f1cabf69a5a50da92f3ebed11917dadbcdd72525))
* convert demo page to relay-based authentication flow ([197509e](https://github.com/zkproofport/proofport-app-sdk/commit/197509ee3802dd60be8239cd19da99b370cbbf2d))


### Bug Fixes

* add Socket.IO connect_error handler for relay rejection logging ([9a9221f](https://github.com/zkproofport/proofport-app-sdk/commit/9a9221f7f9cb830d31f6b539f9a4fa2c241b967f))
* merge duplicate importmaps and upgrade ethers to v6 ([48a1f8f](https://github.com/zkproofport/proofport-app-sdk/commit/48a1f8f68dc6696dfb7576380f41b9a7688229c1))
* replace hardcoded demo credentials with server-side injection ([7683cf2](https://github.com/zkproofport/proofport-app-sdk/commit/7683cf207795d10a95474f6eb95c8bbca0b3568a))
* resolve zkpswap auto-login and null element errors ([59ca71b](https://github.com/zkproofport/proofport-app-sdk/commit/59ca71bf4a403a901b7a7a6b789650fffcdf8f81))
* use dynamic relay URL for LAN IP access in demo pages ([2e07472](https://github.com/zkproofport/proofport-app-sdk/commit/2e074725c12544f68795be5550256c21fbbf2972))
* use https module for HTTPS proxy targets in demo server ([5d873e8](https://github.com/zkproofport/proofport-app-sdk/commit/5d873e8e7c5013eb9e84a0a4c4a601e6a664028f))


### Refactoring

* add nullifier instance methods and clean public API surface ([9e2ee0a](https://github.com/zkproofport/proofport-app-sdk/commit/9e2ee0a9f673480a9e93b12aa56dd96016084331))
* mark internal APIs and remove unused exports ([e490b58](https://github.com/zkproofport/proofport-app-sdk/commit/e490b583ac301ca3c641180749b7f14f70c8ffb6))
* rename ProofPortSDK to ProofportSDK and update source references ([f84ff6d](https://github.com/zkproofport/proofport-app-sdk/commit/f84ff6d5bf89923215b4956793680a22465a7935))
* rename ZKProofPort to ZKProofport in demo pages ([c447155](https://github.com/zkproofport/proofport-app-sdk/commit/c4471551c216a11b796765bf861086da5c492836))

## [0.1.0](https://github.com/zkproofport/proofport-app-sdk/releases/tag/v0.1.0) (2026-02-05)

### Features

- add verifier module with on-chain verification support
- add nullifier and scope support to SDK types and exports
- add QR code deep link generation for mobile proof requests
- add platform-aware requestProof with split rollup builds for web/Node.js
- add Coinbase country circuit support to SDK
- add demo landing page with SSE callback and verification flow
- add relay demo page with proxy server and QR polling
- update demo pages with mobile detection, copy buttons, and improved UX

### Bug Fixes

- fix ethers v5/v6 compatibility in verifier module
- fix mobile demo to persist state across page reload
- fix OG image URLs to be environment-aware using request Host header
- fix OG image format: use PNG instead of SVG for social media crawler compatibility
- remove dist/ from version control (build artifact)

### Documentation

- update branding to ZKProofport across all SDK references
- add documentation for Coinbase country attestation circuit
- update documentation for dynamic verifier addresses
- add OpenGraph and Twitter Card meta tags to demo pages
