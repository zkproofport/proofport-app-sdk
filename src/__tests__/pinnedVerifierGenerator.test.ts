/**
 * scripts/generate-pinned-verifiers.mjs against a throwaway circuits
 * repository holding forge broadcast records: Deploy*Android scripts become
 * PINNED_VARIANT_VERIFIERS rows, nothing deployed is an empty row, scripts
 * the core does not pin are skipped, and anything unmapped or inconsistent
 * stops the generator.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SDK_ROOT = resolve(__dirname, '../..');
const GENERATOR = join(SDK_ROOT, 'scripts/generate-pinned-verifiers.mjs');
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const address = (n: number) => '0x' + n.toString(16).padStart(40, '0');

function broadcast(chain: number, addr: string) {
  return JSON.stringify({
    transactions: [{ transactionType: 'CREATE', contractName: 'HonkVerifier', contractAddress: addr }],
    receipts: [{ contractAddress: addr, status: '0x1' }],
    chain,
    timestamp: 1798502400000,
    commit: 'abc1234',
  });
}

/** A git repository with the given files committed; returns its path. */
function circuitsRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pinned-gen-'));
  made.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'records');
  return dir;
}

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
  'broadcast/DeployCoinbaseAttestation.s.sol/84532/run-latest.json': broadcast(84532, address(2)),
};

describe('generate-pinned-verifiers.mjs', () => {
  it('no Android broadcast: the android row is empty and the standard rows are as before', () => {
    const r = generate(circuitsRepo(STANDARD));
    expect(r.status, r.stderr).toBe(0);
    const text = r.text();
    expect(text).toContain(`84532: Object.freeze({ address: '${address(1)}'`);
    expect(text).toContain('export const PINNED_VARIANT_VERIFIERS');
    expect(text).toMatch(/android: Object\.freeze\(\{\n {4}oidc_domain_attestation: Object\.freeze\(\{\}\),\n {2}\}\),/);
    expect(text).toMatch(/android_factory: Object\.freeze\(\{\n {4}oidc_domain_attestation: Object\.freeze\(\{\}\),\n {2}\}\),/);
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
    expect(variantPart).toContain(
      `      84532: Object.freeze({ address: '${address(0xa1)}', deployedAt: '2026-12-29T00:00:00.000Z', circuitsCommit: 'abc1234', record: 'broadcast/DeployOidcDomainAttestationAndroid.s.sol/84532/run-latest.json' }),`,
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

  it('CoinbaseAttestationV2Android and ...AndroidFactory are not pinned by this core', () => {
    const r = generate(circuitsRepo({
      ...STANDARD,
      'broadcast/DeployCoinbaseAttestationV2Android.s.sol/84532/run-latest.json': broadcast(84532, address(0xb1)),
      'deployments/84532/CoinbaseAttestationV2Android.json': JSON.stringify({ address: address(0xb1) }),
      'broadcast/DeployCoinbaseAttestationV2AndroidFactory.s.sol/84532/run-latest.json': broadcast(84532, address(0xb2)),
      'deployments/84532/CoinbaseAttestationV2AndroidFactory.json': JSON.stringify({ address: address(0xb2) }),
    }));
    expect(r.status, r.stderr).toBe(0);
    expect(r.text()).not.toContain(address(0xb1));
    expect(r.text()).not.toContain(address(0xb2));
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
