/**
 * Public inputs for the signer-root circuits, shaped as each circuit emits
 * them: the right count, one byte per field, the signer root at its offset.
 * Everything else is zero, except a Coinbase KYC or Country proof's
 * attested_at (now), a Country proof's list (one entry, inclusion),
 * signal_hash, which is the one TEST_REQUEST's (no action bound), and the
 * OPRF four: the key hash pinned for OPRF_TEST_ENVIRONMENT (whatever that
 * table holds when the test runs), TEST_REQUEST's domain and scope reduced
 * mod p, and a nullifier.
 */
import {
  SIGNER_ROOT_LAYOUTS,
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OPRF_PUBLIC_INPUT_LAYOUTS,
  computeSignalHash,
  getPinnedOprfKeyHash,
  reduceOprfName,
} from '../../verifier';
import { OPRF_TEST_ENVIRONMENT } from './oprfKeys';

export { OPRF_TEST_ENVIRONMENT } from './oprfKeys';

/** The request these inputs answer; pass it as `request` to a response-based verify. */
export const TEST_REQUEST = Object.freeze({ scope: 'myapp.com', requestId: 'r1', oprfDomain: 'zkproofport.app' });

/** A nullifier the synthetic inputs carry (any field element; nothing recomputes it). */
export const TEST_NULLIFIER = '0x' + '0'.repeat(62) + '2a';

/**
 * Write the OPRF four into `inputs` for `circuit`, as an honest prover for
 * TEST_REQUEST under the test environment's pinned key would.
 */
export function fillOprf(inputs: string[], circuit: keyof typeof OPRF_PUBLIC_INPUT_LAYOUTS, request: { scope: string; oprfDomain: string } = TEST_REQUEST): string[] {
  const layout = OPRF_PUBLIC_INPUT_LAYOUTS[circuit];
  if (layout === null) throw new Error(`${circuit} has no OPRF nullifier`);
  inputs[layout.keyHash] = getPinnedOprfKeyHash(OPRF_TEST_ENVIRONMENT, circuit);
  inputs[layout.domain] = reduceOprfName(request.oprfDomain);
  inputs[layout.scope] = reduceOprfName(request.scope);
  inputs[layout.nullifier] = TEST_NULLIFIER;
  return inputs;
}

export type RootCircuit = keyof typeof SIGNER_ROOT_LAYOUTS;

const field = (v: number | bigint) => '0x' + BigInt(v).toString(16).padStart(64, '0');

export function attestationInputs(circuit: RootCircuit, root: string = SIGNER_ROOT_LAYOUTS[circuit].set.root): string[] {
  const layout = SIGNER_ROOT_LAYOUTS[circuit];
  const inputs = Array.from({ length: layout.publicInputCount }, () => field(0));
  const bytes = root.slice(2).match(/../g)!;
  bytes.forEach((b, i) => (inputs[layout.rootStart + i] = field(parseInt(b, 16))));
  const signal = computeSignalHash({ ...TEST_REQUEST, circuitId: circuit }).slice(2).match(/../g)!;
  signal.forEach((b, i) => (inputs[i] = field(parseInt(b, 16))));
  fillOprf(inputs, circuit);
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
