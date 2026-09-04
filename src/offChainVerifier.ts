/**
 * Off-chain proof verification — checking a proof against its verification key,
 * with no chain, no RPC, and no gas.
 *
 * WHY THIS EXISTS. The SDK had only `verifyProofOnChain`, and every caller that
 * wanted an off-chain check called that instead and relabelled the result. The
 * demo page did exactly this from its first commit: pressing "Off-Chain Verify"
 * ran an on-chain verification and printed "Off-Chain Verification Passed!".
 * The answer was true and the label was a lie, which is the worst combination —
 * nothing looked broken. The mobile app has always verified off-chain properly
 * (through mopro's native Barretenberg); it was only the JavaScript side that
 * had no such thing.
 *
 * HOW IT WORKS. Proofs here are made with `--oracle_hash keccak` and ZK on, so
 * the matching check is `acirVerifyUltraKeccakZkHonk(proof, vk)`. Two things
 * have to line up:
 *
 *   The version. `@aztec/bb.js@1.0.0-nightly.20250723` is the WASM build of the
 *   same bb the circuits are compiled with. Versions are not interchangeable:
 *   measured on the Korea Mobile ID age circuit, the pinned bb writes a 16256-
 *   byte proof where bb 1.2.0 writes 16224 for the identical circuit and
 *   witness — and the verification key comes out the SAME either way, so the
 *   key cannot warn you. A mismatch shows up only as verification failing.
 *
 *   The flavour. There are four verify entry points and picking the wrong one
 *   is not a polite false. `acirVerifyUltraZKHonk` (poseidon) answers false for
 *   a perfectly good proof, and `acirVerifyUltraKeccakHonk` — keccak without ZK
 *   — TRAPS the WebAssembly with a bare "unreachable", which looks exactly like
 *   a corrupt proof, a mismatched key, or a missing SRS.
 *
 * THE PROOF ARRIVES IN TWO PIECES. The mobile app splits what Barretenberg
 * produced into `proof` and `publicInputs` before sending it, because the
 * Solidity verifier takes them separately. Verifying needs them joined back, in
 * that order, which is what `reconstructHonkProof` does.
 */
import { CIRCUIT_VK_PATHS, type CircuitId } from './circuits';

/**
 * Where verification keys are published.
 *
 * Not configurable, deliberately: a caller who could point this somewhere else
 * could point it at a key of their choosing, and "the proof verified" would
 * then mean nothing. Same repository the mobile app downloads circuit data
 * from.
 */
const CIRCUITS_VK_BASE =
  'https://raw.githubusercontent.com/zkproofport/circuits/main';

/** How long a fetched verification key is reused. Keys change only on a recompile. */
const VK_CACHE_TTL_MS = 60 * 60 * 1000;

const vkCache = new Map<string, { vk: Uint8Array; at: number }>();

export interface OffChainVerifyResult {
  valid: boolean;
  error?: string;
}

export interface OffChainVerifyOptions {
  /**
   * Verification key bytes, if the caller already has them. Skips the fetch —
   * useful offline, in tests, and for anyone who would rather pin the key they
   * checked than trust a download.
   */
  verificationKey?: Uint8Array;
  /** Milliseconds before the fetch is abandoned. Default 30000. */
  timeoutMs?: number;
}

/**
 * Make sure a Node-shaped `Buffer` exists before Barretenberg is loaded.
 *
 * WHY THE SDK DOES THIS RATHER THAN THE CALLER. bb.js's own BROWSER build —
 * not just its node build — converts field elements through `Buffer.alloc` and
 * `buf.writeBigUInt64BE`. Browsers have no Buffer, and bundlers stopped
 * polyfilling Node globals years ago, so in a browser the first verification
 * dies with "r.writeBigUInt64BE is not a function" — a message that names
 * nothing a caller could act on. Measured on the demo page, 2026-09-04, against
 * a real GIWA proof.
 *
 * Leaving it to callers would mean every browser customer editing their
 * bundler config to make an SDK method work, which is the configuration this
 * SDK promises not to require.
 *
 * Deliberately narrow:
 *  - It only fills a GAP. A real Buffer (Node, or a page that already has one)
 *    is left alone, so nothing is shadowed by a lesser implementation.
 *  - It checks for the METHOD, not just the global. A partial Buffer — which is
 *    what several bundlers leave behind, and what the demo page actually had —
 *    passes a `typeof Buffer` test and then fails inside Barretenberg.
 */
async function ensureBufferForBarretenberg(): Promise<void> {
  const existing = (globalThis as { Buffer?: { alloc?: (n: number) => unknown } }).Buffer;
  if (existing?.alloc) {
    const probe = existing.alloc(8) as { writeBigUInt64BE?: unknown };
    if (typeof probe.writeBigUInt64BE === 'function') return;
  }
  const { Buffer } = await import('buffer/');
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

/** @internal Hex string (with or without 0x) to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0) {
    throw new Error(`Hex string has an odd length (${clean.length}); it cannot be bytes`);
  }
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Hex string contains non-hex characters');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * @internal Public inputs as the flat byte run Barretenberg expects: each one a
 * 32-byte big-endian field element, concatenated in order.
 *
 * The relay carries them as hex strings that are USUALLY already 32 bytes, but
 * a value that happens to have leading zeros can arrive short (`0x01`). Left-
 * padding here rather than trusting the sender is the difference between a
 * verification that works and one that fails on roughly one proof in a hundred,
 * for no reason the caller can see.
 */
function packPublicInputs(publicInputs: string[]): Uint8Array {
  const out = new Uint8Array(publicInputs.length * 32);
  publicInputs.forEach((input, i) => {
    const bytes = hexToBytes(input);
    if (bytes.length > 32) {
      throw new Error(
        `Public input ${i} is ${bytes.length} bytes; a field element is at most 32`
      );
    }
    out.set(bytes, i * 32 + (32 - bytes.length));
  });
  return out;
}

/**
 * Fetch a circuit's verification key, with a small cache.
 *
 * @internal
 */
async function fetchVerificationKey(
  circuit: CircuitId,
  timeoutMs: number
): Promise<Uint8Array> {
  const cached = vkCache.get(circuit);
  if (cached && Date.now() - cached.at < VK_CACHE_TTL_MS) return cached.vk;

  const vkPath = CIRCUIT_VK_PATHS[circuit];
  if (!vkPath) {
    throw new Error(
      `No verification key path for circuit '${circuit}'. ` +
        `Add it to CIRCUIT_VK_PATHS, or pass verificationKey directly.`
    );
  }

  const url = `${CIRCUITS_VK_BASE}/${vkPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Could not fetch the verification key (HTTP ${resp.status}) from ${url}`);
    }
    const vk = new Uint8Array(await resp.arrayBuffer());
    // A 404 page or an HTML redirect arrives as a successful response full of
    // text, and would reach Barretenberg as a "verification key" that fails for
    // reasons no one could guess from the message.
    if (vk.length < 512) {
      throw new Error(
        `The verification key at ${url} is ${vk.length} bytes, far too small to be one. ` +
          `The path is probably wrong and something else was served.`
      );
    }
    vkCache.set(circuit, { vk, at: Date.now() });
    return vk;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a proof off-chain, against its verification key.
 *
 * Needs no setup from the caller: the verifier ships with this SDK and is
 * loaded on first use.
 *
 * @param circuit - Canonical circuit identifier
 * @param proof - Proof bytes as hex, WITHOUT public inputs (as the relay sends it)
 * @param publicInputs - Public inputs as hex strings, in circuit order
 * @param options - Optional verification key and timeout
 * @returns `{ valid }`, or `{ valid: false, error }` when the check could not run
 *
 * @example
 * ```typescript
 * const result = await verifyProofOffChain(
 *   'coinbase_attestation',
 *   response.proof,
 *   response.publicInputs
 * );
 * if (result.valid) console.log('Proof is valid, no chain involved');
 * ```
 */
export async function verifyProofOffChain(
  circuit: CircuitId,
  proof: string,
  publicInputs: string[],
  options: OffChainVerifyOptions = {}
): Promise<OffChainVerifyResult> {
  const timeoutMs = options.timeoutMs ?? 30000;

  // A REQUIRED dependency, loaded lazily.
  //
  // It was briefly an optional peer dependency, on the reasoning that the WASM
  // is 16MB and most callers verify on-chain. That was wrong: it would have
  // meant a customer calling this method got an error telling them to install
  // something, and "works with zero customer configuration" is the SDK's rule.
  // A caller should never have to know this is implemented with Barretenberg.
  //
  // The dynamic import is what keeps the cost off everyone else — a bundler
  // splits it out, and a caller who never verifies off-chain never loads it.
  // Before bb.js, not after: its module-level code already reaches for Buffer.
  await ensureBufferForBarretenberg();

  let bb: typeof import('@aztec/bb.js');
  try {
    bb = await import('@aztec/bb.js');
  } catch (error) {
    // Reaching here means the install is broken, not that something is missing
    // by design. Say so, rather than sending the caller off to install a
    // package they should never have had to hear about.
    return {
      valid: false,
      error:
        'Could not load the proof verifier (@aztec/bb.js), which ships with this ' +
        'SDK. This usually means a broken or partial install — try reinstalling ' +
        `@zkproofport-app/sdk. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let api:
    | {
        initSRSForCircuitSize(size: number): Promise<void>;
        acirVerifyUltraKeccakZkHonk(p: Uint8Array, v: unknown): Promise<boolean>;
        destroy(): Promise<void>;
      }
    | undefined;
  try {
    const proofBytes = hexToBytes(proof);
    if (proofBytes.length === 0) {
      return { valid: false, error: 'Proof is empty' };
    }
    const publicInputBytes = packPublicInputs(publicInputs);

    const vk =
      options.verificationKey ?? (await fetchVerificationKey(circuit, timeoutMs));

    // Public inputs first, then the proof — the order Barretenberg wrote them in
    // before the mobile app split them apart for the Solidity verifier.
    const full = bb.reconstructHonkProof(publicInputBytes, proofBytes);

    api = (await bb.Barretenberg.new({ threads: 1 })) as unknown as typeof api;

    // THE VERIFY MUST MATCH HOW THE PROOF WAS MADE, AND THERE ARE FOUR OF THEM.
    //
    // `scripts/build.sh` in the circuits repo proves with `--oracle_hash keccak`
    // and ZK on — so the only entry point that answers correctly is the one that
    // is BOTH. Measured against a real proof of the Korea Mobile ID age circuit,
    // freshly generated against its own key:
    //
    //   acirVerifyUltraKeccakZkHonk    true     ← the right one
    //   acirVerifyUltraKeccakHonk      TRAPS with a bare "unreachable"
    //   acirVerifyUltraZKHonk          false    (poseidon: wrong oracle hash)
    //
    // The middle row is why this took a while: picking keccak-without-ZK does
    // not return false, it kills the WebAssembly instance with a message that
    // names nothing. It looks identical to a malformed proof, to a mismatched
    // key, and to a missing SRS.
    //
    // Two more things that produce that same trap, both required:
    //   initSRSForCircuitSize must be called before the first verify.
    //   The key must be a RawBuffer — a plain Uint8Array is marshalled as a
    //   length-prefixed vector, so its length is read as key material.
    // Both are what bb.js's own BarretenbergVerifier does before verifying.
    await api!.initSRSForCircuitSize(0);
    const valid = await api!.acirVerifyUltraKeccakZkHonk(full, new bb.RawBuffer(vk));
    return { valid };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // The WASM instance holds worker threads; leaving them running keeps a Node
    // process alive after the check is done.
    if (api) {
      try {
        await api.destroy();
      } catch {
        /* nothing useful to do if teardown fails */
      }
    }
  }
}

/** @internal Test seam — lets a test start from a known-empty cache. */
export function clearVerificationKeyCache(): void {
  vkCache.clear();
}
