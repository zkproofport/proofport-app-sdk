/**
 * On-chain verification utilities for ZKProofPort SDK
 *
 * Compatible with both ethers v5 and v6.
 */
import { ethers } from 'ethers';
import type { CircuitType, ParsedProof, VerifierContract } from './types';
/**
 * Get verifier contract instance
 */
export declare function getVerifierContract(providerOrSigner: any, verifier: VerifierContract): ethers.Contract;
/**
 * Get default provider for a chain
 */
export declare function getDefaultProvider(chainId: number): any;
/**
 * Verify proof on-chain
 */
export declare function verifyProofOnChain(circuit: CircuitType, parsedProof: ParsedProof, providerOrSigner?: any, customVerifier?: VerifierContract, responseVerifier?: {
    verifierAddress?: string;
    chainId?: number;
}): Promise<{
    valid: boolean;
    error?: string;
}>;
/**
 * Parse proof response into format suitable for on-chain verification.
 * Public inputs are zero-padded to 32 bytes (bytes32).
 */
export declare function parseProofForOnChain(proof: string, publicInputs: string[], numPublicInputs: number): ParsedProof;
/**
 * Get verifier contract address for a circuit
 */
export declare function getVerifierAddress(circuit: CircuitType, customVerifier?: VerifierContract): string;
/**
 * Get chain ID for a circuit's verifier
 */
export declare function getVerifierChainId(circuit: CircuitType, customVerifier?: VerifierContract): number;
export declare function extractScopeFromPublicInputs(publicInputsHex: string[], circuit?: string): string | null;
export declare function extractNullifierFromPublicInputs(publicInputsHex: string[], circuit?: string): string | null;
