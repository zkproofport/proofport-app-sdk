#!/usr/bin/env python3
"""Mutation check for the OIDC v2 policy (core's checkOidcPolicy) and the
SDK's request plumbing.

Reintroduces each defect a guard exists for, runs the tests that should catch
it, and restores the file byte-for-byte. A mutation whose text is not found
exactly once is an error, not a pass: a substitution that matched nothing
would leave the code unchanged and the tests green. A mutation is "caught"
only when the tests fail AND the output names the expected test.

Usage: python3 scripts/mutate-oidc-policy.py [name ...]
Run from anywhere inside this repository, with node_modules installed. The
shell's NODE_OPTIONS is dropped for the test run (a stale preload breaks node
on some machines).
"""
import os
import subprocess
import sys

REPO = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True, check=True).stdout.strip()

POLICY = 'packages/core/src/oidcPolicy.ts'
ISSUER = 'packages/core/src/issuerChecks.ts'
SDK = 'src/ProofportSDK.ts'
OFFCHAIN = 'src/offChainVerifier.ts'
TESTS = ['src/__tests__/oidcPolicyIsChecked.test.ts']

MUTATIONS = [
    ('v1-not-named', POLICY,
     "  if (publicInputs.length === OIDC_V1_PUBLIC_INPUT_COUNT) {",
     "  if (false) {",
     'refuses a v1 proof (148 inputs) by name'),
    ('count-unchecked', POLICY,
     "  if (publicInputs.length !== OIDC_V2_PUBLIC_INPUT_COUNT) {",
     "  if (false) {",
     'refuses 213 inputs'),
    ('provider-unchecked', POLICY,
     "  if (!Object.prototype.hasOwnProperty.call(OIDC_ALLOWED_AUDIENCES, providerId)) {",
     "  if (false) {",
     'refuses provider 2 as unknown'),
    ('nonce-mode-unchecked', POLICY,
     "  if (mode.value !== 0n && mode.value !== 1n) {",
     "  if (false) {",
     'names nonce_mode 2 as unknown'),
    ('audience-falls-back-to-first', POLICY,
     "  const audience = audiences.find(a => oidcAudienceHash(a.clientId) === aud.value);",
     "  const audience = audiences.find(a => oidcAudienceHash(a.clientId) === aud.value) ?? audiences[0];",
     'refuses a token issued to some other Google client'),
    ('audience-not-per-provider', POLICY,
     "  const audiences = OIDC_ALLOWED_AUDIENCES[providerId];",
     "  const audiences = Object.values(OIDC_ALLOWED_AUDIENCES).flat();",
     'refuses our Microsoft client id presented under provider 0'),
    ('mode-not-tied-to-audience', POLICY,
     "  if (!audience.nonceModes.includes(nonceMode)) {",
     "  if (false) {",
     'refuses the Google web client in mode 0'),
    ('mode0-binding-unchecked', POLICY,
     "  if (nonceMode === 0 && binding.value !== '00'.repeat(32)) {",
     "  if (false) {",
     'mode 0 refuses a binding with byte 31 nonzero'),
    ('scope-unchecked', POLICY,
     "    if (proofScope.value !== expectedScope) {",
     "    if (false) {",
     'refuses a proof whose scope is not the requested scope'),
    ('binding-unchecked', POLICY,
     "      if (binding.value !== expected) {",
     "      if (false) {",
     'refuses a proof bound to another requestId of the same scope'),
    ('nonce-without-domain-tag', POLICY,
     "concat(utf8(OIDC_NONCE_DOMAIN), scopeHash, utf8(requestId))",
     "concat(scopeHash, utf8(requestId))",
     'derives the nonce the app derives'),
    ('request-id-any-string', POLICY,
     "  if (typeof requestId !== 'string' || !UUID.test(requestId)) {",
     "  if (typeof requestId !== 'string') {",
     'refuses a request with uppercase UUID'),
    ('scope-uncapped', POLICY,
     "  if (scopeBytes > OIDC_MAX_SCOPE_BYTES) {",
     "  if (false) {",
     'refuses a request with 4097-byte scope'),
    ('future-now-accepted', POLICY,
     "  if (now.value > clock + BigInt(OIDC_NOW_MAX_FUTURE_SECONDS)) {",
     "  if (false) {",
     'now 301s ahead'),
    ('stale-now-accepted', POLICY,
     "  if (now.value < clock - BigInt(OIDC_NOW_MAX_AGE_SECONDS)) {",
     "  if (false) {",
     'now 901s behind'),
    ('now-not-u64', POLICY,
     "  const now = readField(publicInputs, LAYOUT.NOW, 'now', U64_MAX);",
     "  const now = readField(publicInputs, LAYOUT.NOW, 'now', 1n << 70n);",
     'refuses a now that is 2^64'),
    ('issuer-check-skips-policy', ISSUER,
     "  const policy = checkOidcPolicy(publicInputs, { request: options.request });\n  if (!policy.ok) return policy;\n",
     "",
     'core verifyProofOnChain refuses a foreign audience'),
    ('issuer-check-drops-request', ISSUER,
     "checkOidcPolicy(publicInputs, { request: options.request })",
     "checkOidcPolicy(publicInputs, {})",
     'checkProofIssuer passes the request through to the policy'),
    ('offchain-drops-request', OFFCHAIN,
     "checkProofIssuer(circuit, publicInputs, { request: options.request })",
     "checkProofIssuer(circuit, publicInputs)",
     'verifyProofOffChain refuses a proof bound to another request'),
    ('sdk-verifyOnChain-drops-request', SDK,
     "      request: options.request,\n    });",
     "      request: undefined,\n    });",
     'sdk.verifyOnChain refuses a proof bound to another request'),
    ('sdk-response-onchain-drops-request', SDK,
     "    }, { request });",
     "    }, {});",
     'sdk.verifyResponseOnChain refuses a proof bound to another request'),
    ('sdk-unknown-request-not-refused', SDK,
     "    if (!remembered) {",
     "    if (false) {",
     'refuses an OIDC response for a requestId it never created'),
    ('sdk-explicit-request-mismatch-allowed', SDK,
     "explicit.requestId !== response.requestId",
     "false",
     'refuses an explicit request whose requestId is not'),
    ('sdk-forgets-to-remember', SDK,
     "    this.rememberRelayRequest(created.requestId, scope);\n",
     "",
     'checks the binding against the request it created'),
    ('sdk-memory-unbounded', SDK,
     "    while (this.relayRequests.size > ProofportSDK.MAX_REMEMBERED_RELAY_REQUESTS) {",
     "    while (false) {",
     'forgets the oldest past 1000 remembered requests'),
]


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
        if file.startswith('packages/core/'):
            # The SDK's tests resolve @zkproofport-app/core through the
            # workspace link to packages/core, whose package.json points at
            # dist; rebuild so the mutation is what the tests load.
            build = subprocess.run(['npx', 'rollup', '-c'], cwd=os.path.join(REPO, 'packages/core'),
                                   capture_output=True, text=True, env=ENV)
            if build.returncode != 0:
                return f'ERROR: core build failed with the mutation:\n{build.stdout}{build.stderr}'
        proc = subprocess.run(['npx', 'vitest', 'run', *TESTS], cwd=REPO,
                              capture_output=True, text=True, env=ENV)
        out = proc.stdout + proc.stderr
        if proc.returncode == 0:
            return 'SURVIVED: tests passed with the defect in place'
        if expect not in out:
            return f"ERROR: tests failed, but not on '{expect}':\n{out}"
        return 'caught'
    finally:
        with open(path, 'wb') as f:
            f.write(original)
        with open(path, 'rb') as f:
            assert f.read() == original, f'{file} not restored'
        if file.startswith('packages/core/'):
            subprocess.run(['npx', 'rollup', '-c'], cwd=os.path.join(REPO, 'packages/core'),
                           capture_output=True, text=True, env=ENV, check=True)


ENV = {k: v for k, v in os.environ.items() if k != 'NODE_OPTIONS'}


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
