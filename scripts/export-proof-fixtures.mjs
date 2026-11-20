#!/usr/bin/env node
/**
 * Writes the real-proof test fixtures under src/__tests__/fixtures/ from the
 * circuits repository's acceptance outputs, and refuses to write one that the
 * SDK's own bb.js does not accept.
 *
 * Why a script: these fixtures are the only proofs the off-chain tests verify
 * with a real Barretenberg, and they must be rewritten every time the circuits
 * move to another bb (a bb 4.2 proof is `false` under bb.js 6, even against
 * its own key). Until 2026-11-17 they were assembled by hand, and the file's
 * `source` note was the only record of how.
 *
 * Source, in the circuits checkout (its working tree, so a rebuild can be
 * exported before it is committed):
 *   <dir>/target/vk/vk                 the package's key
 *   <dir>/target/proof/                the proof of witness_action.gz
 *   <dir>/target/proof_<case>/         the proof of witness_<case>.gz
 * written by `scripts/build.sh <package>` and its post-build acceptance run
 * (scripts/action-circuit-acceptance.sh). The `-synthetic-anchors` twins are
 * the package's own source with test Apple / server keys, so the proofs verify
 * only against the key in the same fixture, never a deployed verifier.
 *
 *   node scripts/export-proof-fixtures.mjs            # write
 *   node scripts/export-proof-fixtures.mjs --check    # exit 1 when a fixture differs
 *
 * Options: --circuits <dir> (default: <superproject>/circuits).
 * Prerequisites: node >= 20, `npm install` here (for @aztec-foundation/bb.js),
 * the circuits built and their acceptance runs done with the pinned toolchain.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const flag = name => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
};
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const sdkRoot = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
const superproject = git(process.cwd(), 'rev-parse', '--show-superproject-working-tree').trim();
const circuitsDir = flag('--circuits') ?? join(superproject || sdkRoot, 'circuits');
if (!existsSync(circuitsDir)) throw new Error(`No circuits checkout at ${circuitsDir}. Pass --circuits <dir>.`);

/**
 * Each fixture: the acceptance package it comes from, the shipped package it
 * is a twin of, and which proof directory fills which field. `flat` puts one
 * proof at the top level (proof, publicInputs); otherwise each case is a key.
 */
const FIXTURES = [
  {
    out: 'src/__tests__/fixtures/coinbaseKycV2SyntheticAnchors.json',
    dir: 'coinbase-attestation-v2-synthetic-anchors',
    twinOf: 'coinbase-attestation-v2',
    flat: 'proof',
    what: 'witness_action: app signer kind with an EIP-712 action.',
  },
  {
    out: 'src/__tests__/fixtures/coinbaseCountryV2SyntheticAnchors.json',
    dir: 'coinbase-country-attestation-v2-synthetic-anchors',
    twinOf: 'coinbase-country-attestation-v2',
    cases: { action: 'proof', serverExclusion: 'proof_server_exclusion' },
    what: "'action' (witness_action): app signer kind with an EIP-712 action, inclusion list [US, KR]. 'serverExclusion' (witness_server_exclusion): server signer kind, exclusion list.",
  },
  {
    out: 'src/__tests__/fixtures/humanPassportTestIssuerProof.json',
    dir: 'human-passport-score',
    twinOf: 'human-passport-score',
    flat: 'proof',
    differs: 'the acceptance fixture: an INSECURE test issuer and test wallet derived from public strings in circuits scripts/human-passport/generate-fixtures.js, real Base scoreV2 data re-signed; its issuer root includes the test issuer, so core refuses it unless the root is replaced',
    what: 'witness_action (action mode); OPRF answer under the circuits fixture key for human_passport_score.',
  },
  {
    out: 'src/__tests__/fixtures/dojangPlaygroundPublicInputs.json',
    dir: 'dojang-playground',
    twinOf: 'dojang-playground',
    flat: 'proof',
    differs: "the acceptance fixture (scripts/dojang-playground fixtures), a real Playground issuance's wallet",
    what: 'witness_action (action mode); OPRF answer under the circuits fixture key for dojang_playground.',
  },
];

const toHex = bytes => '0x' + Buffer.from(bytes).toString('hex');
const fieldsOf = bytes => {
  if (bytes.length % 32 !== 0) throw new Error(`public_inputs is ${bytes.length} bytes, not a whole number of 32-byte fields`);
  const out = [];
  for (let i = 0; i < bytes.length; i += 32) out.push(toHex(bytes.subarray(i, i + 32)));
  return out;
};

const toolchain = readFileSync(join(circuitsDir, 'toolchain.env'), 'utf8');
const bbVersion = toolchain.match(/^BB_VERSION=(\S+)\s*$/m)?.[1];
if (!bbVersion) throw new Error(`${join(circuitsDir, 'toolchain.env')} has no BB_VERSION= line`);
const head = git(circuitsDir, 'rev-parse', '--short', 'HEAD').trim();

const bb = await import('@aztec-foundation/bb.js');
const bundled = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')).dependencies['@aztec-foundation/bb.js'];
if (bundled !== bbVersion) {
  throw new Error(`circuits toolchain.env says bb ${bbVersion}; this SDK bundles @aztec-foundation/bb.js ${bundled}. They must be the same.`);
}
const api = await bb.Barretenberg.new({ threads: 1 });
let drift = 0;
try {
  const verifier = new bb.UltraHonkVerifierBackend(api);
  for (const f of FIXTURES) {
    const target = join(circuitsDir, f.dir, 'target');
    const vk = readFileSync(join(target, 'vk', 'vk'));
    const read = async proofDir => {
      const proofPath = join(target, proofDir, 'proof');
      const proof = readFileSync(proofPath);
      const publicInputs = fieldsOf(readFileSync(join(target, proofDir, 'public_inputs')));
      const ok = await verifier.verifyProof({ proof: new Uint8Array(proof), publicInputs, verificationKey: new Uint8Array(vk) }, { verifierTarget: 'evm' });
      if (!ok) throw new Error(`${f.dir}/target/${proofDir} does not verify against ${f.dir}/target/vk/vk under bb.js ${bundled}. Rebuild it with the pinned toolchain.`);
      return { proof: toHex(proof), publicInputs, built: statSync(proofPath).mtime.toISOString().slice(0, 10) };
    };
    const dirty = git(circuitsDir, 'status', '--porcelain', '--', join(f.twinOf, 'src')).trim() !== '';
    const srcNote = `${f.twinOf}/src at ${head}${dirty ? ' plus uncommitted changes' : ''}`;
    let body;
    let built;
    if (f.flat) {
      const p = await read(f.flat);
      built = p.built;
      body = { proof: p.proof, publicInputs: p.publicInputs, vk: toHex(vk) };
    } else {
      body = { vk: toHex(vk) };
      for (const [key, dir] of Object.entries(f.cases)) {
        const p = await read(dir);
        built = p.built;
        body[key] = { proof: p.proof, publicInputs: p.publicInputs };
      }
    }
    const differs = f.differs ?? 'only the Apple and server key constants differ';
    const source =
      `circuits ${f.dir}, built ${built} by scripts/build.sh ${f.twinOf} (${srcNote}; ${differs}), ` +
      `bb ${bbVersion}, exported by scripts/export-proof-fixtures.mjs. ${f.what} Verifies only against the vk below, not against a deployed verifier.`;
    const text = JSON.stringify({ source, ...body }, null, 2) + '\n';
    const out = join(sdkRoot, f.out);
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    // The source note carries a date and a commit; the proof bytes are what matter.
    const strip = t => (t ? JSON.stringify({ ...JSON.parse(t), source: undefined }) : '');
    if (check) {
      if (strip(current) !== strip(text)) {
        console.error(`${f.out} differs from ${f.dir}'s acceptance outputs. Run without --check to rewrite it.`);
        drift++;
      } else {
        console.log(`${f.out} matches ${f.dir}.`);
      }
    } else {
      writeFileSync(out, text);
      console.log(`Wrote ${f.out} from ${f.dir} (bb ${bbVersion}; every proof verified first).`);
    }
  }
} finally {
  await api.destroy();
}
if (drift > 0) process.exit(1);
