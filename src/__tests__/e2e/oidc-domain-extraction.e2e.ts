/**
 * E2E test: extractDomainFromPublicInputs with a real OIDC proof.
 *
 * Prerequisites:
 *   1. Authenticated gcloud CLI: `gcloud auth login`
 *   2. Environment variables:
 *      - ATTESTATION_KEY: Private key for attestation signer
 *      - PAYMENT_KEY: Private key for payment signer (Base Sepolia USDC)
 *   3. AI SDK built: `cd proofport-ai/packages/sdk && npm run build`
 *
 * Run:
 *   ATTESTATION_KEY=0x... PAYMENT_KEY=0x... npx tsx src/__tests__/e2e/oidc-domain-extraction.e2e.ts
 *
 * The test:
 *   1. Gets a real Google OIDC id_token via `gcloud auth print-identity-token`
 *   2. Generates a real oidc_domain_attestation proof via the AI SDK (staging)
 *   3. Splits the concatenated publicInputs hex into per-field array
 *   4. Calls the app-SDK's extractDomainFromPublicInputs
 *   5. Verifies the extracted domain is a valid, non-empty string
 */

import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

// AI SDK imports (relative path to built dist)
import {
  createConfig,
  generateProof,
  fromPrivateKey,
  extractDomainFromPublicInputs as aiExtractDomain,
} from '../../../../proofport-ai/packages/sdk/dist/index.js';
import type { ProofportSigner } from '../../../../proofport-ai/packages/sdk/dist/index.js';

// App SDK imports (source — tsx handles TS natively)
import { extractDomainFromPublicInputs } from '../../verifier.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Split a concatenated hex string into an array of 32-byte (64 hex char) fields.
 * This converts the AI SDK's single-hex publicInputs format into the
 * app-SDK's per-field array format.
 */
function splitPublicInputsToFields(publicInputsHex: string): string[] {
  const hex = publicInputsHex.startsWith('0x')
    ? publicInputsHex.slice(2)
    : publicInputsHex;
  const fields: string[] = [];
  for (let i = 0; i < hex.length; i += 64) {
    fields.push('0x' + hex.slice(i, i + 64));
  }
  return fields;
}

/**
 * Get a Google OIDC id_token from the local gcloud CLI.
 * Returns null if gcloud is not authenticated or not installed.
 */
function getGcloudIdToken(): string | null {
  try {
    const token = execSync('gcloud auth print-identity-token', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    if (!token || token.split('.').length !== 3) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT payload without verification (for logging only).
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  if (!payloadB64) throw new Error('Invalid JWT format');
  const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
  return JSON.parse(json);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== OIDC Domain Extraction E2E Test ===\n');

  // 1. Check prerequisites
  const attestationKey = process.env.ATTESTATION_KEY;
  const paymentKey = process.env.PAYMENT_KEY;

  if (!attestationKey) {
    console.log('SKIP: ATTESTATION_KEY env var not set');
    process.exit(0);
  }
  if (!paymentKey) {
    console.log('SKIP: PAYMENT_KEY env var not set');
    process.exit(0);
  }

  // 2. Get gcloud id_token
  console.log('Step 1: Getting gcloud id_token...');
  const jwt = getGcloudIdToken();
  if (!jwt) {
    console.log('SKIP: gcloud not authenticated or not installed');
    console.log('  Run: gcloud auth login');
    process.exit(0);
  }

  const payload = decodeJwtPayload(jwt);
  console.log(`  email: ${payload.email}`);
  console.log(`  iss: ${payload.iss}`);
  console.log(`  hd: ${payload.hd ?? '(none — personal account)'}`);

  if (!payload.email || !payload.hd) {
    console.log('SKIP: JWT does not have hd claim (Google Workspace account required)');
    process.exit(0);
  }

  const expectedDomain = (payload.email as string).split('@')[1];
  console.log(`  expected domain: ${expectedDomain}\n`);

  // 3. Set up AI SDK (staging)
  console.log('Step 2: Setting up AI SDK (staging)...');
  const config = createConfig({ baseUrl: 'https://stg-ai.zkproofport.app' });

  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
  const attestationSigner = fromPrivateKey(attestationKey, provider);
  const paymentSigner = fromPrivateKey(paymentKey, provider);

  console.log(`  attestation address: ${await attestationSigner.getAddress()}`);
  console.log(`  payment address: ${await paymentSigner.getAddress()}\n`);

  // 4. Generate proof
  console.log('Step 3: Generating oidc_domain proof (this may take 1-2 minutes)...');
  const scope = 'e2e-test-domain-extraction';

  const result = await generateProof(
    config,
    { attestation: attestationSigner, payment: paymentSigner },
    { circuit: 'oidc_domain', scope, jwt, provider: 'google' },
    {
      onStep: (step) => {
        console.log(`  [Step ${step.step}] ${step.name} (${step.durationMs}ms)`);
      },
    },
  );

  console.log(`\n  proof length: ${result.proof.length}`);
  console.log(`  publicInputs length: ${result.publicInputs.length}`);
  console.log(`  paymentTxHash: ${result.paymentTxHash}\n`);

  // 5. Test AI SDK's extractDomainFromPublicInputs (single hex string)
  console.log('Step 4: Testing AI SDK extractDomainFromPublicInputs...');
  const aiDomain = aiExtractDomain(result.publicInputs);
  console.log(`  AI SDK extracted domain: ${aiDomain}`);
  assert.ok(aiDomain, 'AI SDK extractDomainFromPublicInputs returned null');
  assert.strictEqual(aiDomain, expectedDomain, 'AI SDK domain does not match expected');
  console.log('  PASS\n');

  // 6. Test app-SDK's extractDomainFromPublicInputs (field array)
  console.log('Step 5: Testing app-SDK extractDomainFromPublicInputs...');
  const fields = splitPublicInputsToFields(result.publicInputs);
  console.log(`  split into ${fields.length} fields`);

  const appDomain = extractDomainFromPublicInputs(fields, 'oidc_domain_attestation');
  console.log(`  App SDK extracted domain: ${appDomain}`);
  assert.ok(appDomain, 'App SDK extractDomainFromPublicInputs returned null');
  assert.strictEqual(appDomain, expectedDomain, 'App SDK domain does not match expected');
  console.log('  PASS\n');

  // 7. Cross-check both extractors agree
  console.log('Step 6: Cross-checking both extractors...');
  assert.strictEqual(aiDomain, appDomain, 'AI SDK and App SDK domains differ');
  console.log('  Both extractors agree');
  console.log('  PASS\n');

  console.log('=== ALL TESTS PASSED ===');
  console.log(`  Domain: ${appDomain}`);
  console.log(`  Fields: ${fields.length}`);
  console.log(`  Proof generated with scope: "${scope}"`);
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
