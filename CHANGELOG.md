# Changelog

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
