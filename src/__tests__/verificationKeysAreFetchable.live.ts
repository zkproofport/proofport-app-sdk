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
import { ALL_CIRCUIT_IDS, CIRCUIT_VK_PATHS } from '../circuits';

const BASE = 'https://raw.githubusercontent.com/zkproofport/circuits/main';

describe.each(ALL_CIRCUIT_IDS)('verification key for %s', (circuit) => {
  it('is fetchable and looks like a key', async () => {
    const url = `${BASE}/${CIRCUIT_VK_PATHS[circuit]}`;
    const resp = await fetch(url);
    expect(resp.status, `GET ${url}`).toBe(200);

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // The pinned bb writes 1816 bytes. Bounded rather than exact so a circuit
    // with a different shape does not fail for the wrong reason — but tight
    // enough that a directory listing or an HTML error page cannot pass.
    expect(bytes.length).toBeGreaterThan(512);
    expect(bytes.length).toBeLessThan(8192);

    // An HTML response starts with '<'. A key does not.
    expect(bytes[0]).not.toBe('<'.charCodeAt(0));
  }, 30_000);
});
