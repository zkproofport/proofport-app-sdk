import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Core from source, as in vitest.config.ts.
const core = (path: string) => fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

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
  resolve: {
    alias: [
      { find: /^@zkproofport-app\/core\/circuits$/, replacement: core('circuits.ts') },
      { find: /^@zkproofport-app\/core\/typedAction$/, replacement: core('typedAction.ts') },
      { find: /^@zkproofport-app\/core\/oprf$/, replacement: core('oprf.ts') },
      { find: /^@zkproofport-app\/core$/, replacement: core('index.ts') },
    ],
  },
  test: {
    include: ['src/__tests__/**/*.live.ts'],
    testTimeout: 30_000,
  },
});
