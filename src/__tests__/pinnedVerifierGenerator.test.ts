/**
 * scripts/generate-pinned-verifiers.mjs against a throwaway circuits
 * repository holding forge broadcast records: Deploy*Android scripts become
 * PINNED_VARIANT_VERIFIERS rows, nothing deployed is an empty row, scripts
 * the core does not pin are skipped, and anything unmapped or inconsistent
 * stops the generator.
 *
 * Every repository is built in two commits: first the verification keys and
 * toolchain.env, then the records, whose broadcasts name the first commit --
 * the key a verifier was built from is read at the commit its broadcast
 * records, as in the real circuits repository.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SDK_ROOT = resolve(__dirname, '../..');
const GENERATOR = join(SDK_ROOT, 'scripts/generate-pinned-verifiers.mjs');
/**
 * The throwaway repositories live under this repository's ignored
 * node_modules/.cache, not the system temp directory. In the shared temp
 * directory `git add` failed now and then -- "unable to create temporary file:
 * Invalid argument", and once "No such file or directory" -- also while this
 * file ran alone after every other file (vitest.config.ts `git-repos`), so
 * something outside the test run was reaching into that directory. Not
 * root-caused; see sdk-dev.md.
 */
const TEST_ROOT = join(SDK_ROOT, 'node_modules', '.cache', 'pinned-generator-tests');
mkdirSync(TEST_ROOT, { recursive: true });
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const address = (n: number) => '0x' + n.toString(16).padStart(40, '0');

/** Every package's key path, as core's circuits.ts names them. */
const VK_PATHS = [
  ...readFileSync(join(SDK_ROOT, 'packages/core/src/circuits.ts'), 'utf8').matchAll(/vkPath: '([^']+)', deployScriptName:/g),
].map(m => m[1]);
/** A key-sized blob whose bytes say which package and which build. */
const key = (path: string, build = 'one') => Buffer.alloc(1888, `${build}:${path}`);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const KEYS: Record<string, Buffer | string> = { ...Object.fromEntries(VK_PATHS.map(p => [p, key(p)])), 'toolchain.env': 'BB_VERSION=6.0.0\n' };
/** Stands for "the commit holding the keys" in a broadcast; replaced on write. */
const KEYS_COMMIT = '__KEYS_COMMIT__';

function broadcast(chain: number, addr: string, commit = KEYS_COMMIT, input?: string) {
  return JSON.stringify({
    transactions: [{ transactionType: 'CREATE', contractName: 'HonkVerifier', contractAddress: addr, ...(input ? { transaction: { input } } : {}) }],
    receipts: [{ contractAddress: addr, status: '0x1' }],
    chain,
    timestamp: 1798502400000,
    commit,
  });
}

/** An empty git repository and a way to commit files to it. */
function repo() {
  const dir = mkdtempSync(join(TEST_ROOT, 'pinned-gen-'));
  made.push(dir);
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  const commit = (files: Record<string, Buffer | string>, replace: Record<string, string> = {}): string => {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      let text = body;
      if (typeof text === 'string') for (const [from, to] of Object.entries(replace)) text = text.split(from).join(to);
      writeFileSync(join(dir, path), text);
    }
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'step');
    return git('rev-parse', 'HEAD').trim();
  };
  return { dir, git, commit };
}

/** Keys first, then `files` with KEYS_COMMIT naming that commit; returns the path. */
function circuitsRepo(files: Record<string, string>, keys: Record<string, Buffer | string> = KEYS): string {
  const r = repo();
  const keysCommit = r.commit(keys);
  r.commit(files, { [KEYS_COMMIT]: keysCommit });
  return r.dir;
}
const keysCommitOf = (dir: string) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();

function generate(repo: string, extra: string[] = []) {
  const out = join(repo, 'out.generated.ts');
  const run = spawnSync('node', [GENERATOR, '--circuits', repo, '--ref', 'HEAD', '--out', out, ...extra], {
    cwd: SDK_ROOT,
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, out, text: () => readFileSync(out, 'utf8') };
}

const STANDARD = {
  'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(1)),
  'broadcast/DeployCoinbaseAttestationV2.s.sol/84532/run-latest.json': broadcast(84532, address(2)),
};

describe('generate-pinned-verifiers.mjs', () => {
  it('no Android broadcast: the android row is empty and the standard rows are as before', () => {
    const r = generate(circuitsRepo(STANDARD));
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toContain(`84532: Object.freeze({ address: '${address(1)}'`);
    expect(text).toMatch(new RegExp(`coinbase_attestation: Object\\.freeze\\(\\{\\n {4}84532: Object\\.freeze\\(\\{ address: '${address(2)}'`));
    expect(text).toContain('export const PINNED_VARIANT_VERIFIERS');
    // Every circuit with an android package has a row, empty when nothing is deployed.
    const emptyRows = ['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation', 'giwa_attestation', 'dojang_playground']
      .map(id => `\\n {4}${id}: Object\\.freeze\\(\\{\\}\\),`)
      .join('');
    expect(text).toMatch(new RegExp(`android: Object\\.freeze\\(\\{${emptyRows}\\n {2}\\}\\),`));
    expect(text).toMatch(new RegExp(`android_factory: Object\\.freeze\\(\\{${emptyRows}\\n {2}\\}\\),`));
  });

  it('a DeployOidcDomainAttestationAndroid broadcast becomes an android row, not a standard one', () => {
    const repo = circuitsRepo({
      ...STANDARD,
      'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json': broadcast(84532, address(0xa1)),
      'broadcast/DeployOidcDomainAttestationAndroid.s.sol/11155111/run-latest.json': broadcast(11155111, address(0xa2)),
      'deployments/84532/OidcDomainAttestationAndroid.json': JSON.stringify({ address: address(0xa1) }),
    });
    const r = generate(repo);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    const [standardPart, variantPart] = text.split('export const PINNED_VARIANT_VERIFIERS');
    expect(standardPart).not.toContain(address(0xa1));
    const androidKey = sha256(key('oidc-domain-attestation-android/target/vk/vk'));
    expect(variantPart).toContain(
      `      84532: Object.freeze({ address: '${address(0xa1)}', deployedAt: '2026-12-29T00:00:00.000Z', circuitsCommit: '${keysCommitOf(repo)}', vkSha256: '${androidKey}', keyFrom: 'commit', record: 'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json' }),`,
    );
    expect(variantPart).toContain(`      11155111: Object.freeze({ address: '${address(0xa2)}'`);
    expect(variantPart).not.toContain(address(1));

    // --check accepts what it wrote, under another spelling of the same ref.
    const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const check = spawnSync('node', [GENERATOR, '--circuits', repo, '--ref', sha, '--out', r.out, '--check'], { cwd: SDK_ROOT, encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
  });

  it('a DeployOidcDomainAttestationAndroidFactory broadcast becomes an android_factory row only', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json': broadcast(84532, address(0xa1)),
      'broadcast/DeployOidcDomainAttestationAndroidFactory.s.sol/84532/run-latest.json': broadcast(84532, address(0xf1)),
      'deployments/84532/OidcDomainAttestationAndroidFactory.json': JSON.stringify({ address: address(0xf1) }),
    }));
    expect(r.status, r.stderr).toBe(0);
    const [, variants] = r.text().split('export const PINNED_VARIANT_VERIFIERS');
    const [androidPart, factoryPart] = variants.split('  android_factory: Object.freeze({');
    expect(androidPart).toContain(address(0xa1));
    expect(androidPart).not.toContain(address(0xf1));
    expect(factoryPart).toContain(`      84532: Object.freeze({ address: '${address(0xf1)}'`);
    expect(factoryPart).toContain('record: \'broadcast/DeployOidcDomainAttestationAndroidFactory.s.sol/84532/run-latest.json\'');
    expect(factoryPart).not.toContain(address(0xa1));
  });

  it('--check fails when an Android verifier was deployed after the table was written', () => {
    const before = generate(circuitsRepo(STANDARD));
    const after = circuitsRepo({
      ...STANDARD,
      'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json': broadcast(84532, address(0xa1)),
    });
    const check = spawnSync('node', [GENERATOR, '--circuits', after, '--ref', 'HEAD', '--out', before.out, '--check'], { cwd: SDK_ROOT, encoding: 'utf8' });
    expect(check.status).toBe(1);
    expect(check.stderr).toMatch(/is out of date/);
  });

  it('Coinbase KYC v2 pins its three packages; v1 (DeployCoinbaseAttestation) is not pinned', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployCoinbaseAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(0xc1)),
      'deployments/84532/CoinbaseAttestation.json': JSON.stringify({ address: address(0xc1) }),
      'broadcast/DeployCoinbaseAttestationV2Android.s.sol/84532/run-latest.json': broadcast(84532, address(0xb1)),
      'deployments/84532/CoinbaseAttestationV2Android.json': JSON.stringify({ address: address(0xb1) }),
      'broadcast/DeployCoinbaseAttestationV2AndroidFactory.s.sol/84532/run-latest.json': broadcast(84532, address(0xb2)),
      'deployments/84532/CoinbaseAttestationV2AndroidFactory.json': JSON.stringify({ address: address(0xb2) }),
    }));
    expect(r.status, r.stderr).toBe(0);
    const [standardPart, variants] = r.text().split('export const PINNED_VARIANT_VERIFIERS');
    const [androidPart, factoryPart] = variants.split('  android_factory: Object.freeze({');
    expect(r.text()).not.toContain(address(0xc1));
    expect(standardPart).toContain(address(2));
    expect(androidPart).toMatch(new RegExp(`coinbase_attestation: Object\\.freeze\\(\\{\\n {6}84532: Object\\.freeze\\(\\{ address: '${address(0xb1)}'`));
    expect(factoryPart).toMatch(new RegExp(`coinbase_attestation: Object\\.freeze\\(\\{\\n {6}84532: Object\\.freeze\\(\\{ address: '${address(0xb2)}'`));
    expect(androidPart).not.toContain(address(0xb2));
    expect(factoryPart).not.toContain(address(0xb1));
  });

  it('GIWA KYC and the Dojang Playground v2 pin their three packages each; v1 (DeployGiwaAttestation, DeployDojangPlayground) is not pinned', () => {
    const scripts = [
      ['GiwaAttestationV2', 0xd1], ['GiwaAttestationV2Android', 0xd2], ['GiwaAttestationV2AndroidFactory', 0xd3],
      ['DojangPlaygroundV2', 0xe1], ['DojangPlaygroundV2Android', 0xe2], ['DojangPlaygroundV2AndroidFactory', 0xe3],
    ] as const;
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': broadcast(91342, address(0xc1)),
      'deployments/91342/GiwaAttestation.json': JSON.stringify({ address: address(0xc1) }),
      'broadcast/DeployDojangPlayground.s.sol/91342/run-latest.json': broadcast(91342, address(0xc2)),
      'deployments/91342/DojangPlayground.json': JSON.stringify({ address: address(0xc2) }),
      ...Object.fromEntries(scripts.flatMap(([name, n]) => [
        [`broadcast/Deploy${name}.s.sol/91342/run-latest.json`, broadcast(91342, address(n))],
        [`deployments/91342/${name}.json`, JSON.stringify({ address: address(n) })],
      ])),
    }));
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).not.toContain(address(0xc1));
    expect(text).not.toContain(address(0xc2));
    const [standardPart, variants] = text.split('export const PINNED_VARIANT_VERIFIERS');
    const [androidPart, factoryPart] = variants.split('  android_factory: Object.freeze({');
    const row = (id: string, n: number, indent: number) =>
      new RegExp(`${id}: Object\\.freeze\\(\\{\\n {${indent}}91342: Object\\.freeze\\(\\{ address: '${address(n)}'`);
    expect(standardPart).toMatch(row('giwa_attestation', 0xd1, 4));
    expect(standardPart).toMatch(row('dojang_playground', 0xe1, 4));
    expect(androidPart).toMatch(row('giwa_attestation', 0xd2, 6));
    expect(androidPart).toMatch(row('dojang_playground', 0xe2, 6));
    expect(factoryPart).toMatch(row('giwa_attestation', 0xd3, 6));
    expect(factoryPart).toMatch(row('dojang_playground', 0xe3, 6));
    for (const [, n] of scripts) expect(text.split(address(n)).length - 1, address(n)).toBe(1);
  });

  it('an Android deploy script nobody mapped stops the generator, naming it', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployGiwaAttestationAndroid.s.sol/84532/run-latest.json': broadcast(84532, address(0xc1)),
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/deploy script 'GiwaAttestationAndroid' is not mapped to a circuit id/);
  });

  it('a deployments record disagreeing with the Android broadcast stops the generator', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json': broadcast(84532, address(0xa1)),
      'deployments/84532/OidcDomainAttestationAndroid.json': JSON.stringify({ address: address(0xdead) }),
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Fix the circuits records first/);
  });

  it('an Android deployments record with no broadcast behind it stops the generator', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'deployments/84532/OidcDomainAttestationAndroid.json': JSON.stringify({ address: address(0xa1) }),
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/has no broadcast record at broadcast\/DeployOidcDomainAttestationAndroid\.s\.sol\/84532/);
  });
});

/**
 * deployments/accepted-legacy-verifiers.json: superseded verifiers the
 * circuits repository still vouches for during a transition. Built as two
 * commits so the record can name the commit that holds the old key.
 */
describe('generate-pinned-verifiers.mjs: legacy verifiers', () => {
  const OLD = address(0xb1);
  const NEW = address(0xb2);
  const LEGACY_PATH = 'deployments/accepted-legacy-verifiers.json';

  const OIDC_VK = 'oidc-domain-attestation/target/vk/vk';

  /**
   * Three commits: the old OIDC key (written by bb `oldBb`), the new one, then
   * the deploy history -- OLD built at the first, NEW at the second -- and the
   * record from `entries(firstCommit)`.
   */
  function transitionRepo(entries: (vkRef: string) => unknown[], extra: Record<string, string> = {}, oldBb = '6.0.0') {
    const r = repo();
    const first = r.commit({ ...KEYS, [OIDC_VK]: key(OIDC_VK, 'old'), 'toolchain.env': `BB_VERSION=${oldBb}\n` });
    const second = r.commit({ [OIDC_VK]: key(OIDC_VK, 'new'), 'toolchain.env': 'BB_VERSION=6.0.0\n' });
    r.commit(
      {
        ...STANDARD,
        'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, NEW, second),
        'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-1773905216332.json': broadcast(84532, OLD, first),
        'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-1793249687144.json': broadcast(84532, NEW, second),
        [LEGACY_PATH]: JSON.stringify({ version: 1, entries: entries(first) }),
        ...extra,
      },
      { [KEYS_COMMIT]: first },
    );
    return { dir: r.dir, first, second };
  }
  const entry = (vkRef: string, over: Record<string, unknown> = {}) => ({
    script: 'OidcDomainAttestation', chainId: 84532, address: OLD, vkRef, acceptedUntil: '2027-01-31', reason: 'RSA limb fix transition', ...over,
  });

  it('no record: ACCEPTED_LEGACY_VERIFIERS is empty', () => {
    const r = generate(circuitsRepo(STANDARD));
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).toMatch(/export const ACCEPTED_LEGACY_VERIFIERS: readonly LegacyVerifier\[\] = Object\.freeze\(\[\n\]\);/);
  });

  it('a valid entry becomes a row, and the current row is the new deployment', () => {
    const { dir, first } = transitionRepo(v => [entry(v)]);
    const r = generate(dir);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toContain(`84532: Object.freeze({ address: '${NEW}'`);
    expect(text).toContain(
      `Object.freeze({ circuit: 'oidc_domain_attestation', variant: 'standard', chainId: 84532, address: '${OLD}', vkRef: '${first}', bbVersion: '6.0.0', acceptedUntil: '2027-01-31', reason: "RSA limb fix transition" }),`,
    );
  });

  it.each([
    ['an unmapped script', (v: string) => entry(v, { script: 'NotAScript' }), /script 'NotAScript' is not a pinned deploy script/],
    ['the current address', (v: string) => entry(v, { address: NEW }), /is the current OidcDomainAttestation verifier on chain 84532, not a legacy one/],
    ['an address no broadcast deployed', (v: string) => entry(v, { address: address(0xdead) }), /no broadcast under broadcast\/DeployOidcDomainAttestation\.s\.sol\/84532\/ deployed a HonkVerifier/],
    ['a chain with no current verifier', (v: string) => entry(v, { chainId: 8453 }), /has no current verifier on chain 8453/],
    ['a bad date', (v: string) => entry(v, { acceptedUntil: '2027-13-01x' }), /acceptedUntil '2027-13-01x' is not a YYYY-MM-DD date/],
    ['no reason', (v: string) => entry(v, { reason: '  ' }), /a reason is required/],
    ['a short vkRef', (v: string) => entry(v, { vkRef: v.slice(0, 7) }), /vkRef must be a full 40-hex circuits commit/],
    ['a vkRef without the key', () => entry('0'.repeat(40)), /does not exist at circuits 0{40}/],
  ])('refuses %s', (_name, make, message) => {
    const { dir } = transitionRepo(v => [make(v)]);
    const r = generate(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
  });

  it('refuses a duplicate entry', () => {
    const { dir } = transitionRepo(v => [entry(v), entry(v)]);
    const r = generate(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/duplicate entry for OidcDomainAttestation\/84532/);
  });

  it('refuses an unknown record version', () => {
    const dir = circuitsRepo({ ...STANDARD, [LEGACY_PATH]: JSON.stringify({ version: 2, entries: [] }) });
    const r = generate(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/version must be 1, got 2/);
  });
});

/**
 * Verification keys: each package's sha256, the commit they are fetched at,
 * the bb that wrote them, and the verifiers built from a key that is no
 * longer current -- left out of the pinned tables and listed as awaiting a
 * redeploy.
 */
describe('generate-pinned-verifiers.mjs: keys and redeploys', () => {
  const OIDC_VK = 'oidc-domain-attestation/target/vk/vk';
  const headOf = (dir: string) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  /** The generator in --worktree mode, which takes no --ref. */
  const generateWorktree = (dir: string, extra: string[] = []) => {
    const out = join(dir, 'out.generated.ts');
    const run = spawnSync('node', [GENERATOR, '--circuits', dir, '--worktree', '--out', out, ...extra], { cwd: SDK_ROOT, encoding: 'utf8' });
    return { status: run.status, stderr: run.stderr, text: () => readFileSync(out, 'utf8') };
  };

  it("records every package's key sha256, the source commit as the fetch ref, and the bb", () => {
    const dir = circuitsRepo(STANDARD);
    const r = generate(dir);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toContain("export const VERIFICATION_KEY_BB_VERSION = '6.0.0';");
    expect(text).toContain(`export const VERIFICATION_KEYS_REF: string | null = '${headOf(dir)}';`);
    for (const path of VK_PATHS) expect(text).toContain(`sha256: '${sha256(key(path))}', path: '${path}' }),`);
    expect(text).toContain(`vkSha256: '${sha256(key(OIDC_VK))}'`);
    expect(text).toMatch(/export const AWAITING_REDEPLOY: readonly AwaitingRedeploy\[\] = Object\.freeze\(\[\n\]\);/);
  });

  it('a verifier built from a superseded key is not pinned; it is listed as awaiting a redeploy', () => {
    const r0 = repo();
    const keysCommit = r0.commit(KEYS);
    r0.commit(
      {
        ...STANDARD,
        'deployments/84532/OidcDomainAttestation.json': JSON.stringify({ address: address(1) }),
      },
      { [KEYS_COMMIT]: keysCommit },
    );
    r0.commit({ [OIDC_VK]: key(OIDC_VK, 'rebuilt'), 'toolchain.env': 'BB_VERSION=7.0.0\n' });
    const r = generate(r0.dir);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    const [pinnedPart] = text.split('export const AWAITING_REDEPLOY');
    expect(pinnedPart).not.toContain(`address: '${address(1)}'`);
    expect(pinnedPart).toContain(`address: '${address(2)}'`);
    expect(text).toContain(
      `  Object.freeze({ circuit: 'oidc_domain_attestation', variant: 'standard', chainId: 84532, previousAddress: '${address(1)}', previousVkSha256: '${sha256(key(OIDC_VK))}', record: 'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json' }),`,
    );
    expect(text).toContain(`sha256: '${sha256(key(OIDC_VK, 'rebuilt'))}', path: '${OIDC_VK}'`);
    expect(text).toContain("export const VERIFICATION_KEY_BB_VERSION = '7.0.0';");
  });

  /** Creation code holding every word of `vk` as a PUSH constant, between filler bytes. */
  const initcodeWith = (vk: Buffer) => {
    const parts: Buffer[] = [Buffer.from('6080604052', 'hex')];
    for (let i = 0; i < vk.length; i += 32) {
      const word = vk.subarray(i, i + 32);
      let start = 0;
      while (start < 32 && word[start] === 0) start++;
      if (start === 32) continue;
      parts.push(Buffer.from([0x5f + 32 - start]), word.subarray(start), Buffer.from('50', 'hex'));
    }
    return '0x' + Buffer.concat(parts).toString('hex');
  };
  /** Keys committed AFTER the deployment, as on 2026-11-27: the broadcast names the commit before them. */
  function deployedBeforeKeys(input: string | undefined, keys: Record<string, Buffer | string> = KEYS) {
    const r0 = repo();
    const before = r0.commit({ 'README.md': 'before the keys\n' });
    const keysCommit = r0.commit(keys);
    r0.commit({
      'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(1), before, input),
      'broadcast/DeployCoinbaseAttestationV2.s.sol/84532/run-latest.json': broadcast(84532, address(2)),
    }, { [KEYS_COMMIT]: keysCommit });
    return r0.dir;
  }

  it("a key not committed at the deployment's commit is established from the creation code, and the row says so", () => {
    const dir = deployedBeforeKeys(initcodeWith(key(OIDC_VK)));
    const r = generate(dir);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toMatch(new RegExp(`84532: Object\\.freeze\\(\\{ address: '${address(1)}', deployedAt: '[^']+', circuitsCommit: '[0-9a-f]{40}', vkSha256: '${sha256(key(OIDC_VK))}', keyFrom: 'initcode', record: `));
    expect(text).toMatch(new RegExp(`address: '${address(2)}', [^\\n]*keyFrom: 'commit'`));
  });

  it('a word of the key with leading zero bytes is matched as the shorter PUSH solc writes', () => {
    const vk = Buffer.from(key(OIDC_VK));
    vk.fill(0, 0, 31); // word 0 = 0x...01: PUSH1 0x01
    vk.fill(0, 32, 64); // word 1 = zero: no constant needed
    const keys = { ...KEYS, [OIDC_VK]: vk };
    const r = generate(deployedBeforeKeys(initcodeWith(vk), keys));
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).toContain(`vkSha256: '${sha256(vk)}', keyFrom: 'initcode'`);
  });

  it('a creation code missing one word of the current key stops the generator, naming the word', () => {
    // key() repeats its text, so its words repeat too: build one whose 59 words all differ.
    const vk = Buffer.concat(Array.from({ length: 59 }, (_, i) => createHash('sha256').update(`word ${i}`).digest()));
    const other = Buffer.from(vk);
    other.fill(7, 32 * 5, 32 * 6);
    const r = generate(deployedBeforeKeys(initcodeWith(other), { ...KEYS, [OIDC_VK]: vk }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/lacks 1 word\(s\) of the current key \(first: word 5\), so the key this verifier was built from is unknown/);
  });

  it("another package's creation code stops the generator", () => {
    const r = generate(deployedBeforeKeys(initcodeWith(key('coinbase-attestation-v2/target/vk/vk'))));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/lacks 59 word\(s\) of the current key/);
  });

  it.each([['no creation code', undefined], ['not hex', '0xzz'], ['odd hex', '0xabc']])('%s with no key at the commit stops the generator', (_name, input) => {
    const r = generate(deployedBeforeKeys(input));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/and the verifier's creation code is not in the broadcast, so the key this verifier was built from is unknown/);
  });

  it('a key committed at the deployment decides even when the creation code holds the current key (the commit is never overruled)', () => {
    const r0 = repo();
    const keysCommit = r0.commit(KEYS);
    r0.commit(
      { ...STANDARD, 'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(1), KEYS_COMMIT, initcodeWith(key(OIDC_VK, 'rebuilt'))) },
      { [KEYS_COMMIT]: keysCommit },
    );
    r0.commit({ [OIDC_VK]: key(OIDC_VK, 'rebuilt') });
    const r = generate(r0.dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).toContain(`previousAddress: '${address(1)}', previousVkSha256: '${sha256(key(OIDC_VK))}'`);
  });

  it('a broadcast whose commit cannot be read stops the generator: the key behind the contract is unknown', () => {
    const r = generate(circuitsRepo({
      'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(1), 'abc1234'),
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cannot read oidc-domain-attestation\/target\/vk\/vk at the deployment's circuits commit 'abc1234'/);
  });

  it.each([
    ['no toolchain.env', { ...KEYS, 'toolchain.env': undefined }, /has no toolchain\.env/],
    ['no BB_VERSION line', { ...KEYS, 'toolchain.env': 'NARGO_VERSION=1.0.0\n' }, /has no BB_VERSION= line/],
    ['a missing key', { ...KEYS, [OIDC_VK]: undefined }, /oidc-domain-attestation\/target\/vk\/vk \(the oidc_domain_attestation 'standard' verification key\) does not exist/],
    ['a key too small to be one', { ...KEYS, [OIDC_VK]: 'tiny' }, /is 4 bytes, far too small/],
  ])('refuses %s', (_name, keys, message) => {
    const present = Object.fromEntries(Object.entries(keys).filter(([, v]) => v !== undefined)) as Record<string, Buffer | string>;
    const r = generate(circuitsRepo(STANDARD, present));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
  });

  it('--worktree: an uncommitted rebuilt key is recorded with no fetch ref, and its verifier awaits a redeploy', () => {
    const dir = circuitsRepo(STANDARD);
    writeFileSync(join(dir, OIDC_VK), key(OIDC_VK, 'rebuilt'));
    const r = generateWorktree(dir);
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toContain('export const VERIFICATION_KEYS_REF: string | null = null;');
    expect(text).toContain(`sha256: '${sha256(key(OIDC_VK, 'rebuilt'))}', path: '${OIDC_VK}'`);
    expect(text).toContain(`previousAddress: '${address(1)}'`);
    expect(text).toMatch(/\/\/ Source: zkproofport\/circuits [0-9a-f]{40} \(working tree\)/);
  });

  it('--worktree on a clean checkout records HEAD as the fetch ref', () => {
    const dir = circuitsRepo(STANDARD);
    const r = generateWorktree(dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).toContain(`export const VERIFICATION_KEYS_REF: string | null = '${headOf(dir)}';`);
  });

  it('--worktree refuses a --ref', () => {
    const both = generateWorktree(circuitsRepo(STANDARD), ['--ref', 'HEAD']);
    expect(both.status).not.toBe(0);
    expect(both.stderr).toMatch(/--worktree reads the circuits working tree over HEAD; it takes no --ref/);
  });
});

describe('generate-pinned-verifiers.mjs: legacy keys across a toolchain change', () => {
  const OLD = address(0xb1);
  const NEW = address(0xb2);
  const LEGACY_PATH = 'deployments/accepted-legacy-verifiers.json';
  const OIDC_VK = 'oidc-domain-attestation/target/vk/vk';
  const entry = (vkRef: string) => ({ script: 'OidcDomainAttestation', chainId: 84532, address: OLD, vkRef, acceptedUntil: '2027-01-31', reason: 'toolchain upgrade' });

  function twoToolchains(oldToolchain: string | undefined) {
    const r = repo();
    const oldKeys: Record<string, Buffer | string> = { ...KEYS, [OIDC_VK]: key(OIDC_VK, 'old') };
    if (oldToolchain === undefined) delete oldKeys['toolchain.env'];
    else oldKeys['toolchain.env'] = oldToolchain;
    const first = r.commit(oldKeys);
    const second = r.commit({ ...KEYS, [OIDC_VK]: key(OIDC_VK, 'new') });
    r.commit({
      ...STANDARD,
      'broadcast/DeployCoinbaseAttestationV2.s.sol/84532/run-latest.json': broadcast(84532, address(2), second),
      'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json': broadcast(84532, NEW, second),
      'broadcast/DeployOidcDomainAttestation.s.sol/84532/run-1.json': broadcast(84532, OLD, first),
      [LEGACY_PATH]: JSON.stringify({ version: 1, entries: [entry(first)] }),
    });
    return { dir: r.dir, first };
  }

  it("records the bb that wrote the legacy key, from toolchain.env at its vkRef", () => {
    const { dir, first } = twoToolchains('BB_VERSION=4.2.0-aztecnr-rc.2\n');
    const r = generate(dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).toContain(`vkRef: '${first}', bbVersion: '4.2.0-aztecnr-rc.2', acceptedUntil: '2027-01-31'`);
  });

  it('refuses a vkRef with no toolchain.env: which bb wrote it is unknown', () => {
    const { dir, first } = twoToolchains(undefined);
    const r = generate(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(new RegExp(`circuits ${first} has no toolchain\\.env; cannot tell which bb wrote its key`));
  });
});
