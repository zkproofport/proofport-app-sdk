/**
 * @zkproofport-app/core -- what every ZKProofport consumer shares and nothing
 * heavier: circuit identifiers and their rules, the EIP-712 action check, and
 * on-chain verification. Depends only on ethers (peer, v5 or v6).
 *
 * The customer SDK (@zkproofport-app/sdk) re-exports all of this and adds the
 * relay, deep links, QR codes and off-chain verification (bb.js). The mobile
 * app, the relay, proofport-ai and its published client SDK/MCP import this
 * package directly, so none of them carries a copy and none installs bb.js.
 */
export * from './circuits';
export * from './typedAction';
export * from './verifier';
export * from './chain';
export type { CircuitType, ParsedProof, VerifierContract } from './types';
