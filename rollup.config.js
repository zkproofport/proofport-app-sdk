import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

// @aztec/bb.js is EXTERNAL everywhere, deliberately.
//
// It is the off-chain verifier's WebAssembly Barretenberg — 16MB installed, and
// an optional peer dependency, because most callers verify on-chain and should
// not pay for it. Bundling it also does not work: rollup follows it into
// thread-stream's package.json and stops with "Expected ';', '}' or <eof>",
// which reads like a syntax error in this repo and is not one.
const BB = '@aztec/bb.js';

// The browser Buffer polyfill, external for the same reason: it is a declared
// dependency the consumer resolves, and bundling a dynamic import of it forces
// rollup into multi-chunk output, which this config's single-file outputs
// cannot express ("output.dir must be used, not output.file").
const BUFFER = 'buffer/';

export default [
  // CJS for Node.js — qrcode stays external
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['ethers', 'qrcode', 'socket.io-client', BB, BUFFER],
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: 'dist',
      }),
    ],
  },
  // ESM for browsers — qrcode bundled with browser resolution
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/index.mjs',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: ['ethers', 'socket.io-client', BB, BUFFER],
    plugins: [
      resolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // "./circuits" subpath — canonical circuit identifiers on their own.
  // Deliberately its own entry point so importing it pulls in no runtime
  // dependencies (no qrcode, no socket.io-client) and no SDK code.
  // Declarations come from the CJS build above, which emits dist/circuits.d.ts.
  {
    input: 'src/circuits.ts',
    output: [
      {
        file: 'dist/circuits.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/circuits.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/circuits.mjs',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
];
