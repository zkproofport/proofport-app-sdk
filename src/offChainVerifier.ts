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
 * HOW IT WORKS. Proofs here are made for the EVM target (`bb prove -t evm`:
 * keccak transcript, ZK on), so the matching check is bb.js's
 * `UltraHonkVerifierBackend.verifyProof(..., { verifierTarget: 'evm' })`. Two
 * things have to line up:
 *
 *   The version. bb.js must be the build of the same bb the circuits are
 *   compiled with -- `BB_VERSION` in circuits/toolchain.env, which the
 *   generator records as core's VERIFICATION_KEY_BB_VERSION. Since the Noir
 *   1.0.0 toolchain that is bb 6.0.0, published as `@aztec-foundation/bb.js`
 *   (bb 4.x was `@aztec/bb.js`). Versions are not interchangeable: bb.js 6.0.0
 *   answers false for a bb 4.2 proof checked against its own bb 4.2 key
 *   (measured 2026-11-17), and on one of our circuits the 2025 nightly wrote a
 *   16256-byte proof where bb 1.2.0 wrote 16224 for the identical circuit and
 *   witness, with the SAME verification key, so the key cannot warn you. A
 *   mismatch shows up only as verification failing -- so the SDK compares the
 *   versions itself and says so (BB_JS_VERSION below).
 *
 *   The target. Verifying an EVM proof as any other target is not a polite
 *   false. With the 2025 nightly, keccak-without-ZK trapped the WebAssembly
 *   with a bare "unreachable" and the poseidon flavour answered false for a
 *   good proof.
 *
 * THE PROOF ARRIVES IN TWO PIECES. The mobile app splits what Barretenberg
 * produced into `proof` and `publicInputs` before sending it, because the
 * Solidity verifier takes them separately. bb.js 6's verifier takes the same
 * two pieces, so nothing is joined back here.
 */
import { ALL_CIRCUIT_IDS, getCircuitPackage, isCircuitId, resolveSignerVariant, type CircuitId, type SignerVariant } from './circuits';
import {
  checkProofIssuer,
  getAcceptedLegacyVerifiers,
  getVerificationKeyRecord,
  VERIFICATION_KEYS_REF,
  VERIFICATION_KEY_BB_VERSION,
  type CountryCondition,
  type ProofRequestContext,
} from '@zkproofport-app/core';

/**
 * The bb this SDK's off-chain verifier is: the exact `@aztec-foundation/bb.js`
 * version in package.json (a test holds the two equal, and this equal to
 * core's VERIFICATION_KEY_BB_VERSION). A key written by another bb is refused
 * by name rather than handed to a verifier that would answer false.
 */
export const BB_JS_VERSION = '6.0.0';

/**
 * Where verification keys are published.
 *
 * Not configurable, deliberately: a caller who could point this somewhere else
 * could point it at a key of their choosing, and "the proof verified" would
 * then mean nothing. Same repository the mobile app downloads circuit data
 * from.
 */
const CIRCUITS_VK_BASE = 'https://raw.githubusercontent.com/zkproofport/circuits';

/*
 * The CURRENT verification key is read at the circuits commit core's generated
 * table names (VERIFICATION_KEYS_REF) and must match the sha256 recorded there.
 * Until 2026-11-17 it was read at `main`: every installed SDK then verified
 * against whatever main held, so the day main moved to keys from a new bb,
 * every SDK already installed would have started refusing every proof -- and
 * an SDK released before the circuits merged would refuse every proof until
 * they did. A superseded key still accepted during a transition is read at its
 * own pinned commit (`vkRef` in core's ACCEPTED_LEGACY_VERIFIERS).
 */

/** How long a fetched verification key is reused. Keys change only on a recompile. */
const VK_CACHE_TTL_MS = 60 * 60 * 1000;

const vkCache = new Map<string, { vk: Uint8Array; at: number }>();

export interface OffChainVerifyResult {
  valid: boolean;
  error?: string;
  /**
   * Which key accepted: the circuit's current one, a superseded one still
   * accepted during a transition (with the circuits commit it was read at), or
   * the one the caller passed.
   */
  verifiedBy?: { label: 'current' | 'legacy' | 'provided'; vkRef?: string };
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
  /**
   * The request the proof answers. For `oidc_domain_attestation`, a proof made
   * with a request-bound nonce (the app path) must be bound to exactly this
   * scope and requestId (core's `checkOidcPolicy`); for every circuit with a
   * signal_hash, a proof without an action must carry the signal_hash of
   * exactly this request (core's `checkSignalHash`).
   */
  request?: ProofRequestContext;
  /**
   * Which environment's OPRF key a wallet credential proof must carry the
   * hash of ('production', 'staging', 'local'; core's OPRF_KEY_HASHES).
   * Required for every circuit with an OPRF nullifier.
   */
  oprfEnvironment?: string;
  /**
   * Which of the circuit's packages made the proof, as its result says. Omitted
   * means `standard`; a proof with another package's length is then refused.
   * Selects whose verification key is fetched (ignored when `verificationKey`
   * is given).
   */
  signerVariant?: string;
  /**
   * For `coinbase_country_attestation`: the country list and direction the
   * request asked for. The proof's list is a public input the prover chose, so
   * a proof is refused unless it was made against exactly this condition. See
   * core's `checkCountryListMatches`.
   */
  countryCondition?: CountryCondition;
  /**
   * For `human_passport_score`: the score threshold the request asked for, in
   * Passport points (20 = 20.0). The proof's min_score is the prover's choice,
   * so it must equal this. See core's `checkHumanPassportProof`.
   */
  minScore?: number;
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
 * @internal Public inputs as 32-byte big-endian field elements in hex, the
 * shape bb.js's verifier takes.
 *
 * The relay carries them as hex strings that are USUALLY already 32 bytes, but
 * a value that happens to have leading zeros can arrive short (`0x01`). Left-
 * padding here rather than trusting the sender is the difference between a
 * verification that works and one that fails on roughly one proof in a hundred,
 * for no reason the caller can see.
 */
function normalisePublicInputs(publicInputs: string[]): string[] {
  return publicInputs.map((input, i) => {
    const bytes = hexToBytes(input);
    if (bytes.length > 32) {
      throw new Error(
        `Public input ${i} is ${bytes.length} bytes; a field element is at most 32`
      );
    }
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.length);
    return '0x' + Array.from(padded, b => b.toString(16).padStart(2, '0')).join('');
  });
}

/**
 * Fetch a circuit's verification key, with a small cache.
 *
 * @internal
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) {
    throw new Error('This runtime has no Web Crypto (globalThis.crypto.subtle), which checking the verification key needs.');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchVerificationKey(
  circuit: CircuitId,
  variant: SignerVariant,
  ref: string,
  timeoutMs: number,
  expectedSha256?: string
): Promise<Uint8Array> {
  const cacheKey = `${circuit}/${variant}@${ref}`;
  const cached = vkCache.get(cacheKey);
  if (cached && Date.now() - cached.at < VK_CACHE_TTL_MS) return cached.vk;

  const vkPath = getCircuitPackage(circuit, variant).vkPath;

  const url = `${CIRCUITS_VK_BASE}/${ref}/${vkPath}`;
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
    if (expectedSha256) {
      const actual = await sha256Hex(vk);
      if (actual !== expectedSha256) {
        throw new Error(
          `The verification key at ${url} has sha256 ${actual}; this SDK pins ${expectedSha256} for ${circuit} '${variant}'. ` +
            `It is not the key this SDK verifies against.`
        );
      }
    }
    vkCache.set(cacheKey, { vk, at: Date.now() });
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
 * For `oidc_domain_attestation` it first checks the token's audience, nonce and
 * time (core's `checkOidcPolicy`, against `options.request` when given) and the
 * proof's RSA key against the provider's published JWKS (core's
 * `checkOidcProviderKey`); any refusal, or a JWKS that cannot be fetched, is
 * `{ valid: false }`.
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

  if (!isCircuitId(circuit)) {
    return { valid: false, error: `Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.` };
  }

  const signer = resolveSignerVariant(circuit, options.signerVariant, proof);
  if ('error' in signer) {
    return { valid: false, error: signer.error };
  }

  // Before Barretenberg, and for the same reason as on-chain: a proof can be
  // mathematically valid and still mean nothing, because some circuits take
  // their trust anchor as a public input the prover chooses. For OIDC that is
  // the RSA key -- see core's oidcProviderKeys. Checked here so a dApp that
  // verifies off-chain gets the same answer as one that verifies on-chain.
  const issuer = await checkProofIssuer(circuit, publicInputs, {
    request: options.request,
    countryCondition: options.countryCondition,
    minScore: options.minScore,
    oprfEnvironment: options.oprfEnvironment,
  });
  if (!issuer.ok) {
    return { valid: false, error: issuer.error };
  }

  // The proof itself first: an empty or malformed one is reported as such,
  // whatever the keys.
  let proofBytes: Uint8Array;
  let fields: string[];
  try {
    proofBytes = hexToBytes(proof);
    if (proofBytes.length === 0) {
      return { valid: false, error: 'Proof is empty' };
    }
    // Normalised to 32-byte big-endian fields before handing them over: the
    // relay can deliver a short value (`0x01`), and the check below must see
    // exactly what the circuit committed to.
    fields = normalisePublicInputs(publicInputs);
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }

  // Which keys to try: the caller's, alone; otherwise the current key, then
  // each superseded key still within its transition window. A proof carries
  // no marker of the circuit build that made it, so the pinned keys are tried
  // in order; every one is a key this SDK names, never one the sender chose.
  //
  // A key this bb.js cannot check is not tried: it is reported, by name,
  // among the failures. That is the current key when core's table was
  // generated from keys of another bb (a release mistake a test catches),
  // the current key when it was generated from an uncommitted working tree
  // (no commit to fetch it at), and a legacy key written by an older bb --
  // the off-chain half of a transition across a toolchain upgrade, which this
  // SDK does not carry a second bb.js for. Such a proof can still be checked
  // on-chain, against its legacy verifier.
  // Decided before Barretenberg is loaded, so a refusal costs nothing.
  const failures: string[] = [];
  type Key = { label: 'current' | 'legacy' | 'provided'; ref?: string; sha256?: string };
  const keys: Key[] = [];
  try {
    if (options.verificationKey) {
      keys.push({ label: 'provided' });
    } else {
      const current = getVerificationKeyRecord(circuit, signer.variant);
      if (VERIFICATION_KEY_BB_VERSION !== BB_JS_VERSION) {
        failures.push(`current: the ${circuit} key was written by bb ${VERIFICATION_KEY_BB_VERSION}; this SDK verifies with bb.js ${BB_JS_VERSION}`);
      } else if (VERIFICATION_KEYS_REF === null) {
        failures.push(
          `current: the ${circuit} '${signer.variant}' key (sha256 ${current.sha256}) is not published at any circuits commit yet; ` +
            `pass it as options.verificationKey`
        );
      } else {
        keys.push({ label: 'current', ref: VERIFICATION_KEYS_REF, sha256: current.sha256 });
      }
      const seen = new Set<string>();
      for (const legacy of getAcceptedLegacyVerifiers(circuit, signer.variant, new Date(), 'any')) {
        if (seen.has(legacy.vkRef)) continue;
        seen.add(legacy.vkRef);
        if (legacy.bbVersion !== BB_JS_VERSION) {
          failures.push(
            `legacy @${legacy.vkRef}: its key was written by bb ${legacy.bbVersion}; this SDK verifies off-chain with bb.js ${BB_JS_VERSION} only. ` +
              `Verify this proof on-chain`
          );
          continue;
        }
        keys.push({ label: 'legacy', ref: legacy.vkRef });
      }
    }
    if (keys.length === 0) return { valid: false, error: failures.join('; ') };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }

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

  let bb: typeof import('@aztec-foundation/bb.js');
  try {
    bb = await import('@aztec-foundation/bb.js');
  } catch (error) {
    // Reaching here means the install is broken, not that something is missing
    // by design. Say so, rather than sending the caller off to install a
    // package they should never have had to hear about.
    return {
      valid: false,
      error:
        'Could not load the proof verifier (@aztec-foundation/bb.js), which ships with this ' +
        'SDK. This usually means a broken or partial install — try reinstalling ' +
        `@zkproofport-app/sdk. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let api: { destroy(): Promise<void> } | undefined;
  try {

    const barretenberg = await bb.Barretenberg.new({ threads: 1 });
    api = barretenberg;
    const verifier = new bb.UltraHonkVerifierBackend(barretenberg);
    for (const key of keys) {
      try {
        const vk =
          key.label === 'provided'
            ? (options.verificationKey as Uint8Array)
            : await fetchVerificationKey(circuit, signer.variant, key.ref as string, timeoutMs, key.sha256);
        const valid = await verifier.verifyProof(
          { proof: proofBytes, publicInputs: fields, verificationKey: vk },
          { verifierTarget: 'evm' }
        );
        if (valid) {
          return { valid: true, verifiedBy: key.label === 'legacy' ? { label: 'legacy', vkRef: key.ref } : { label: key.label } };
        }
      } catch (error) {
        failures.push(`${key.label}${key.ref ? ` @${key.ref}` : ''}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) return { valid: false, error: failures.join('; ') };
    return { valid: false };
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
