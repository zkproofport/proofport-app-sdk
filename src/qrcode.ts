/**
 * QR Code utilities for ZKProofPort SDK
 */

import QRCode from 'qrcode';
import type { ProofRequest, QRCodeOptions } from './types';
import { buildProofRequestUrl } from './deeplink';
import { DEFAULT_SCHEME, MAX_QR_DATA_SIZE } from './constants';

/**
 * Default QR code options
 */
const DEFAULT_QR_OPTIONS: QRCodeOptions = {
  width: 300,
  errorCorrectionLevel: 'M',
  margin: 2,
  darkColor: '#000000',
  lightColor: '#ffffff',
};

/**
 * Generate QR code as data URL (base64 PNG)
 */
export async function generateQRCodeDataUrl(
  request: ProofRequest,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<string> {
  const url = buildProofRequestUrl(request, scheme);

  // Check data size
  if (url.length > MAX_QR_DATA_SIZE) {
    throw new Error(
      `QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`
    );
  }

  const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };

  return QRCode.toDataURL(url, {
    width: mergedOptions.width,
    errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    margin: mergedOptions.margin,
    color: {
      dark: mergedOptions.darkColor,
      light: mergedOptions.lightColor,
    },
  });
}

/**
 * Generate QR code as SVG string
 */
export async function generateQRCodeSVG(
  request: ProofRequest,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<string> {
  const url = buildProofRequestUrl(request, scheme);

  if (url.length > MAX_QR_DATA_SIZE) {
    throw new Error(
      `QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`
    );
  }

  const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };

  return QRCode.toString(url, {
    type: 'svg',
    width: mergedOptions.width,
    errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    margin: mergedOptions.margin,
    color: {
      dark: mergedOptions.darkColor,
      light: mergedOptions.lightColor,
    },
  });
}

/**
 * Generate QR code to canvas element (browser only)
 */
export async function generateQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  request: ProofRequest,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<void> {
  const url = buildProofRequestUrl(request, scheme);

  if (url.length > MAX_QR_DATA_SIZE) {
    throw new Error(
      `QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`
    );
  }

  const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };

  await QRCode.toCanvas(canvas, url, {
    width: mergedOptions.width,
    errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    margin: mergedOptions.margin,
    color: {
      dark: mergedOptions.darkColor,
      light: mergedOptions.lightColor,
    },
  });
}

/**
 * Estimate QR code data size for a request
 */
export function estimateQRDataSize(
  request: ProofRequest,
  scheme: string = DEFAULT_SCHEME
): { size: number; withinLimit: boolean } {
  const url = buildProofRequestUrl(request, scheme);
  return {
    size: url.length,
    withinLimit: url.length <= MAX_QR_DATA_SIZE,
  };
}
