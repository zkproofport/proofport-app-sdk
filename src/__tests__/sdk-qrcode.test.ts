import { describe, it, expect } from 'vitest';
import { ProofportSDK } from '../ProofportSDK';

describe('ProofportSDK QR Code Methods', () => {
  const sdk = new ProofportSDK();
  const testUrl = 'zkproofport://proof-request?data=eyJ0ZXN0IjoidmFsdWUifQ';

  it('generateQRCode() returns data:image/png;base64 string for URL input', async () => {
    const result = await sdk.generateQRCode(testUrl);

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(result.length).toBeGreaterThan(100);
  });

  it('generateQRCode() accepts ProofRequest object', async () => {
    const request = {
      requestId: 'req-test-123',
      circuit: 'coinbase_attestation' as const,
      inputs: { scope: 'test.com' },
      createdAt: Date.now(),
    };

    const result = await sdk.generateQRCode(request);

    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('generateQRCode() throws for oversized data', async () => {
    const oversizedUrl = 'zkproofport://proof-request?data=' + 'x'.repeat(3000);

    await expect(sdk.generateQRCode(oversizedUrl)).rejects.toThrow('QR code data too large');
  });

  it('generateQRCodeSVG() returns string containing <svg', async () => {
    const result = await sdk.generateQRCodeSVG(testUrl);

    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
  });

  it('checkQRCodeSize() returns correct size and withinLimit=true for small URL', () => {
    const result = sdk.checkQRCodeSize(testUrl);

    expect(result.size).toBe(testUrl.length);
    expect(result.withinLimit).toBe(true);
  });

  it('checkQRCodeSize() returns withinLimit=false for oversized data', () => {
    const oversizedUrl = 'zkproofport://proof-request?data=' + 'x'.repeat(3000);
    const result = sdk.checkQRCodeSize(oversizedUrl);

    expect(result.withinLimit).toBe(false);
    expect(result.size).toBeGreaterThan(2953);
  });
});
