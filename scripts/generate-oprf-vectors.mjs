#!/usr/bin/env node
/**
 * Writes the two files core's OPRF client (packages/core/src/oprf/) is held to:
 *
 *   packages/core/src/oprf/poseidon2Constants.generated.ts
 *       BN254 Poseidon2 round constants and internal diagonals for widths 3, 4
 *       and 16, parsed from the Noir library the circuits prove with
 *       (circuits/deps/noir-poseidon/poseidon2/src/bn254/consts.nr). Not
 *       copied by hand: a typo in one of ~360 constants would give another
 *       hash that still looks like one.
 *
 *   src/__tests__/fixtures/oprf-vectors.json
 *       Vectors from implementations that are NOT core's:
 *         - evaluations: circuits/scripts/oprf-nullifier's `oprf-fixture values`
 *           (TACEO's crates: taceo-oprf-core 0.6.3, taceo-poseidon2 0.3.1),
 *           which also checks each answer with taceo-oprf-core's own client;
 *         - names and digests: proofport-oprf's `oprf reduce` / `oprf digest`
 *           (the node's src/auth.rs: check_name, reduce_name, request_digest),
 *           digests also compared with ethers' TypedDataEncoder here;
 *         - kats: the known-answer tests of TaceoLabs/oprf-nr v2.0.0
 *           (circuits/deps/oprf-nr), copied with their file names;
 *         - network: one answer from TACEO's public test network, recorded by
 *           proofport-oprf's taceo_testnet client (`--taceo-record <file>`
 *           replaces it; otherwise the recorded one is kept as is).
 *
 *   node scripts/generate-oprf-vectors.mjs                 # rewrite both
 *   node scripts/generate-oprf-vectors.mjs --check         # exit 1 if either is stale
 *   node scripts/generate-oprf-vectors.mjs --taceo-record <values.json>
 *
 * Recording a network answer (public test key from the README of
 * github.com/TaceoLabs/oprf-testnet; a random address, nothing about a user):
 *   TACEO_TESTNET_API_KEY=<key> proofport-oprf/target/release/taceo_testnet \
 *     --address <random> --domain-name zkproofport.app --scope-name '<s>' --out <values.json>
 *
 * After a rewrite, copy oprf-vectors.json byte for byte to the repositories
 * that carry an OPRF client (proofport-app, proofport-ai), as for
 * signal-hash-vectors.json.
 *
 * Prerequisites: node >= 20, `npm install` here (ethers), Rust (cargo at
 * $HOME/.cargo/bin/cargo or $CARGO) to build the two Rust tools, the circuits
 * and proofport-oprf checkouts in the parent repository.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const args = process.argv.slice(2);
const check = args.includes('--check');
const recordAt = args.indexOf('--taceo-record');
const recordFile = recordAt === -1 ? undefined : args[recordAt + 1];
if (recordAt !== -1 && (!recordFile || recordFile.startsWith('--'))) throw new Error('--taceo-record needs a file');
if (check && recordFile) throw new Error('--check compares; it takes no --taceo-record');

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const sdkRoot = git(process.cwd(), 'rev-parse', '--show-toplevel');
const repo = git(process.cwd(), 'rev-parse', '--show-superproject-working-tree') || sdkRoot;
const CIRCUITS = join(repo, 'circuits');
const OPRF_SERVICE = join(repo, 'proofport-oprf');
for (const dir of [CIRCUITS, OPRF_SERVICE]) {
  if (!existsSync(dir)) throw new Error(`No checkout at ${dir}; this script needs the parent repository's circuits and proofport-oprf.`);
}
const CONSTS_OUT = join(sdkRoot, 'packages/core/src/oprf/poseidon2Constants.generated.ts');
const VECTORS_OUT = join(sdkRoot, 'src/__tests__/fixtures/oprf-vectors.json');

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const R = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
const hex32 = v => '0x' + v.toString(16).padStart(64, '0');

// ---- Poseidon2 constants ----------------------------------------------------

const CONSTS_NR = 'deps/noir-poseidon/poseidon2/src/bn254/consts.nr';
const constsText = readFileSync(join(CIRCUITS, CONSTS_NR), 'utf8');

function hexesIn(text) {
  return [...text.matchAll(/0x[0-9a-fA-F]+/g)].map(m => hex32(BigInt(m[0])));
}

function config(width, partialRounds) {
  const start = constsText.indexOf(`fn x5_${width}_config()`);
  if (start === -1) throw new Error(`${CONSTS_NR}: no x5_${width}_config`);
  const next = constsText.indexOf('fn x5_', start + 10);
  const diagAt = constsText.indexOf('pub global internal_diag', start);
  const end = Math.min(...[next, diagAt].filter(i => i !== -1));
  const values = hexesIn(constsText.slice(start, end));
  const want = 8 * width + partialRounds;
  if (values.length !== want) throw new Error(`x5_${width}_config: ${values.length} constants, expected ${want}`);
  const rows = (from, n) => Array.from({ length: n }, (_, i) => values.slice(from + i * width, from + (i + 1) * width));
  return {
    firstFull: rows(0, 4),
    partial: values.slice(4 * width, 4 * width + partialRounds),
    secondFull: rows(4 * width + partialRounds, 4),
  };
}

function diag(width) {
  const m = constsText.match(new RegExp(`pub global internal_diag${width}: \\[Field; ${width}\\] = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${CONSTS_NR}: no internal_diag${width}`);
  const values = hexesIn(m[1]);
  if (values.length !== width) throw new Error(`internal_diag${width}: ${values.length} values`);
  return values;
}

const poseidon = {
  t3: { ...config(3, 56), diag: null },
  t4: { ...config(4, 56), diag: diag(4) },
  t16: { ...config(16, 57), diag: diag(16) },
};

const constsTs =
  `// GENERATED by scripts/generate-oprf-vectors.mjs from circuits/${CONSTS_NR}\n` +
  '// (the Noir Poseidon2 the circuits prove with). Do not edit.\n' +
  '//\n' +
  '// Width 3 uses the [1, 1, 2] internal matrix (no diagonal table), widths 4\n' +
  '// and 16 the diagonals below. Every value is below the BN254 scalar field.\n\n' +
  'export interface Poseidon2Params {\n' +
  '  readonly firstFull: readonly (readonly string[])[];\n' +
  '  readonly partial: readonly string[];\n' +
  '  readonly secondFull: readonly (readonly string[])[];\n' +
  '  readonly diag: readonly string[] | null;\n' +
  '}\n\n' +
  Object.entries(poseidon).map(([name, p]) =>
    `export const POSEIDON2_${name.toUpperCase()}: Poseidon2Params = ${JSON.stringify(p, null, 2).replace(/"/g, "'")};\n`,
  ).join('\n');

// ---- Rust oracles ------------------------------------------------------------

const CARGO = process.env.CARGO ?? join(process.env.HOME ?? '', '.cargo/bin/cargo');
execFileSync(join(CIRCUITS, 'scripts/oprf-nullifier/build-tool.sh'), { stdio: ['ignore', 'ignore', 'inherit'] });
execFileSync(CARGO, ['build', '--release', '-q', '--bin', 'oprf'], { cwd: OPRF_SERVICE, stdio: ['ignore', 'ignore', 'inherit'] });
const FIXTURE_TOOL = join(CIRCUITS, 'scripts/oprf-nullifier/target/release/oprf-fixture');
const NODE_TOOL = join(OPRF_SERVICE, 'target/release/oprf');

const constants = Object.fromEntries(
  readFileSync(join(CIRCUITS, 'scripts/oprf-nullifier/constants.sh'), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => l.split('=')),
);
const reduce = s => hex32(BigInt(ethers.keccak256(ethers.toUtf8Bytes(s))) % P);
// The same per-circuit test keys as circuits/scripts/oprf-nullifier/oprf.js.
const fixtureKey = id => hex32(BigInt(ethers.keccak256(ethers.toUtf8Bytes(`ZKProofport OPRF fixture key/${id}`))) % R);

function evaluate(note, { address, domain, scope, key, beta, seed = 1 }) {
  const out = JSON.parse(execFileSync(FIXTURE_TOOL, [
    'values', '--address', address, '--domain', domain, '--scope', scope, '--key', key, '--beta', beta, '--seed', String(seed),
  ], { encoding: 'utf8' }));
  return {
    note,
    address: out.address,
    domain: out.domain,
    scope: out.scope,
    secretKey: key,
    beta: out.oprf_beta,
    query: out.query,
    publicKey: { x: out.oprf_public_key_x, y: out.oprf_public_key_y },
    keyHash: out.oprf_key_hash,
    blindedQuery: { x: out.blinded_x, y: out.blinded_y },
    blindedResponse: { x: out.response_blinded_x, y: out.response_blinded_y },
    dlogE: out.oprf_dlog_e,
    dlogS: out.oprf_dlog_s,
    response: { x: out.oprf_response_x, y: out.oprf_response_y },
    nullifier: out.nullifier,
  };
}

const ANVIL0 = constants.FIXTURE_ADDRESS;
const evaluations = [
  evaluate('circuits fixture (constants.sh): anvil account 0, TACEO test key and beta, zkproofport.app / oprf-fixture', {
    address: ANVIL0, domain: constants.FIXTURE_DOMAIN, scope: constants.FIXTURE_SCOPE, key: constants.FIXTURE_KEY, beta: constants.FIXTURE_BETA,
  }),
  evaluate('same wallet, domain and scope under the second test key', {
    address: ANVIL0, domain: constants.FIXTURE_DOMAIN, scope: constants.FIXTURE_SCOPE, key: constants.FIXTURE_OTHER_KEY, beta: constants.FIXTURE_BETA,
  }),
  evaluate('domain and scope swapped', {
    address: ANVIL0, domain: constants.FIXTURE_SCOPE, scope: constants.FIXTURE_DOMAIN, key: constants.FIXTURE_KEY, beta: constants.FIXTURE_BETA,
  }),
  evaluate('another blinding (beta = 1): same nullifier as the first', {
    address: ANVIL0, domain: constants.FIXTURE_DOMAIN, scope: constants.FIXTURE_SCOPE, key: constants.FIXTURE_KEY, beta: hex32(1n),
  }),
  evaluate('beta = r - 1', {
    address: ANVIL0, domain: constants.FIXTURE_DOMAIN, scope: constants.FIXTURE_SCOPE, key: constants.FIXTURE_KEY, beta: hex32(R - 1n),
  }),
  evaluate('zero address, domain 0, scope p - 1', {
    address: '0x' + '00'.repeat(20), domain: hex32(0n), scope: hex32(P - 1n), key: constants.FIXTURE_KEY, beta: constants.FIXTURE_BETA,
  }),
  evaluate('all-ones address, domain p - 1, scope 0', {
    address: '0x' + 'ff'.repeat(20), domain: hex32(P - 1n), scope: hex32(0n), key: constants.FIXTURE_KEY, beta: constants.FIXTURE_BETA,
  }),
  evaluate('Korean and emoji scope name, key r - 1', {
    address: ANVIL0, domain: reduce('zkproofport.app'), scope: reduce('투표 2026 🗳️'), key: hex32(R - 1n), beta: constants.FIXTURE_BETA, seed: 7,
  }),
  ...['coinbase_attestation', 'coinbase_country_attestation', 'giwa_attestation', 'dojang_playground', 'human_passport_score'].map(id =>
    evaluate(`circuits fixture key for ${id} (oprf.js fixtureKey)`, {
      address: ANVIL0, domain: constants.FIXTURE_DOMAIN, scope: constants.FIXTURE_SCOPE, key: fixtureKey(id), beta: constants.FIXTURE_BETA,
    }),
  ),
];

// The library's own Noir test vectors must come out of the same tool.
const first = evaluations[0];
if (first.nullifier !== '0x15badbab3c5cf2c114f5801e253d7a9c18c3d3eac3bfb12eab6bb1d00cd63655' ||
    first.keyHash !== '0x013f6250e42223259e528bc5a1bafb66543e5606ad1edefa3596327238427def') {
  throw new Error('oprf-fixture no longer reproduces circuits/oprf-nullifier-libs/src/test_vectors.nr');
}
if (evaluations[3].nullifier !== first.nullifier) throw new Error('another blinding gave another nullifier');

function nodeVerdict(...cmd) {
  try {
    return { ok: true, out: execFileSync(NODE_TOOL, cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    const m = String(error.stderr).match(/: (Empty|TooLong|ControlCharacter|FormatCharacter)\b/);
    if (!m) throw new Error(`oprf ${cmd.join(' ')} failed unexpectedly: ${error.stderr}`);
    return { ok: false, out: m[1] };
  }
}
const VERDICT = { Empty: 'empty', TooLong: 'too-long', ControlCharacter: 'control-character', FormatCharacter: 'format-character' };

// Names the node itself judges (argv cannot carry NUL or a lone surrogate;
// those two are under jsOnlyNames, judged by the rule in REQUEST-VERIFIER.md).
const nameCases = [
  ['the fixture domain', 'zkproofport.app'],
  ['a scope', 'community-vote-2026'],
  ['one byte', 'a'],
  ['a single space (not Cc / Cf: accepted)', ' '],
  ['spaces around (no trimming)', '  zkproofport.app  '],
  ['empty', ''],
  ['256 ASCII bytes', 'a'.repeat(256)],
  ['257 ASCII bytes', 'a'.repeat(257)],
  ['85 Hangul syllables = 255 bytes', '가'.repeat(85)],
  ['86 Hangul syllables = 258 bytes', '가'.repeat(86)],
  ['64 four-byte emoji = 256 bytes', '🔐'.repeat(64)],
  ['65 four-byte emoji = 260 bytes', '🔐'.repeat(65)],
  ['Korean and emoji', '한국어 도메인'],
  ['regional-indicator flag', '🇰🇷'],
  ['variation selector', '❤️'],
  ['zero-width joiner emoji (Cf)', '👩‍💻'],
  ['tab (Cc)', 'a\tb'],
  ['newline (Cc)', 'a\nb'],
  ['DEL (Cc)', 'a\u007fb'],
  ['C1 control U+0085 (Cc)', 'a\u0085b'],
  ['U+009F (Cc, last C1)', 'a\u009fb'],
  ['U+00A0 no-break space (Zs: accepted)', 'a b'],
  ['soft hyphen (Cf)', 'a­b'],
  ['right-to-left override (Cf)', 'a‮b'],
  ['zero-width space (Cf)', 'a​b'],
  ['BOM (Cf)', '﻿a'],
  ['tag character (Cf)', 'a\u{e0041}'],
  ['SQL / wildcard / markup text', "%_\\' OR 1=1; <script>x</script>"],
  ['NFC e-acute', 'é'],
  ['NFD e + combining acute (another name)', 'é'],
];
const names = nameCases.map(([note, name]) => {
  const v = nodeVerdict('reduce', '--name', name);
  if (v.ok && v.out !== reduce(name)) throw new Error(`node and ethers disagree on reduce(${JSON.stringify(name)})`);
  return { note, name, verdict: v.ok ? null : VERDICT[v.out], reduced: v.ok ? v.out : null };
});
const jsOnlyNames = [
  { note: 'NUL (Cc; argv cannot carry it)', name: 'a\u0000b', verdict: 'control-character' },
  { note: 'lone high surrogate (no UTF-8 form)', name: 'a\ud800b', verdict: 'not-utf8' },
  { note: 'lone low surrogate (no UTF-8 form)', name: '\udc00', verdict: 'not-utf8' },
];

const digestCases = [
  ['zkproofport.app', 'e2e-scope', 2000000000],
  ['한국어 도메인', '🔐 scope 🦀', 0],
  ['zkproofport.app', 'community-vote-2026', 1794912700],
  ['a', 'b', 1],
  ['a'.repeat(256), '🔐'.repeat(64), 4102444800],
];
const EIP712_DOMAIN = { name: 'TACEO:OPRF', version: '1' };
const TYPES = { OprfRequest: [
  { name: 'statement', type: 'string' }, { name: 'domainName', type: 'string' },
  { name: 'scopeName', type: 'string' }, { name: 'deadline', type: 'uint256' },
] };
const digests = digestCases.map(([domainName, scopeName, deadline]) => {
  const v = nodeVerdict('digest', '--domain-name', domainName, '--scope-name', scopeName, '--deadline', String(deadline));
  if (!v.ok) throw new Error(`node refused a digest case: ${v.out}`);
  const viaEthers = ethers.TypedDataEncoder.hash(EIP712_DOMAIN, TYPES, { statement: 'TACEO:OPRF Request', domainName, scopeName, deadline });
  if (viaEthers !== v.out) throw new Error(`node and ethers disagree on the digest of ${domainName} / ${scopeName} / ${deadline}`);
  return { domainName, scopeName, deadline, digest: v.out };
});
// REQUEST-VERIFIER.md publishes three of these; a change here would break every node.
const published = {
  domainOfZkproofportApp: '0x18710bf90bfc93f0c5e493223ae90dd38acb94ecce696da5005658255fed19cc',
  digestE2e: '0x91cf9f764efd834900180e9e893f086af4539a44b1506082ec6b7165539918a9',
  digestKorean: '0x5cd214510235f73085b36ca64e8bddcd96b84042d87a7e4d94630e0b11fa7d6e',
};
if (names[0].reduced !== published.domainOfZkproofportApp || digests[0].digest !== published.digestE2e || digests[1].digest !== published.digestKorean) {
  throw new Error('the node no longer reproduces the vectors REQUEST-VERIFIER.md publishes');
}

// ---- oprf-nr v2.0.0 known-answer tests (circuits/deps/oprf-nr) --------------

const kats = {
  source: 'TaceoLabs/oprf-nr v2.0.0, vendored at circuits/deps/oprf-nr (MIT); each value copied from the named #[test]',
  encodeToCurve: [
    { test: 'babyjubjub/src/hash_to_curve.nr test_encode_to_curve_kat0', input: '0x03e4070110668921a99c37627dedddb5ab65fae33c19e24d9ee19d7065fdeca8',
      x: '10317659717708787122683977912952208883341451354299498236440964928299898571531', y: '2771878628977713302835201233169750856073682825638128695522023521672351725258' },
    { test: 'babyjubjub/src/hash_to_curve.nr test_encode_to_curve_kat1', input: '0x42',
      x: '16453178030699411958341692808730701741568100876455568813278163225032347056514', y: '5447922750205248208490261749483809853022174346498064122782172531486866662376' },
    { test: 'babyjubjub/src/hash_to_curve.nr test_encode_to_curve_kat2', input: '0x0',
      x: '16605852874433019712683889710166313607515083375138125349412270828059484170936', y: '12075050546928691602283582412953179086742727007172364313655633055645374686589' },
  ],
  blindedQuery: {
    test: 'oprf/src/blinded_query.nr oprf_query_kat_test',
    beta: '1219447978145766874721695300216900264892278162307712369438981445355514609028',
    query: '387242419257851558984914892096106188402994395767663340643461644969954908901',
    x: '9674018812144873985515234638873635008708834681175738612597888298086191498827',
    y: '18818965079786157878748649151755578492493325229415754584538271947197071123195',
  },
  dlog: {
    test: 'oprf/src/dlog.nr test_verify_dlog_equality',
    e: '5609293693019386176508931649877337091590878173635241438306548223920379307458',
    s: '1167493435914595771361530871033173621661932035514996719837354510862251986174',
    publicKey: { x: '16048296497646113681290127133582586009660277510307938775951186660467382774945', y: '13451097916688865791218925679662796109386737920791997438101375513111619197164' },
    blindedQuery: { x: '0x2003f27260a0b5ee81b84f66f8bf2761ea9557262a4bcd16db5ca7abdeee1885', y: '0x1eb45d38c97f7e65ac1b76d234db3237d2860f2b25c43e020693ef92b5a5f793' },
    blindedResponse: { x: '6882462243439192795495492197995100450516328082301652413647059141168822449465', y: '11410248488379662098266045802345135482683496756414401793793460258484335221028' },
  },
  verifiedOprf: {
    test: 'oprf/src/oprf_output.nr verified_oprf_kat_test',
    beta: '2387462819376525223098422965806766751285565755980265072594901385662518965922',
    query: '16778459034791831994680912315190773394547154204120376000937183272785502542361',
    response: { x: '11771927497930831763844779626723106344742708040976110136703486119568919340013', y: '19299702061490581533153169629464406607119112637706400365988657399831357218309' },
    dsOut: '1773399373884719043551596035141478',
    output: '21342856517406476000190785734870568200315738457615815351702849709270076362125',
  },
};

// ---- the recorded network answer --------------------------------------------

let network;
if (recordFile) {
  const v = JSON.parse(readFileSync(recordFile, 'utf8'));
  network = {
    note: 'One answer from TACEO\'s public test network (node{0,1,2}.eu.test.oprf.taceo.network, `basic` module, threshold 2), ' +
      'recorded with proofport-oprf/target/release/taceo_testnet for a random address. Its public key is the test network\'s key; ' +
      'core pins its hash for staging and local.',
    recordedAt: new Date().toISOString().slice(0, 10),
    addressField: v.address_field,
    domainName: v.domain_name,
    scopeName: v.scope_name,
    domain: v.domain,
    scope: v.scope,
    query: v.query,
    beta: v.beta,
    publicKey: v.oprf_public_key,
    keyHash: v.oprf_key_hash,
    dlogE: v.dlog_e,
    dlogS: v.dlog_s,
    blindedResponse: v.response_blinded,
    response: v.response,
    nullifier: v.nullifier,
  };
} else {
  if (!existsSync(VECTORS_OUT)) throw new Error(`${VECTORS_OUT} does not exist yet: pass --taceo-record <values.json> once.`);
  network = JSON.parse(readFileSync(VECTORS_OUT, 'utf8')).network;
  if (!network) throw new Error(`${VECTORS_OUT} has no network answer: pass --taceo-record <values.json>.`);
}

const vectors = JSON.stringify({
  construction: 'circuits/oprf-nullifier-libs/README.md: query = Poseidon2_t4(DS_query, address, domain, scope)[1]; ' +
    'A = beta * encode_to_curve(query); P = B / beta; nullifier = Poseidon2_t4(DS_out, query, P.x, P.y)[1]; ' +
    'key hash = Poseidon2_t3(DS_key, D.x, D.y)[1]; domain/scope = keccak256(utf8) mod p',
  oracles: {
    evaluations: 'circuits/scripts/oprf-nullifier oprf-fixture values (taceo-oprf-core 0.6.3, taceo-poseidon2 0.3.1)',
    names: 'proofport-oprf oprf reduce (src/auth.rs check_name + reduce_name); reductions also ethers keccak256 mod p',
    digests: 'proofport-oprf oprf digest (src/auth.rs request_digest), equal to ethers TypedDataEncoder.hash',
    kats: kats.source,
    network: 'TACEO public test network, recorded',
  },
  canonical: 'proofport-app-sdk packages/core/src/oprf/; copies of this file must stay byte-identical',
  constants: {
    p: hex32(P),
    r: hex32(R),
    maxNameBytes: 256,
    maxValiditySeconds: 600,
  },
  names,
  jsOnlyNames,
  digests,
  evaluations,
  kats,
  network,
}, null, 2) + '\n';

if (check) {
  let stale = false;
  for (const [file, text] of [[CONSTS_OUT, constsTs], [VECTORS_OUT, vectors]]) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
      console.error(`${file} is stale; run without --check.`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log('poseidon2Constants.generated.ts and oprf-vectors.json are up to date');
} else {
  writeFileSync(CONSTS_OUT, constsTs);
  writeFileSync(VECTORS_OUT, vectors);
  console.log(`wrote ${CONSTS_OUT}`);
  console.log(`wrote ${VECTORS_OUT}: ${evaluations.length} evaluations, ${names.length + jsOnlyNames.length} names, ${digests.length} digests`);
}
