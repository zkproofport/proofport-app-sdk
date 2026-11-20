#!/usr/bin/env node
/**
 * Writes src/__tests__/fixtures/signal-hash-vectors.json: the signal_hash test
 * vectors every implementation of core's computeSignalHash is held to (core,
 * proofport-app, proofport-ai's SDK, circuits' fixture generators). The hashes
 * come from ethers' solidityPackedKeccak256, not from any of those helpers.
 *
 *   node scripts/generate-signal-hash-vectors.mjs           # rewrite
 *   node scripts/generate-signal-hash-vectors.mjs --check   # exit 1 if stale
 *
 * After a rewrite, copy the file to the other repositories and run the parent
 * repository's scripts/check-signal-hash-vectors.sh.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const OUT = fileURLToPath(new URL('../src/__tests__/fixtures/signal-hash-vectors.json', import.meta.url));
const cases = [
  { note: 'relay request id (lowercase UUID)', scope: 'myapp.com', circuitId: 'coinbase_attestation', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'same scope and request, another circuit', scope: 'myapp.com', circuitId: 'coinbase_country_attestation', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'same scope and circuit, another request', scope: 'myapp.com', circuitId: 'coinbase_attestation', requestId: '9a1c7e3b-2f5d-4c8a-b6e1-0d4f2a8c6b19' },
  { note: 'GIWA', scope: 'giwa:demo', circuitId: 'giwa_attestation', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'Dojang Playground', scope: 'dojang:playground', circuitId: 'dojang_playground', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'Human Passport', scope: 'myapp.com', circuitId: 'human_passport_score', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: "SDK deep-link request id", scope: 'myapp.com', circuitId: 'coinbase_attestation', requestId: 'req-mabc123x-k3j9x0qz' },
  { note: 'Korean, emoji, newline and tab in the scope', scope: '프루프포트 🔐\nscope\t1', circuitId: 'coinbase_attestation', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'hostile text in the scope', scope: "%_\\' OR 1=1; <script>x</script>", circuitId: 'coinbase_attestation', requestId: 'A-Z-0-9' },
  { note: 'scope at the 4096-byte cap', scope: 'a'.repeat(4096), circuitId: 'coinbase_attestation', requestId: '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f' },
  { note: 'request id at the 128-character cap', scope: 'myapp.com', circuitId: 'coinbase_attestation', requestId: 'x'.repeat(128) },
];
const vectors = cases.map(c => ({ ...c, signalHash: ethers.solidityPackedKeccak256(['string', 'string', 'string'], [c.scope, c.circuitId, c.requestId]) }));
const text = JSON.stringify({
  rule: 'signal_hash = keccak256(abi.encodePacked(string scope, string circuitId, string requestId)); no wallet address',
  oracle: 'ethers v6 solidityPackedKeccak256, independent of every helper that reads this file',
  canonical: 'proofport-app-sdk packages/core/src/signalHash.ts; copies must stay byte-identical (scripts/check-signal-hash-vectors.sh in the parent repository)',
  vectors,
}, null, 2) + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') !== text) {
    console.error(`${OUT} is stale; run without --check.`);
    process.exit(1);
  }
  console.log('signal-hash-vectors.json is up to date');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${vectors.length} vectors to ${OUT}`);
}
