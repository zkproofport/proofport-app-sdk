#!/usr/bin/env node
/**
 * Writes packages/core/src/pinnedVerifiers.generated.ts: the verifier contract
 * each circuit has on each chain, read from the circuits repository's own
 * deployment records. The SDK verifies against these addresses (or one a dApp
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
 *          --ref <git ref> (default: origin/main).
 *
 * Prerequisites: node >= 18, git, the circuits submodule checked out.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

// Deploy script name -> circuit id. Every deploy script that creates a
// HonkVerifier must be named here; one that is not stops the script, so a new
// circuit cannot be deployed and silently left out of the table.
const CIRCUIT_BY_SCRIPT = {
  CoinbaseAttestation: 'coinbase_attestation',
  CoinbaseCountryAttestation: 'coinbase_country_attestation',
  OidcDomainAttestation: 'oidc_domain_attestation',
  GiwaAttestation: 'giwa_attestation',
  DojangPlayground: 'dojang_playground',
  MdlKrOwnership: 'mdl_kr_ownership',
  MdlKrAge: 'mdl_kr_age',
  MdlKrRegion: 'mdl_kr_region',
};
// Deployed by these scripts, and not proof verifiers.
const NOT_VERIFIERS = new Set(['NullifierRegistry', 'ZKProofPortNullifierRegistry', 'TranscriptLib']);
// Verifiers this core version deliberately does not pin, each with its reason.
// Named one by one so a new deploy script still stops the script.
//   CoinbaseAppAttestPoc    the Coinbase KYC v2 prototype (circuits 33344e2);
//                           no shipped circuit uses it.
//   CoinbaseAttestationV2   Coinbase KYC v2 has its own public-input layout;
//                           core pins it in the core v2 release (circuits-dev.md
//                           fix list item 9), not as a v1 coinbase_attestation row.
const NOT_PINNED_HERE = new Set(['CoinbaseAppAttestPoc', 'CoinbaseAttestationV2']);

// Exhaustive over core's circuit ids, read from its source so the two agree.
const circuitsSource = readFileSync(join(sdkRoot, 'packages/core/src/circuits.ts'), 'utf8');
const idsBlock = circuitsSource.match(/export const CIRCUIT_IDS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/);
if (!idsBlock) throw new Error('Could not find CIRCUIT_IDS in packages/core/src/circuits.ts');
const ALL_IDS = [...idsBlock[1].matchAll(/:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
for (const id of Object.values(CIRCUIT_BY_SCRIPT)) {
  if (!ALL_IDS.includes(id)) throw new Error(`Deploy script maps to '${id}', which is not a circuit id in core. Known: ${ALL_IDS.join(', ')}`);
}

const table = Object.fromEntries(ALL_IDS.map(id => [id, {}]));
const broadcastRe = /^broadcast\/Deploy([A-Za-z0-9]+)\.s\.sol\/(\d+)\/run-latest\.json$/;

for (const path of files) {
  const m = path.match(broadcastRe);
  if (!m) continue;
  const [, name, chain] = m;
  if (NOT_VERIFIERS.has(name) || NOT_PINNED_HERE.has(name)) continue;
  const circuit = CIRCUIT_BY_SCRIPT[name];
  if (!circuit) throw new Error(`${path}: deploy script '${name}' is not mapped to a circuit id. Add it to CIRCUIT_BY_SCRIPT or NOT_VERIFIERS.`);

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
  table[circuit][chain] = {
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
  const circuit = CIRCUIT_BY_SCRIPT[m[2]];
  if (!circuit) throw new Error(`${path}: '${m[2]}' is not mapped to a circuit id.`);
  if (!table[circuit][m[1]]) throw new Error(`${path} has no broadcast record at broadcast/Deploy${m[2]}.s.sol/${m[1]}/run-latest.json`);
}

const lines = [
  '// GENERATED by scripts/generate-pinned-verifiers.mjs -- do not edit by hand.',
  `// Source: zkproofport/circuits ${sha} (${ref}), broadcast/**/run-latest.json`,
  '// cross-checked against deployments/<chainId>/<Name>.json where present.',
  '// Regenerate after a verifier deployment; `--check` fails CI-style on drift.',
  "import type { CircuitId } from './circuits';",
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
for (const id of ALL_IDS) {
  const chains = Object.keys(table[id]).map(Number).sort((a, b) => a - b);
  if (chains.length === 0) {
    lines.push(`  ${id}: Object.freeze({}),`);
    continue;
  }
  lines.push(`  ${id}: Object.freeze({`);
  for (const c of chains) {
    const v = table[id][c];
    lines.push(`    ${c}: Object.freeze({ address: '${v.address}', deployedAt: '${v.deployedAt}', circuitsCommit: '${v.circuitsCommit}', record: '${v.record}' }),`);
  }
  lines.push('  }),');
}
lines.push('});', '');
const output = lines.join('\n');

const target = join(sdkRoot, 'packages/core/src/pinnedVerifiers.generated.ts');
if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error(`${target} is out of date with circuits ${ref} (${sha}). Run without --check to regenerate.`);
    process.exit(1);
  }
  console.log(`${target} matches circuits ${ref} (${sha}).`);
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${target} from circuits ${ref} (${sha}).`);
}
