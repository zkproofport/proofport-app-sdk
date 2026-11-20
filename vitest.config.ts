import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The SDK's tests load @zkproofport-app/core from its SOURCE, not from the
// workspace link's dist. Through dist, a test ran against whatever core was
// last built (a freshly pinned chain read as missing until somebody rebuilt
// it), and a test could not replace core's generated tables, because dist
// bundles them in. A test that needs verifiers deployed while the generated
// table says they await a redeploy mocks
// packages/core/src/pinnedVerifiers.generated (helpers/redeployedVerifiers.ts).
const core = (path: string) => fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

/** Tests that run git in temporary repositories; see `projects` below. */
const GIT_REPO_TESTS = 'src/__tests__/pinnedVerifierGenerator.test.ts';

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
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 10000,
    // ISOLATION, NOT A ROOT FIX. pinnedVerifierGenerator.test.ts builds
    // throwaway git repositories under os.tmpdir(); run in parallel with the
    // other files, `git add` there failed with "unable to create temporary
    // file: Invalid argument" (EINVAL from git's object tmp file) in about two
    // of three full runs, and never alone (5 of 5 green), never in a plain
    // parallel git stress (0 of 320), and also with no bb.js file running
    // (1 of 4). No shared GIT_* / TMPDIR variable and no test touching the tmp
    // dir was found; the cause is unknown. So that file runs in its own
    // group, after every other file has finished (sequence.groupOrder).
    projects: [
      {
        extends: true,
        test: {
          name: 'sdk',
          include: ['src/__tests__/**/*.test.ts'],
          exclude: [GIT_REPO_TESTS],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'git-repos',
          include: [GIT_REPO_TESTS],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
