/**
 * Public inputs for the signer-root circuits, shaped as each circuit emits
 * them: the right count, one byte per field, the signer root at its offset.
 * Everything else is zero, except a Coinbase KYC proof's attested_at (now).
 */
import { SIGNER_ROOT_LAYOUTS, COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT } from '../../verifier';

export type RootCircuit = keyof typeof SIGNER_ROOT_LAYOUTS;

const field = (v: number | bigint) => '0x' + BigInt(v).toString(16).padStart(64, '0');

export function attestationInputs(circuit: RootCircuit, root: string = SIGNER_ROOT_LAYOUTS[circuit].set.root): string[] {
  const layout = SIGNER_ROOT_LAYOUTS[circuit];
  const inputs = Array.from({ length: layout.publicInputCount }, () => field(0));
  const bytes = root.slice(2).match(/../g)!;
  bytes.forEach((b, i) => (inputs[layout.rootStart + i] = field(parseInt(b, 16))));
  // Coinbase KYC v2 ends with attested_at, held to the verifier's clock.
  if (circuit === 'coinbase_attestation') inputs[COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT] = field(Math.floor(Date.now() / 1000));
  return inputs;
}
