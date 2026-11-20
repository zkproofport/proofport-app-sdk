/**
 * Every verification key path answers with a real key. Opt-in:
 * `npm run test:vk-live`.
 *
 * WHY THIS IS A LIVE CHECK AND NOT A MOCK. The paths in CIRCUIT_VK_PATHS are
 * strings whose only meaning is what GitHub returns for them, and getting one
 * wrong does not fail loudly anywhere in this repository — it fails in a
 * browser, at the moment somebody presses Verify, as an HTTP 404.
 *
 * That is exactly what happened on 2026-09-04. The paths were copied from the
 * mobile app, which stores the DIRECTORY (`…/target/vk`) and the FILENAME
 * (`vk`) as two fields and joins them. Only the directory was copied, so every
 * path pointed one level short. Unit tests could not see it: the strings were
 * consistent with each other, exhaustive over the circuit list, and wrong.
 *
 * A key is a small binary blob, so this also checks the SHAPE — a 404 page and
 * an HTML redirect both arrive as a successful response full of text.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { ALL_CIRCUIT_IDS, signerVariantsOf } from '../circuits';
import { getVerificationKeyRecord, VERIFICATION_KEYS_REF } from '@zkproofport-app/core';

// The off-chain verifier fetches each key at the circuits commit core's
// generated table names, and refuses one whose sha256 differs. Until
// 2026-11-17 it read `main`; this check followed.
const BASE = `https://raw.githubusercontent.com/zkproofport/circuits/${VERIFICATION_KEYS_REF}`;
const packages = ALL_CIRCUIT_IDS.flatMap(circuit => signerVariantsOf(circuit).map(variant => [circuit, variant] as const));

describe.each(packages)('verification key for %s %s', (circuit, variant) => {
  it('is fetchable at the pinned commit and is the pinned key', async () => {
    // Null means the table was generated from an uncommitted circuits working
    // tree: there is nothing published to check. That is a failure here, not
    // a skip -- the SDK cannot verify off-chain without a caller's key then.
    expect(VERIFICATION_KEYS_REF, 'the keys are not published at any circuits commit; regenerate from the committed circuits').not.toBeNull();
    const record = getVerificationKeyRecord(circuit, variant);
    const url = `${BASE}/${record.path}`;
    const resp = await fetch(url);
    expect(resp.status, `GET ${url}`).toBe(200);

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // An HTML response starts with '<'. A key does not.
    expect(bytes[0]).not.toBe('<'.charCodeAt(0));
    expect(createHash('sha256').update(bytes).digest('hex'), url).toBe(record.sha256);
  }, 30_000);
});
