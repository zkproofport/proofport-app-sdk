/**
 * Public inputs for the signer-root circuits, shaped as each circuit emits
 * them: the right count, one byte per field, the signer root at its offset.
 * Everything else is zero, except a Coinbase KYC or Country proof's
 * attested_at (now) and a Country proof's list (one entry, inclusion).
 */
import { SIGNER_ROOT_LAYOUTS, COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT } from '../../verifier';

export type RootCircuit = keyof typeof SIGNER_ROOT_LAYOUTS;

const field = (v: number | bigint) => '0x' + BigInt(v).toString(16).padStart(64, '0');

export function attestationInputs(circuit: RootCircuit, root: string = SIGNER_ROOT_LAYOUTS[circuit].set.root): string[] {
  const layout = SIGNER_ROOT_LAYOUTS[circuit];
  const inputs = Array.from({ length: layout.publicInputCount }, () => field(0));
  const bytes = root.slice(2).match(/../g)!;
  bytes.forEach((b, i) => (inputs[layout.rootStart + i] = field(parseInt(b, 16))));
  // Coinbase KYC v2 ends with attested_at, held to the verifier's clock.
  const now = field(Math.floor(Date.now() / 1000));
  if (circuit === 'coinbase_attestation') inputs[COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT] = now;
  if (circuit === 'coinbase_country_attestation') {
    const L = COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT;
    inputs[L.COUNTRY_LIST_START] = field(0x4b); // 'K'
    inputs[L.COUNTRY_LIST_START + 1] = field(0x52); // 'R'
    inputs[L.COUNTRY_LIST_LENGTH] = field(1);
    inputs[L.IS_INCLUDED] = field(1);
    inputs[L.ATTESTED_AT] = now;
  }
  return inputs;
}
