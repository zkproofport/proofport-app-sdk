#!/usr/bin/env node
/**
 * Writes packages/core/src/pinnedVerifiers.generated.ts: the verifier contract
 * each circuit has on each chain -- PINNED_VERIFIERS for the standard package,
 * PINNED_VARIANT_VERIFIERS for another signer variant's package (Deploy*Android
 * scripts) -- read from the circuits repository's own deployment records. The SDK verifies against these addresses (or one a dApp
 * configured) and never against an address carried in a proof response.
 *
 * Source of truth, in the circuits repository at a git ref (default
 * origin/main):
 *   broadcast/Deploy<Name>.s.sol/<chainId>/run-latest.json  -- forge's record
 *       of the deployment: one CREATE of HonkVerifier with a successful receipt.
 *   deployments/<chainId>/<Name>.json  -- written by scripts/deploy_verifier.sh
 *       since the beta.19 toolchain. When present its address must equal the
 *       broadcast's, or this script stops.
 *
 *   <package>/target/vk/vk  -- every package's verification key. The SDK's
 *       off-chain verifier fetches the key at VERIFICATION_KEYS_REF and refuses
 *       one whose sha256 is not the one written here.
 *   toolchain.env  -- BB_VERSION, the bb that wrote those keys. The SDK's
 *       bundled bb.js must be the same version (a test holds it).
 *
 * A pinned verifier must have been built from the CURRENT key: the key at the
 * commit its broadcast records (`commit`) must equal the key at the source.
 * One that was not -- a circuit rebuilt, a toolchain upgraded, the verifier
 * not yet redeployed -- is left out of the table and listed in
 * AWAITING_REDEPLOY instead, so it can be neither used nor mistaken for the
 * new one. Its address is recorded there for the record only.
 *
 * When the key is not committed at that commit (the verifier was deployed
 * from a local build and the keys were committed afterwards, as GIWA KYC and
 * the Dojang Playground v2 were on 2026-11-27), the deployed bytes decide:
 * bb writes every 32-byte word of the key into the Solidity verifier as a
 * constant, so the broadcast's HonkVerifier creation code must hold each
 * non-zero word of the CURRENT key as a PUSH immediate. Such a row is marked
 * `keyFrom: 'initcode'` (otherwise 'commit'). A creation code missing any word
 * stops the generator: which key that contract carries is then unknown.
 *
 * Read through `git show <ref>:<path>`, so the circuits checkout may sit on any
 * branch. Fetch first so the ref is current:
 *
 *   git -C ../circuits fetch origin
 *   node scripts/generate-pinned-verifiers.mjs            # write
 *   node scripts/generate-pinned-verifiers.mjs --check    # exit 1 on drift
 *
 * Options: --circuits <dir> (default: <superproject>/circuits),
 *          --ref <git ref> (default: origin/main),
 *          --worktree  read the circuits WORKING TREE over HEAD instead of a
 *            ref, for keys rebuilt but not yet committed. When any key or
 *            toolchain.env differs from HEAD, VERIFICATION_KEYS_REF is null:
 *            those keys exist at no commit the SDK could fetch them from, so
 *            off-chain verification against them needs a caller-supplied key
 *            until the generator is re-run on the committed circuits.
 *          --out <file> (default: packages/core/src/pinnedVerifiers.generated.ts;
 *          the tests write elsewhere).
 *
 * Which script pins which (circuit, signer variant), and which scripts are
 * skipped and why, lives in ./pinned-verifier-scripts.mjs.
 *
 * Prerequisites: node >= 18, git, the circuits submodule checked out.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VERIFIER_BY_SCRIPT, NOT_VERIFIERS, NOT_PINNED_HERE } from './pinned-verifier-scripts.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
};
const check = args.includes('--check');
const worktree = args.includes('--worktree');
if (worktree && args.includes('--ref')) throw new Error('--worktree reads the circuits working tree over HEAD; it takes no --ref.');

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Project home from the working directory, per CLAUDE.md: asked from inside a
// submodule, --show-toplevel answers the submodule, so ask for the superproject
// first and fall back to the toplevel when there is none.
const sdkRoot = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
const superproject = git(process.cwd(), 'rev-parse', '--show-superproject-working-tree').trim();
const repo = superproject || sdkRoot;
const circuitsDir = flag('--circuits') ?? join(repo, 'circuits');
const ref = worktree ? 'HEAD' : flag('--ref') ?? 'origin/main';
if (!existsSync(circuitsDir)) throw new Error(`No circuits checkout at ${circuitsDir}. Pass --circuits <dir>.`);

const sha = git(circuitsDir, 'rev-parse', '--verify', `${ref}^{commit}`).trim();
const lines0 = text => text.split('\n').filter(Boolean);
const files = worktree
  ? [...new Set([...lines0(git(circuitsDir, 'ls-files')), ...lines0(git(circuitsDir, 'ls-files', '--others', '--exclude-standard'))])].filter(p =>
      existsSync(join(circuitsDir, p)),
    )
  : lines0(git(circuitsDir, 'ls-tree', '-r', '--name-only', sha));
const MAX_BUFFER = 64 * 1024 * 1024;
const showBytes = worktree
  ? path => readFileSync(join(circuitsDir, path))
  : path => execFileSync('git', ['-C', circuitsDir, 'show', `${sha}:${path}`], { maxBuffer: MAX_BUFFER });
const show = path => showBytes(path).toString('utf8');
/** Bytes of `path` at `commit`, or null when the commit or the file is not there. */
const bytesAt = (commit, path) => {
  try {
    return execFileSync('git', ['-C', circuitsDir, 'show', `${commit}:${path}`], { maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/**
 * Which 32-byte words of `key` the creation code `initcodeHex` does not hold
 * as a PUSH immediate (PUSHn followed by the word without its leading zero
 * bytes), by index; null when there is no creation code to read. An all-zero
 * word needs no constant and is never missing. A key whose length is not a
 * whole number of words is reported as missing its last word.
 */
function keyWordsMissingFromInitcode(key, initcodeHex) {
  if (typeof initcodeHex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(initcodeHex)) return null;
  const code = Buffer.from(initcodeHex.slice(2), 'hex');
  const missing = [];
  for (let i = 0; i * 32 < key.length; i++) {
    const word = key.subarray(i * 32, i * 32 + 32);
    if (word.length !== 32) {
      missing.push(i);
      continue;
    }
    let start = 0;
    while (start < 32 && word[start] === 0) start++;
    if (start === 32) continue;
    const immediate = word.subarray(start);
    if (!code.includes(Buffer.concat([Buffer.from([0x5f + immediate.length]), immediate]))) missing.push(i);
  }
  return missing;
}
const bbVersionOf = (text, where) => {
  const m = String(text).match(/^BB_VERSION=(\S+)\s*$/m);
  if (!m) throw new Error(`${where} has no BB_VERSION= line; cannot tell which bb wrote the verification keys.`);
  return m[1];
};

// Exhaustive over core's circuit ids, read from its source so the two agree.
const circuitsSource = readFileSync(join(sdkRoot, 'packages/core/src/circuits.ts'), 'utf8');
const idsBlock = circuitsSource.match(/export const CIRCUIT_IDS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/);
if (!idsBlock) throw new Error('Could not find CIRCUIT_IDS in packages/core/src/circuits.ts');
const ALL_IDS = [...idsBlock[1].matchAll(/:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
for (const [name, { circuit }] of Object.entries(VERIFIER_BY_SCRIPT)) {
  if (!ALL_IDS.includes(circuit)) throw new Error(`Deploy script ${name} maps to '${circuit}', which is not a circuit id in core. Known: ${ALL_IDS.join(', ')}`);
}

// Every package's current verification key, keyed like the pinned tables.
// circuits.ts names each package as `vkPath: '...', deployScriptName: '...'`;
// every pinned deploy script must have one, and every key must exist here.
const vkPathByScript = Object.fromEntries(
  [...circuitsSource.matchAll(/vkPath: '([^']+)', deployScriptName: '([A-Za-z0-9]+)'/g)].map(m => [m[2], m[1]]),
);
if (!files.includes('toolchain.env')) throw new Error(`circuits ${ref} (${sha}) has no toolchain.env; cannot tell which bb wrote the verification keys.`);
const keysBbVersion = bbVersionOf(show('toolchain.env'), `toolchain.env at ${ref}`);
const keys = {};
for (const [script, { circuit, variant }] of Object.entries(VERIFIER_BY_SCRIPT)) {
  const vkPath = vkPathByScript[script];
  if (!vkPath) throw new Error(`core's circuits.ts names no vkPath for deploy script ${script}`);
  if (!files.includes(vkPath)) throw new Error(`${vkPath} (the ${circuit} '${variant}' verification key) does not exist at circuits ${worktree ? 'working tree' : ref}`);
  const bytes = showBytes(vkPath);
  if (bytes.length < 512) throw new Error(`${vkPath} is ${bytes.length} bytes, far too small to be a verification key`);
  keys[circuit] ??= {};
  keys[circuit][variant] = { sha256: sha256(bytes), path: vkPath };
}
// The keys can be fetched at `sha` only when they are committed there. In
// --worktree mode a key or toolchain.env that differs from HEAD has no commit.
const keysRef = worktree
  ? git(circuitsDir, 'status', '--porcelain', '--', 'toolchain.env', ...Object.values(vkPathByScript)).trim() === ''
    ? sha
    : null
  : sha;
const awaiting = [];

// table[variant][circuit][chain]. `standard` holds every circuit id (core's
// PINNED_VERIFIERS is exhaustive); another variant holds the circuits a deploy
// script maps to it, so a package with nothing deployed yet is an empty row.
const table = { standard: Object.fromEntries(ALL_IDS.map(id => [id, {}])) };
for (const { circuit, variant } of Object.values(VERIFIER_BY_SCRIPT)) {
  if (variant === 'standard') continue;
  table[variant] ??= {};
  table[variant][circuit] = {};
}
const broadcastRe = /^broadcast\/Deploy([A-Za-z0-9]+)\.s\.sol\/(\d+)\/run-latest\.json$/;

for (const path of files) {
  const m = path.match(broadcastRe);
  if (!m) continue;
  const [, name, chain] = m;
  if (NOT_VERIFIERS.has(name) || NOT_PINNED_HERE.has(name)) continue;
  const mapped = Object.prototype.hasOwnProperty.call(VERIFIER_BY_SCRIPT, name) ? VERIFIER_BY_SCRIPT[name] : undefined;
  if (!mapped) throw new Error(`${path}: deploy script '${name}' is not mapped to a circuit id. Add it to VERIFIER_BY_SCRIPT, NOT_PINNED_HERE or NOT_VERIFIERS in scripts/pinned-verifier-scripts.mjs.`);
  const { circuit, variant } = mapped;

  const run = JSON.parse(show(path));
  const created = (run.transactions ?? []).filter(t => t.transactionType === 'CREATE' && t.contractName === 'HonkVerifier');
  if (created.length !== 1) throw new Error(`${path}: expected one HonkVerifier CREATE, found ${created.length}`);
  const address = String(created[0].contractAddress).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`${path}: '${address}' is not an address`);
  const receipt = (run.receipts ?? []).find(r => String(r.contractAddress).toLowerCase() === address);
  if (!receipt || receipt.status !== '0x1') throw new Error(`${path}: no successful receipt for ${address}`);
  if (Number(run.chain) !== Number(chain)) throw new Error(`${path}: records chain ${run.chain}, directory says ${chain}`);

  const recordPath = `deployments/${chain}/${name}.json`;
  if (files.includes(recordPath)) {
    const record = JSON.parse(show(recordPath));
    if (String(record.address).toLowerCase() !== address) {
      throw new Error(`${recordPath} says ${record.address}, ${path} says ${address}. Fix the circuits records first.`);
    }
  }
  // Which key was this contract built from? forge records the circuits commit
  // it ran at; the key there is the one the deployed Solidity was generated
  // with. A contract built from another key than the current one cannot verify
  // a current proof, and pinning it would accept proofs of the superseded
  // circuit: it waits for a redeploy instead.
  const deployCommit = String(run.commit ?? '');
  const vkPath = vkPathByScript[name];
  const deployedKey = deployCommit ? bytesAt(deployCommit, vkPath) : null;
  let vkSha256;
  let keyFrom;
  if (deployedKey) {
    vkSha256 = sha256(deployedKey);
    keyFrom = 'commit';
  } else {
    const missing = keyWordsMissingFromInitcode(showBytes(vkPath), created[0].transaction?.input);
    if (missing !== null && missing.length === 0) {
      vkSha256 = keys[circuit][variant].sha256;
      keyFrom = 'initcode';
    } else {
      throw new Error(
        `${path}: cannot read ${vkPath} at the deployment's circuits commit '${deployCommit}', and the verifier's creation code ` +
          (missing === null ? 'is not in the broadcast' : `lacks ${missing.length} word(s) of the current key (first: word ${missing[0]})`) +
          ', so the key this verifier was built from is unknown.',
      );
    }
  }
  if (vkSha256 !== keys[circuit][variant].sha256) {
    awaiting.push({ circuit, variant, chainId: Number(chain), previousAddress: address, previousVkSha256: vkSha256, record: path });
    continue;
  }
  table[variant][circuit][chain] = {
    address,
    deployedAt: new Date(Number(run.timestamp)).toISOString(),
    circuitsCommit: deployCommit,
    vkSha256,
    keyFrom,
    record: path,
  };
}
const awaitingKey = v => `${v.circuit}/${v.variant}/${String(v.chainId).padStart(12, '0')}`;
awaiting.sort((a, b) => awaitingKey(a).localeCompare(awaitingKey(b)));

// A deployments/ record with no broadcast behind it cannot be checked.
for (const path of files) {
  const m = path.match(/^deployments\/(\d+)\/([A-Za-z0-9]+)\.json$/);
  if (!m || NOT_VERIFIERS.has(m[2]) || NOT_PINNED_HERE.has(m[2]) || m[2] === 'ZKTranscriptLib') continue;
  const mapped = Object.prototype.hasOwnProperty.call(VERIFIER_BY_SCRIPT, m[2]) ? VERIFIER_BY_SCRIPT[m[2]] : undefined;
  if (!mapped) throw new Error(`${path}: '${m[2]}' is not mapped to a circuit id.`);
  if (!table[mapped.variant][mapped.circuit][m[1]] && !awaiting.some(v => v.circuit === mapped.circuit && v.variant === mapped.variant && v.chainId === Number(m[1]))) throw new Error(`${path} has no broadcast record at broadcast/Deploy${m[2]}.s.sol/${m[1]}/run-latest.json`);
}

// Verifiers still accepted during a transition. When a circuit is rebuilt and
// its verifier redeployed, run-latest.json moves to the new contract and the
// old one drops out of the table above -- and with it every proof made by an
// app that still carries the old circuit files. The circuits repository lists
// the old contracts it still vouches for, each with a date after which the SDK
// refuses it, in deployments/accepted-legacy-verifiers.json:
//
//   { "version": 1,
//     "entries": [ { "script": "OidcDomainAttestation", "chainId": 8453,
//                    "address": "0x...", "vkRef": "<40-hex circuits commit>",
//                    "acceptedUntil": "2027-01-31", "reason": "..." } ] }
//
// No file means no legacy verifier. Every entry is checked against the
// repository itself: the address must be a HonkVerifier deployed for that
// script on that chain (some run-*.json broadcast), it must not be the current
// one, and the verification key at vkRef must exist, because off-chain
// verification fetches it from there.
const LEGACY_RECORD = 'deployments/accepted-legacy-verifiers.json';
const legacy = [];
if (files.includes(LEGACY_RECORD)) {
  const doc = JSON.parse(show(LEGACY_RECORD));
  if (doc.version !== 1) throw new Error(`${LEGACY_RECORD}: version must be 1, got ${JSON.stringify(doc.version)}`);
  if (!Array.isArray(doc.entries)) throw new Error(`${LEGACY_RECORD}: "entries" must be an array`);
  const seen = new Set();
  for (const [i, e] of doc.entries.entries()) {
    const at = `${LEGACY_RECORD} entries[${i}]`;
    const mapped = Object.prototype.hasOwnProperty.call(VERIFIER_BY_SCRIPT, e.script) ? VERIFIER_BY_SCRIPT[e.script] : undefined;
    if (!mapped) throw new Error(`${at}: script '${e.script}' is not a pinned deploy script. Known: ${Object.keys(VERIFIER_BY_SCRIPT).join(', ')}`);
    const chain = Number(e.chainId);
    if (!Number.isInteger(chain) || chain <= 0) throw new Error(`${at}: chainId ${JSON.stringify(e.chainId)} is not a chain id`);
    const address = String(e.address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`${at}: '${e.address}' is not an address`);
    const current = table[mapped.variant][mapped.circuit][chain];
    if (!current) throw new Error(`${at}: ${e.script} has no current verifier on chain ${chain}; a legacy entry needs the one that replaced it`);
    if (current.address === address) throw new Error(`${at}: ${address} is the current ${e.script} verifier on chain ${chain}, not a legacy one`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.acceptedUntil)) || Number.isNaN(Date.parse(`${e.acceptedUntil}T00:00:00Z`))) {
      throw new Error(`${at}: acceptedUntil '${e.acceptedUntil}' is not a YYYY-MM-DD date`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim() === '') throw new Error(`${at}: a reason is required`);
    if (!/^[0-9a-f]{40}$/.test(String(e.vkRef))) throw new Error(`${at}: vkRef must be a full 40-hex circuits commit, got '${e.vkRef}'`);
    const vkPath = vkPathByScript[e.script];
    if (!vkPath) throw new Error(`${at}: core's circuits.ts names no vkPath for deploy script ${e.script}`);
    if (!bytesAt(e.vkRef, vkPath)) throw new Error(`${at}: ${vkPath} does not exist at circuits ${e.vkRef}`);
    // The off-chain verifier can check a legacy key only with the bb that
    // wrote it; the SDK compares this with its bundled bb.js and says so.
    const legacyToolchain = bytesAt(e.vkRef, 'toolchain.env');
    if (!legacyToolchain) throw new Error(`${at}: circuits ${e.vkRef} has no toolchain.env; cannot tell which bb wrote its key`);
    const bbVersion = bbVersionOf(legacyToolchain.toString('utf8'), `${at}: toolchain.env at ${e.vkRef}`);
    const history = files.filter(f => f.startsWith(`broadcast/Deploy${e.script}.s.sol/${chain}/run-`) && f.endsWith('.json'));
    const deployedHere = history.some(f => {
      const run = JSON.parse(show(f));
      const created = (run.transactions ?? []).some(
        t => t.transactionType === 'CREATE' && t.contractName === 'HonkVerifier' && String(t.contractAddress).toLowerCase() === address,
      );
      const ok = (run.receipts ?? []).some(r => String(r.contractAddress).toLowerCase() === address && r.status === '0x1');
      return created && ok;
    });
    if (!deployedHere) throw new Error(`${at}: no broadcast under broadcast/Deploy${e.script}.s.sol/${chain}/ deployed a HonkVerifier at ${address}`);
    const key = `${e.script}/${chain}/${address}`;
    if (seen.has(key)) throw new Error(`${at}: duplicate entry for ${key}`);
    seen.add(key);
    legacy.push({ circuit: mapped.circuit, variant: mapped.variant, chainId: chain, address, vkRef: e.vkRef, bbVersion, acceptedUntil: e.acceptedUntil, reason: e.reason.trim() });
  }
  const sortKey = v => `${v.circuit}/${v.variant}/${String(v.chainId).padStart(12, '0')}/${v.address}`;
  legacy.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

const lines = [
  '// GENERATED by scripts/generate-pinned-verifiers.mjs -- do not edit by hand.',
  `// Source: zkproofport/circuits ${sha} (${worktree ? 'working tree' : ref}), broadcast/**/run-latest.json`,
  '// cross-checked against deployments/<chainId>/<Name>.json where present.',
  '// Regenerate after a verifier deployment; `--check` fails CI-style on drift.',
  "import type { CircuitId, SignerVariant } from './circuits';",
  '',
  'export interface PinnedVerifier {',
  '  /** Verifier contract address, lowercase. */',
  '  readonly address: string;',
  '  /** When forge broadcast the deployment (ISO 8601). */',
  '  readonly deployedAt: string;',
  '  /** circuits commit forge recorded for the deployment. */',
  '  readonly circuitsCommit: string;',
  '  /** sha256 of the key the contract was built from. Always the current key. */',
  '  readonly vkSha256: string;',
  '  /**',
  "   * How that key was established: 'commit' = it is the key at circuitsCommit;",
  "   * 'initcode' = it was not committed there (deployed from a local build), and",
  '   * every word of it is a constant in the broadcast creation code.',
  '   */',
  "  readonly keyFrom: 'commit' | 'initcode';",
  '  /** The deployment record, relative to the circuits repository. */',
  '  readonly record: string;',
  '}',
  '',
  '/** A superseded verifier still accepted during a transition. */',
  'export interface LegacyVerifier {',
  '  readonly circuit: CircuitId;',
  '  readonly variant: SignerVariant;',
  '  readonly chainId: number;',
  '  /** Verifier contract address, lowercase. */',
  '  readonly address: string;',
  '  /** circuits commit holding the verification key this contract was built from. */',
  '  readonly vkRef: string;',
  '  /** The bb that wrote that key (BB_VERSION in toolchain.env at vkRef). */',
  '  readonly bbVersion: string;',
  '  /** Last day (UTC, inclusive) the SDK accepts it. */',
  '  readonly acceptedUntil: string;',
  '  readonly reason: string;',
  '}',
  '',
  '/** A package\'s current verification key. */',
  'export interface VerificationKeyRecord {',
  '  /** sha256 of the key bytes, lowercase hex. */',
  '  readonly sha256: string;',
  '  /** The key, relative to the circuits repository. */',
  '  readonly path: string;',
  '}',
  '',
  '/**',
  ' * A verifier left out of the pinned tables because it was built from a key',
  ' * that is no longer the circuit\'s: it waits for a redeploy. The address is',
  ' * recorded so nobody has to rediscover it, and is never verified against.',
  ' */',
  'export interface AwaitingRedeploy {',
  '  readonly circuit: CircuitId;',
  '  readonly variant: SignerVariant;',
  '  readonly chainId: number;',
  '  readonly previousAddress: string;',
  '  /** sha256 of the key that contract was built from. */',
  '  readonly previousVkSha256: string;',
  '  readonly record: string;',
  '}',
  '',
  `export const PINNED_VERIFIERS_SOURCE_COMMIT = '${sha}';`,
  '',
  '/** The bb that wrote VERIFICATION_KEYS (BB_VERSION in the circuits toolchain.env). */',
  `export const VERIFICATION_KEY_BB_VERSION = '${keysBbVersion}';`,
  '',
  '/**',
  ' * The circuits commit VERIFICATION_KEYS are fetched at, or null when they were',
  ' * read from an uncommitted working tree and exist at no fetchable commit.',
  ' */',
  `export const VERIFICATION_KEYS_REF: string | null = ${keysRef ? `'${keysRef}'` : 'null'};`,
  '',
  'export const VERIFICATION_KEYS: Readonly<Record<CircuitId, Readonly<Partial<Record<SignerVariant, VerificationKeyRecord>>>>> = Object.freeze({',
  ...ALL_IDS.flatMap(id => {
    const byVariant = keys[id] ?? {};
    const variants = Object.keys(byVariant).sort();
    if (variants.length === 0) return [`  ${id}: Object.freeze({}),`];
    return [
      `  ${id}: Object.freeze({`,
      ...variants.map(v => `    ${v}: Object.freeze({ sha256: '${byVariant[v].sha256}', path: '${byVariant[v].path}' }),`),
      '  }),',
    ];
  }),
  '});',
  '',
  'export const PINNED_VERIFIERS: Readonly<Record<CircuitId, Readonly<Record<number, PinnedVerifier>>>> = Object.freeze({',
];
const chainRows = (byChain, indent) => {
  const chains = Object.keys(byChain).map(Number).sort((a, b) => a - b);
  return chains.map(c => {
    const v = byChain[c];
    return `${indent}${c}: Object.freeze({ address: '${v.address}', deployedAt: '${v.deployedAt}', circuitsCommit: '${v.circuitsCommit}', vkSha256: '${v.vkSha256}', keyFrom: '${v.keyFrom}', record: '${v.record}' }),`;
  });
};
const circuitBlock = (id, byChain, indent) => {
  const rows = chainRows(byChain, indent + '  ');
  if (rows.length === 0) return [`${indent}${id}: Object.freeze({}),`];
  return [`${indent}${id}: Object.freeze({`, ...rows, `${indent}}),`];
};
for (const id of ALL_IDS) lines.push(...circuitBlock(id, table.standard[id], '  '));
lines.push('});', '');
lines.push(
  '/**',
  ' * Verifiers of the packages other than `standard`, by signer variant, circuit',
  ' * id and chain. A circuit with no package for a variant has no key here; one',
  ' * whose package has nothing deployed yet has an empty row.',
  ' */',
  "export const PINNED_VARIANT_VERIFIERS: Readonly<Record<Exclude<SignerVariant, 'standard'>, Readonly<Partial<Record<CircuitId, Readonly<Record<number, PinnedVerifier>>>>>>> = Object.freeze({",
);
for (const variant of Object.keys(table).filter(v => v !== 'standard').sort()) {
  lines.push(`  ${variant}: Object.freeze({`);
  for (const id of ALL_IDS.filter(id => Object.prototype.hasOwnProperty.call(table[variant], id))) {
    lines.push(...circuitBlock(id, table[variant][id], '    '));
  }
  lines.push('  }),');
}
lines.push('});', '');
lines.push(
  '/**',
  ' * Superseded verifiers the circuits repository still vouches for, from',
  ` * ${LEGACY_RECORD}. Each is accepted until the end of`,
  ' * `acceptedUntil` (UTC) and refused afterwards; deleting its entry there and',
  ' * regenerating retires it. Empty when no transition is under way.',
  ' */',
  'export const ACCEPTED_LEGACY_VERIFIERS: readonly LegacyVerifier[] = Object.freeze([',
  ...legacy.map(v => `  Object.freeze({ circuit: '${v.circuit}', variant: '${v.variant}', chainId: ${v.chainId}, address: '${v.address}', vkRef: '${v.vkRef}', bbVersion: '${v.bbVersion}', acceptedUntil: '${v.acceptedUntil}', reason: ${JSON.stringify(v.reason)} }),`),
  ']);',
  '',
  '/**',
  ' * Deployed verifiers built from a superseded key, waiting for the redeploy',
  ' * that fills their row in the tables above. Empty when every deployed',
  ' * verifier matches its current key.',
  ' */',
  'export const AWAITING_REDEPLOY: readonly AwaitingRedeploy[] = Object.freeze([',
  ...awaiting.map(v => `  Object.freeze({ circuit: '${v.circuit}', variant: '${v.variant}', chainId: ${v.chainId}, previousAddress: '${v.previousAddress}', previousVkSha256: '${v.previousVkSha256}', record: '${v.record}' }),`),
  ']);',
  '',
);
const output = lines.join('\n');

const target = flag('--out') ? resolve(flag('--out')) : join(sdkRoot, 'packages/core/src/pinnedVerifiers.generated.ts');
if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  // The ref's spelling (origin/main, a branch, the sha itself) is a label in
  // the header; the commit beside it is what has to match.
  const withoutRefLabel = text => text.replace(/^(\/\/ Source: zkproofport\/circuits [0-9a-f]{40}) \([^)]*\)/m, '$1');
  if (withoutRefLabel(current) !== withoutRefLabel(output)) {
    console.error(`${target} is out of date with circuits ${ref} (${sha}). Run without --check to regenerate.`);
    process.exit(1);
  }
  console.log(`${target} matches circuits ${ref} (${sha}).`);
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${target} from circuits ${worktree ? 'working tree over' : ref} (${sha}).`);
  console.log(`Keys: bb ${keysBbVersion}, fetched at ${keysRef ?? 'no commit (uncommitted working tree)'}. Awaiting a redeploy: ${awaiting.length} verifier(s).`);
}
