import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
  // CJS for Node.js — qrcode stays external
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['ethers', 'qrcode', 'socket.io-client'],
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
    external: ['ethers', 'socket.io-client'],
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
