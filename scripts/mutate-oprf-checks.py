#!/usr/bin/env python3
"""Mutation check for the OPRF nullifier's verifier side (core's oprfPolicy /
oprfKeys / oprfLayouts and their wiring) and core's OPRF client.

Removes or weakens one guard at a time, runs the tests that should catch it,
and restores the file byte for byte. A mutation whose text is not found
exactly once is an error, not a pass (a substitution that matched nothing
leaves the code unchanged and the tests green), and so is a file that reads
back unchanged after the substitution. A mutation counts as caught only when
the tests fail AND the output names the expected test.

The SDK's tests load core from its source (vitest.config.ts aliases it), so no
core rebuild is needed between mutations.

Usage: python3 scripts/mutate-oprf-checks.py [name ...]
Run from anywhere inside this repository, with node_modules installed.
"""
import os
import subprocess
import sys

REPO = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True, check=True).stdout.strip()

POLICY = 'packages/core/src/oprfPolicy.ts'
KEYS = 'packages/core/src/oprfKeys.ts'
HASHES = 'packages/core/src/oprfKeyHashes.ts'
LAYOUTS = 'packages/core/src/oprfLayouts.ts'
ISSUER = 'packages/core/src/issuerChecks.ts'
CLIENT = 'packages/core/src/oprf/client.ts'
SDK = 'src/ProofportSDK.ts'
TESTS = ['src/__tests__/oprfNullifierIsJudged.test.ts', 'src/__tests__/oprfClientMatchesTheVectors.test.ts',
         'src/__tests__/requestScopeIsCheckedAtCreation.test.ts', 'src/__tests__/oprfDomainIsInferredOnlyInABrowser.test.ts']
SCOPE = 'src/requestScope.ts'
DEEPLINK = 'src/deeplink.ts'

MUTATIONS = [
    # The key-hash pin.
    ('key-hash-unchecked', POLICY,
     "  if (read.oprfKeyHash !== pinned) {",
     "  if (false) {",
     'hash + 1 is refused, naming both hashes'),
    ('production-falls-back-to-staging', KEYS,
     "  const rows = OPRF_KEY_HASHES[environment];",
     "  const rows = OPRF_KEY_HASHES[environment] ?? OPRF_KEY_HASHES.staging;",
     'production refuses coinbase_attestation by name'),
    ('missing-environment-defaults-to-staging', POLICY,
     "  if (options.oprfEnvironment === undefined) {",
     "  if (options.oprfEnvironment === undefined && false) {",
     'a missing environment is refused naming the option'),
    ('pinned-row-changed', HASHES,
     "export const TACEO_TESTNET_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1';",
     "export const TACEO_TESTNET_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d2';",
     'the pinned hash is the hash of the recorded public key'),
    ('issuer-check-skips-oprf', ISSUER,
     "    if (!oprf.ok) return oprf;\n",
     "",
     'checkProofIssuer'),
    ('sdk-drops-environment', SDK,
     "    return this.environment ?? undefined;",
     "    return undefined;",
     'the SDK verifies for its own environment'),
    # Domain and scope.
    ('domain-unchecked', POLICY,
     "  if (read.domain !== domain) {",
     "  if (false) {",
     'another domain is refused'),
    ('scope-unchecked', POLICY,
     "  if (read.scope !== scope) {",
     "  if (false) {",
     'another scope is refused'),
    ('missing-domain-skipped', POLICY,
     "  if (typeof domain !== 'string') return fail(domain.error);",
     "  if (typeof domain !== 'string') return { ok: true };",
     'a request that names no OPRF domain is refused'),
    ('compared-unreduced', POLICY,
     "  return reduceOprfName(value as string);",
     "  return '0x' + Array.from(new TextEncoder().encode(value as string)).length.toString(16).padStart(64, '0');",
     'the right pair is accepted'),
    ('value-reduced-not-refused', LAYOUTS,
     "  if (v >= P) throw new Error(`Public input ${index} (${name}) is not below the field modulus: ${raw}.`);",
     "  if (v >= P) v = v % P;",
     'a raw keccak256 (not reduced mod p) is refused'),
    ('sdk-forgets-deep-link-domain', SDK,
     "        const oprfDomain = typeof inputs?.oprfDomain === 'string' ? inputs.oprfDomain : undefined;",
     "        const oprfDomain = undefined as string | undefined;",
     'a deep-link request remembers its oprfDomain'),
    # The scope rule where a request is created (user decision 2026-11-20).
    ('relay-request-scope-unchecked', SDK,
     "    // is spent and before anyone signs (./requestScope).\n    const scopeError = requestScopeError(circuit, inputs);\n    if (scopeError) throw new Error(scopeError);",
     "    // is spent and before anyone signs (./requestScope).\n    const scopeError = null;",
     'refuses 257 ASCII bytes at every door'),
    ('deep-link-request-scope-unchecked', SDK,
     "    if (scopeError) throw new Error(scopeError);\n    // The OPRF domain: the dApp's, or in a browser the page's hostname (./requestScope).\n    inputs = withOprfDomain(circuit, inputs);\n    const builder",
     "    // The OPRF domain: the dApp's, or in a browser the page's hostname (./requestScope).\n    inputs = withOprfDomain(circuit, inputs);\n    const builder",
     'refuses a right-to-left override at every door'),
    ('validator-scope-unchecked', DEEPLINK,
     "    if (scopeError) return { valid: false, error: scopeError };",
     "",
     'refuses a tab at every door'),
    ('scope-rule-skips-oprf-name', SCOPE,
     "  const why = oprfNameError(i.scope);",
     "  const why = null as string | null;",
     'refuses 86 Hangul syllables'),
    ('oprf-domain-unchecked-at-creation', SCOPE,
     "    if (domainWhy !== null) return `oprfDomain cannot be used for ${circuit}: ${domainWhy}`;",
     "",
     'refuses an oprfDomain that is 257 bytes'),
    # The OPRF domain: the dApp's, else the page's hostname in a browser, else an error.
    ('browser-branch-skipped', SCOPE,
     "  const host = browserHostname();",
     "  const host = { why: 'mutated' } as string | { why: string };",
     'an omitted oprfDomain is the page hostname'),
    ('node-falls-back-instead-of-error', SCOPE,
     "  if (typeof host !== 'string') {\n    throw new Error(",
     "  if (typeof host !== 'string') {\n    return { ...(inputs as object), oprfDomain: 'localhost' } as T;\n    throw new Error(",
     'outside a browser, an omitted oprfDomain is an error naming it'),
    ('supplied-overridden-by-page', SCOPE,
     "  if (given !== undefined) return inputs;\n",
     "",
     'a supplied oprfDomain wins over the page'),
    ('ip-host-accepted', SCOPE,
     "  if (IP_HOST.test(hostname)) {",
     "  if (false) {",
     'an omitted oprfDomain is an error'),
    ('non-web-protocol-accepted', SCOPE,
     "  if (protocol !== 'https:' && protocol !== 'http:') {",
     "  if (false) {",
     'about:blank, an omitted oprfDomain is an error'),
    ('hostname-not-lowercased', SCOPE,
     "  return hostname.toLowerCase();",
     "  return hostname;",
     'a location reporting an upper-case hostname is lowercased'),
    ('relay-path-skips-domain', SDK,
     "    inputs = withOprfDomain(circuit, inputs);\n\n    // Get challenge",
     "\n    // Get challenge",
     "sends and remembers the inferred domain"),
    # The client.
    ('client-pin-ignored', CLIENT,
     "  if (args.expectedKeyHash !== undefined && toHex32(parseField(args.expectedKeyHash, 'expectedKeyHash')) !== keyHash) {",
     "  if (false) {",
     'refuses the same answer against another pinned key'),
    ('client-dlog-unchecked', CLIENT,
     "  return challenge === e;",
     "  return true;",
     'e + 1: does not verify'),
    ('client-subgroup-unchecked', CLIENT,
     "  if (!isInSubgroup(q)) throw new Error(`${what} is not a point of BabyJubJub's prime-order subgroup.`);",
     "",
     'on the curve, outside the subgroup'),
    ('client-name-cf-allowed', CLIENT,
     "  if (codePoints.some(isFormat)) return 'format-character';",
     "",
     "the node's verdict: zero-width space (Cf)"),
    ('client-deadline-window', CLIENT,
     "  if (deadline > nowSeconds + OPRF_MAX_VALIDITY_SECONDS) {",
     "  if (deadline > nowSeconds + OPRF_MAX_VALIDITY_SECONDS + 1) {",
     'deadline now + 601 (too far ahead)'),
    ('client-query-order', CLIENT,
     "  return poseidon2T4([OPRF_DS_QUERY, address, domain, scope])[1];",
     "  return poseidon2T4([OPRF_DS_QUERY, address, scope, domain])[1];",
     'query, blinded point and key hash'),
]

ENV = {k: v for k, v in os.environ.items() if k != 'NODE_OPTIONS'}


def run(name, file, old, new, expect):
    path = os.path.join(REPO, file)
    with open(path, 'rb') as f:
        original = f.read()
    text = original.decode()
    count = text.count(old)
    if count != 1:
        return f'ERROR: expected the text once in {file}, found {count}'
    try:
        with open(path, 'wb') as f:
            f.write(text.replace(old, new).encode())
        with open(path, 'rb') as f:
            if f.read() == original:
                return 'ERROR: file unchanged after substitution'
        proc = subprocess.run(['npx', 'vitest', 'run', *TESTS], cwd=REPO, capture_output=True, text=True, env=ENV)
        out = proc.stdout + proc.stderr
        if proc.returncode == 0:
            return 'SURVIVED: tests passed with the defect in place'
        if expect not in out:
            return f"ERROR: tests failed, but not on '{expect}':\n{out[-3000:]}"
        return 'caught'
    finally:
        with open(path, 'wb') as f:
            f.write(original)
        with open(path, 'rb') as f:
            assert f.read() == original, f'{file} not restored'


def main():
    wanted = set(sys.argv[1:])
    failed = False
    for name, file, old, new, expect in MUTATIONS:
        if wanted and name not in wanted:
            continue
        result = run(name, file, old, new, expect)
        print(f'{name}: {result}', flush=True)
        failed |= result != 'caught'
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
