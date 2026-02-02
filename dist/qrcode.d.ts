/**
 * QR Code utilities for ZKProofPort SDK
 */
import type { ProofRequest, QRCodeOptions } from './types';
/**
 * Generate QR code as data URL (base64 PNG)
 */
export declare function generateQRCodeDataUrl(request: ProofRequest, options?: QRCodeOptions, scheme?: string): Promise<string>;
/**
 * Generate QR code as SVG string
 */
export declare function generateQRCodeSVG(request: ProofRequest, options?: QRCodeOptions, scheme?: string): Promise<string>;
/**
 * Generate QR code to canvas element (browser only)
 */
export declare function generateQRCodeToCanvas(canvas: HTMLCanvasElement, request: ProofRequest, options?: QRCodeOptions, scheme?: string): Promise<void>;
/**
 * Estimate QR code data size for a request
 */
export declare function estimateQRDataSize(request: ProofRequest, scheme?: string): {
    size: number;
    withinLimit: boolean;
};
