import { defineConfig } from 'vitest/config';

/**
 * Checks that need the network, kept out of the normal run.
 *
 * The main config includes only `*.test.ts`, so these `*.live.ts` files are
 * invisible to `npm test` and to CI. That is deliberate: they ask GitHub for
 * real verification keys, and a suite that reddens when a raw-content host has
 * a bad morning teaches people to ignore red.
 *
 * Run them with `npm run test:vk-live` after touching anything that names a
 * path or URL — those are the values no unit test can check, because their only
 * meaning is what the other end answers.
 */
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.live.ts'],
    testTimeout: 30_000,
  },
});
