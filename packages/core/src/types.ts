import type { CircuitId } from './circuits';

/**
 * Zero-knowledge circuit identifiers.
 * Uses canonical circuit names matching Nargo.toml circuit definitions.
 *
 * Alias of {@link CircuitId}, which is defined in `./circuits` — the single
 * source of truth for circuit identifiers. Adding a circuit there widens this
 * type automatically, so the two can never disagree.
 *
 * Note that this union includes circuits marked `planned` in
 * `CIRCUIT_SUPPORT_STATUS`; being assignable is not a support guarantee.
 *
 * @example
 * ```typescript
 * const circuit: CircuitType = 'coinbase_attestation';
 * ```
 */
export type CircuitType = CircuitId;

/**
 * The EIP-712 action a `giwa_attestation` proof binds the wallet's signature to.
 *
 * Exactly what `eth_signTypedData_v4` takes, because that is what the wallet is
 * shown and what it signs. The app does not build this — the dapp does — so the
 * user reads the dapp's own field names and values in their wallet instead of
 * an opaque hash.
 *
 * @example
 * ```typescript
 * const action: TypedAction = {
 *   domain: { name: 'MyVault', version: '1', chainId: 91342,
 *             verifyingContract: '0x…' },
 *   types: { Deposit: [ { name: 'amount', type: 'uint256' },
 *                       { name: 'nonce',  type: 'uint256' } ] },
 *   primaryType: 'Deposit',
 *   message: { amount: '1000000', nonce: '7' },
 * };
 * ```
 */
export interface TypedAction {
  domain: {
    name: string;
    version: string;
    chainId: number;
    /** The contract that will verify this signature. */
    verifyingContract: string;
  };
  /** EIP-712 struct definitions. `EIP712Domain` is added by the wallet. */
  types: Record<string, Array<{ name: string; type: string }>>;
  /** Which struct in `types` the message is. */
  primaryType: string;
  message: Record<string, unknown>;
}


/**
 * Parsed and formatted proof data ready for on-chain verification.
 *
 * Internal representation used by the SDK to prepare proof data
 * for smart contract verification calls.
 */
export interface ParsedProof {
  /** Proof bytes as hex string with 0x prefix */
  proofHex: string;
  /** Public inputs as array of hex strings with 0x prefix */
  publicInputsHex: string[];
  /** Number of public inputs (must match circuit specification) */
  numPublicInputs: number;
}


/**
 * Verifier smart contract configuration.
 *
 * Contains the address and ABI for a circuit's verifier contract on a specific chain.
 * Each circuit has its own verifier contract that validates proofs on-chain.
 */
export interface VerifierContract {
  /** Verifier contract address (checksummed) */
  address: string;
  /** Chain ID where contract is deployed (e.g., 84532 for Base Sepolia) */
  chainId: number;
  /** Contract ABI for verify function (ethers v6 format) */
  abi: string[];
}

