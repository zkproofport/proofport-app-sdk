import typescript from '@rollup/plugin-typescript';

// ethers is the only dependency and stays external (peer, v5 or v6).
//
// "./circuits" and "./typedAction" are separate entry points that import no
// ethers at all: the mobile app and jest load them without pulling in a
// provider library, and callers that only need circuit ids or the action check
// do not need ethers installed. Only the root entry (on-chain verification)
// imports ethers.
const entry = (name) => ({
  input: `src/${name}.ts`,
  output: [
    { file: `dist/${name}.js`, format: 'cjs', sourcemap: true },
    { file: `dist/${name}.esm.js`, format: 'esm', sourcemap: true },
  ],
  external: ['ethers'],
  plugins: [typescript(name === 'index' ? { tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist' } : { tsconfig: './tsconfig.json', declaration: false })],
});

export default [entry('index'), entry('circuits'), entry('typedAction')];
