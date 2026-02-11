/**
 * QR Code utilities for ZKProofport SDK
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
 * Generates a QR code as a base64-encoded PNG data URL.
 *
 * Creates a scannable QR code image from a proof request or deep link URL.
 * The returned data URL can be used directly in HTML img src attributes.
 * Validates that the encoded data doesn't exceed the maximum QR code size.
 *
 * @param requestOrUrl - Proof request object or pre-built deep link URL
 * @param options - QR code appearance options (width, colors, error correction)
 * @param scheme - Custom URL scheme (only used if requestOrUrl is a ProofRequest)
 * @returns Promise resolving to base64 PNG data URL (e.g., "data:image/png;base64,...")
 *
 * @throws {Error} If the URL exceeds MAX_QR_DATA_SIZE (2953 bytes)
 *
 * @example
 * ```typescript
 * const request: ProofRequest = {
 *   requestId: generateRequestId(),
 *   circuit: 'coinbase_attestation',
 *   inputs: { scope: 'myapp.com' },
 *   createdAt: Date.now()
 * };
 *
 * const dataUrl = await generateQRCodeDataUrl(request, {
 *   width: 400,
 *   darkColor: '#000000',
 *   lightColor: '#ffffff'
 * });
 *
 * // Use in HTML: <img src={dataUrl} alt="Scan to prove" />
 * ```
 */
export async function generateQRCodeDataUrl(
  requestOrUrl: ProofRequest | string,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<string> {
  const url = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : buildProofRequestUrl(requestOrUrl, scheme);

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
 * Generates a QR code as an SVG string.
 *
 * Creates a scalable vector graphics QR code that can be embedded directly in HTML
 * or saved to a file. SVG QR codes scale perfectly at any size and have smaller
 * file sizes than raster formats.
 *
 * @param requestOrUrl - Proof request object or pre-built deep link URL
 * @param options - QR code appearance options (width, colors, error correction)
 * @param scheme - Custom URL scheme (only used if requestOrUrl is a ProofRequest)
 * @returns Promise resolving to SVG markup string
 *
 * @throws {Error} If the URL exceeds MAX_QR_DATA_SIZE (2953 bytes)
 *
 * @example
 * ```typescript
 * const request: ProofRequest = { ... };
 * const svg = await generateQRCodeSVG(request, { width: 300 });
 *
 * // Embed directly: <div dangerouslySetInnerHTML={{ __html: svg }} />
 * // Or save to file: fs.writeFileSync('qr.svg', svg);
 * ```
 */
export async function generateQRCodeSVG(
  requestOrUrl: ProofRequest | string,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<string> {
  const url = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : buildProofRequestUrl(requestOrUrl, scheme);

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
 * Renders a QR code directly to an HTML canvas element.
 *
 * Browser-only function that draws a QR code onto an existing canvas element.
 * Useful for interactive applications or when you need direct canvas manipulation.
 * The canvas dimensions will be set automatically based on the width option.
 *
 * @param canvas - HTML canvas element to render to (must exist in DOM)
 * @param requestOrUrl - Proof request object or pre-built deep link URL
 * @param options - QR code appearance options (width, colors, error correction)
 * @param scheme - Custom URL scheme (only used if requestOrUrl is a ProofRequest)
 * @returns Promise that resolves when rendering is complete
 *
 * @throws {Error} If the URL exceeds MAX_QR_DATA_SIZE (2953 bytes)
 * @throws {Error} If canvas is not a valid HTMLCanvasElement (browser only)
 *
 * @example
 * ```typescript
 * // In a React component:
 * const canvasRef = useRef<HTMLCanvasElement>(null);
 *
 * useEffect(() => {
 *   if (canvasRef.current) {
 *     generateQRCodeToCanvas(canvasRef.current, request, { width: 400 });
 *   }
 * }, [request]);
 *
 * return <canvas ref={canvasRef} />;
 * ```
 */
export async function generateQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  requestOrUrl: ProofRequest | string,
  options: QRCodeOptions = {},
  scheme: string = DEFAULT_SCHEME
): Promise<void> {
  const url = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : buildProofRequestUrl(requestOrUrl, scheme);

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
 * Estimates the byte size of a QR code's encoded data.
 *
 * Calculates the size of the deep link URL that will be encoded in the QR code,
 * and checks if it's within the maximum supported size (2953 bytes for QR version 40
 * with medium error correction). Use this before generating QR codes to avoid errors.
 *
 * @param requestOrUrl - Proof request object or pre-built deep link URL
 * @param scheme - Custom URL scheme (only used if requestOrUrl is a ProofRequest)
 * @returns Object with `size` in bytes and `withinLimit` boolean flag
 *
 * @example
 * ```typescript
 * const request: ProofRequest = { ... };
 * const { size, withinLimit } = estimateQRDataSize(request);
 *
 * if (!withinLimit) {
 *   console.error(`QR code too large: ${size} bytes (max 2953)`);
 *   // Consider reducing request data or splitting into multiple QR codes
 * }
 *
 * // Example output: { size: 384, withinLimit: true }
 * ```
 */
export function estimateQRDataSize(
  requestOrUrl: ProofRequest | string,
  scheme: string = DEFAULT_SCHEME
): { size: number; withinLimit: boolean } {
  const url = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : buildProofRequestUrl(requestOrUrl, scheme);
  return {
    size: url.length,
    withinLimit: url.length <= MAX_QR_DATA_SIZE,
  };
}
