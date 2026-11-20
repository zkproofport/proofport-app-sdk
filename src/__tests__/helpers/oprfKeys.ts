/**
 * The OPRF key hashes the circuits' FIXTURE proofs carry, standing in for the
 * staging row of core's OPRF_KEY_HASHES.
 *
 * WHY. Every real proof committed under fixtures/ was made by the circuits'
 * acceptance runs, whose OPRF answers come from a local TEST key per circuit
 * id (circuits/scripts/oprf-nullifier/oprf.js `fixtureKey`, derived from a
 * public string). Their `oprf_key_hash` is therefore not TACEO's test network
 * key, which is what staging pins. A test that verifies one of those proofs
 * end to end is about the verifier's wiring (bb.js, the key table, the issuer
 * checks), so it runs against this table. The hashes are not typed in here:
 * they are the `circuits fixture key for <id>` rows of oprf-vectors.json,
 * which TACEO's crates computed.
 *
 * Tests that assert what staging and production really pin read the real
 * table (oprfNullifierIsJudged.test.ts) and never use this.
 *
 * Use:
 *
 *   vi.mock('../../packages/core/src/oprfKeyHashes', async importOriginal => {
 *     const { withFixtureOprfKeys } = await import('./helpers/oprfKeys');
 *     return withFixtureOprfKeys(await importOriginal());
 *   });
 */
import vectors from '../fixtures/oprf-vectors.json';
import type * as KeyHashes from '../../../packages/core/src/oprfKeyHashes';

/** The environment the tests verify for. */
export const OPRF_TEST_ENVIRONMENT = 'staging';

const fixtureRow = (circuit: string): string => {
  const e = vectors.evaluations.find(v => v.note === `circuits fixture key for ${circuit} (oprf.js fixtureKey)`);
  if (!e) throw new Error(`oprf-vectors.json has no fixture key row for ${circuit}`);
  return e.keyHash;
};

export const FIXTURE_OPRF_KEY_HASHES = Object.freeze({
  coinbase_attestation: fixtureRow('coinbase_attestation'),
  coinbase_country_attestation: fixtureRow('coinbase_country_attestation'),
  giwa_attestation: fixtureRow('giwa_attestation'),
  dojang_playground: fixtureRow('dojang_playground'),
  human_passport_score: fixtureRow('human_passport_score'),
});

export function withFixtureOprfKeys(actual: typeof KeyHashes): typeof KeyHashes {
  return {
    ...actual,
    OPRF_KEY_HASHES: Object.freeze({ ...actual.OPRF_KEY_HASHES, staging: FIXTURE_OPRF_KEY_HASHES }),
  };
}
