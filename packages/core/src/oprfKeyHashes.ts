/**
 * The OPRF key hash a verifier accepts, per environment and proof type. ONE
 * table, and the only place a key hash is written (the lookup is ./oprfKeys;
 * the data sits apart so a test can replace it without replacing the lookup).
 *
 * Why it is pinned: a circuit accepts an OPRF answer from ANY key that is
 * consistent with itself (circuits/oprf-nullifier-libs/README.md, "What a
 * verifier checks"). A proof under another key hash proves nothing about the
 * nullifier -- whoever holds that key can compute every address's nullifier
 * under it. So every verify path compares the proof's `oprf_key_hash` with
 * the row below, and a lookup that finds no row is an error naming what was
 * asked, never another environment's or another circuit's key.
 *
 * Rows:
 * - staging and local: TACEO's PUBLIC TEST NETWORK key (`basic` module, the
 *   only module open to an API key; node{0,1,2}.eu.test.oprf.taceo.network,
 *   threshold 2). Public key, as the nodes return it with every answer:
 *     x 0x162fc76f99b6baa49ae260bbfac6c3a5657738bdd46f387dfa820beee7ab789e
 *     y 0x0f3d63eee4a861343e2397cfe40f21dbd95a4c780bc538c82ececa1e1549558e
 *   recorded 2026-11-17 (circuits-dev.md, "Re-checked 2026-11-17") and again
 *   2026-11-18 by proofport-oprf's taceo_testnet client for a random address
 *   (src/__tests__/fixtures/oprf-vectors.json `network`, whose DLog proof and
 *   nullifier core's own client verifies). The hash below is
 *   Poseidon2_t3(DS_key, x, y)[1]; a test recomputes it from the key. The test
 *   network has one key for every module and request, so every circuit shares
 *   it here; a production network should give each proof type its own key.
 * - production: no row. TACEO's production network has issued no key for
 *   this integration yet. Until it does, every wallet credential proof
 *   verified for production is refused, by name.
 *
 * Changing a row changes every nullifier under it: the same wallet gets a new
 * nullifier, so a dApp's "already used" list stops matching. Never "rotate"
 * a row; TACEO reshares without changing the key.
 */
import type { OprfCircuitId } from './oprfLayouts';

/** Where a proof is verified for. Same names as the SDK's environments. */
export type OprfEnvironment = 'production' | 'staging' | 'local';

export const OPRF_ENVIRONMENTS: readonly OprfEnvironment[] = Object.freeze(['production', 'staging', 'local'] as const);

/** Poseidon2_t3(DS_key, D.x, D.y)[1] of TACEO's public test network key (above). */
export const TACEO_TESTNET_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1';

/** That key itself, for a client that wants to compare the point before hashing it. */
export const TACEO_TESTNET_OPRF_PUBLIC_KEY = Object.freeze({
  x: '0x162fc76f99b6baa49ae260bbfac6c3a5657738bdd46f387dfa820beee7ab789e',
  y: '0x0f3d63eee4a861343e2397cfe40f21dbd95a4c780bc538c82ececa1e1549558e',
});

const testnet = (): Readonly<Record<OprfCircuitId, string>> =>
  Object.freeze({
    coinbase_attestation: TACEO_TESTNET_OPRF_KEY_HASH,
    coinbase_country_attestation: TACEO_TESTNET_OPRF_KEY_HASH,
    giwa_attestation: TACEO_TESTNET_OPRF_KEY_HASH,
    dojang_playground: TACEO_TESTNET_OPRF_KEY_HASH,
    human_passport_score: TACEO_TESTNET_OPRF_KEY_HASH,
  } satisfies Record<OprfCircuitId, string>);

/**
 * environment -> proof type -> the key hash its proofs must carry. `null`: no
 * key exists for that environment, so nothing verifies there.
 */
export const OPRF_KEY_HASHES: Readonly<Record<OprfEnvironment, Readonly<Record<OprfCircuitId, string>> | null>> = Object.freeze({
  production: null,
  staging: testnet(),
  local: testnet(),
});

