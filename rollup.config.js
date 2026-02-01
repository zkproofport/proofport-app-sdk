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
    external: ['ethers', 'qrcode'],
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
    external: ['ethers'],
    plugins: [
      resolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
];
