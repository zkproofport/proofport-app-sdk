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
 * Read through `git show <ref>:<path>`, so the circuits checkout may sit on any
 * branch. Fetch first so the ref is current:
 *
 *   git -C ../circuits fetch origin
 *   node scripts/generate-pinned-verifiers.mjs            # write
 *   node scripts/generate-pinned-verifiers.mjs --check    # exit 1 on drift
 *
 * Options: --circuits <dir> (default: <superproject>/circuits),
 *          --ref <git ref> (default: origin/main),
 *          --out <file> (default: packages/core/src/pinnedVerifiers.generated.ts;
 *          the tests write elsewhere).
 *
 * Which script pins which (circuit, signer variant), and which scripts are
 * skipped and why, lives in ./pinned-verifier-scripts.mjs.
 *
 * Prerequisites: node >= 18, git, the circuits submodule checked out.
 */
import { execFileSync } from 'node:child_process';
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

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Project home from the working directory, per CLAUDE.md: asked from inside a
// submodule, --show-toplevel answers the submodule, so ask for the superproject
// first and fall back to the toplevel when there is none.
const sdkRoot = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
const superproject = git(process.cwd(), 'rev-parse', '--show-superproject-working-tree').trim();
const repo = superproject || sdkRoot;
const circuitsDir = flag('--circuits') ?? join(repo, 'circuits');
const ref = flag('--ref') ?? 'origin/main';
if (!existsSync(circuitsDir)) throw new Error(`No circuits checkout at ${circuitsDir}. Pass --circuits <dir>.`);

const sha = git(circuitsDir, 'rev-parse', '--verify', `${ref}^{commit}`).trim();
const files = git(circuitsDir, 'ls-tree', '-r', '--name-only', sha).split('\n').filter(Boolean);
const show = path => git(circuitsDir, 'show', `${sha}:${path}`);

// Exhaustive over core's circuit ids, read from its source so the two agree.
const circuitsSource = readFileSync(join(sdkRoot, 'packages/core/src/circuits.ts'), 'utf8');
const idsBlock = circuitsSource.match(/export const CIRCUIT_IDS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/);
if (!idsBlock) throw new Error('Could not find CIRCUIT_IDS in packages/core/src/circuits.ts');
const ALL_IDS = [...idsBlock[1].matchAll(/:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
for (const [name, { circuit }] of Object.entries(VERIFIER_BY_SCRIPT)) {
  if (!ALL_IDS.includes(circuit)) throw new Error(`Deploy script ${name} maps to '${circuit}', which is not a circuit id in core. Known: ${ALL_IDS.join(', ')}`);
}

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
  table[variant][circuit][chain] = {
    address,
    deployedAt: new Date(Number(run.timestamp)).toISOString(),
    circuitsCommit: String(run.commit ?? ''),
    record: path,
  };
}

// A deployments/ record with no broadcast behind it cannot be checked.
for (const path of files) {
  const m = path.match(/^deployments\/(\d+)\/([A-Za-z0-9]+)\.json$/);
  if (!m || NOT_VERIFIERS.has(m[2]) || NOT_PINNED_HERE.has(m[2]) || m[2] === 'ZKTranscriptLib') continue;
  const mapped = Object.prototype.hasOwnProperty.call(VERIFIER_BY_SCRIPT, m[2]) ? VERIFIER_BY_SCRIPT[m[2]] : undefined;
  if (!mapped) throw new Error(`${path}: '${m[2]}' is not mapped to a circuit id.`);
  if (!table[mapped.variant][mapped.circuit][m[1]]) throw new Error(`${path} has no broadcast record at broadcast/Deploy${m[2]}.s.sol/${m[1]}/run-latest.json`);
}

const lines = [
  '// GENERATED by scripts/generate-pinned-verifiers.mjs -- do not edit by hand.',
  `// Source: zkproofport/circuits ${sha} (${ref}), broadcast/**/run-latest.json`,
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
  '  /** The deployment record, relative to the circuits repository. */',
  '  readonly record: string;',
  '}',
  '',
  `export const PINNED_VERIFIERS_SOURCE_COMMIT = '${sha}';`,
  '',
  'export const PINNED_VERIFIERS: Readonly<Record<CircuitId, Readonly<Record<number, PinnedVerifier>>>> = Object.freeze({',
];
const chainRows = (byChain, indent) => {
  const chains = Object.keys(byChain).map(Number).sort((a, b) => a - b);
  return chains.map(c => {
    const v = byChain[c];
    return `${indent}${c}: Object.freeze({ address: '${v.address}', deployedAt: '${v.deployedAt}', circuitsCommit: '${v.circuitsCommit}', record: '${v.record}' }),`;
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
  console.log(`Wrote ${target} from circuits ${ref} (${sha}).`);
}
