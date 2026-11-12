/**
 * Local, offline QR code generation for the support dialog.
 * Uses the bundled `uqr` encoder; nothing is fetched at runtime.
 */
import { encode } from 'uqr';

export interface QrSvg {
  /** Width/height of the module grid, including the quiet zone. */
  size: number;
  /** SVG path data with one 1x1 square per dark module. */
  path: string;
}

/** Quiet zone required by the QR spec (4 modules on each side). */
const QUIET_ZONE = 4;

export function buildQrSvg(text: string): QrSvg {
  if (!text) {
    throw new Error('QR text must not be empty');
  }
  const qr = encode(text, { ecc: 'M', border: QUIET_ZONE });
  let path = '';
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    });
  });
  return { size: qr.size, path };
}
