import { describe, it, expect, vi } from 'vitest';
// uqr is a webview dependency (bundled into dist/webview/main.js), not a root one.
import { encode } from '../../webview/node_modules/uqr';
import {
  SUPPORT_CONFIG,
  buildUpiPaymentUri,
  checkSupportConfig,
  type SupportConfig,
} from '../../src/shared/support';
import { buildQrSvg } from '../../webview/src/lib/qr';
import { closeDialog, copyText, isBackdropClick, openDialog } from '../../webview/src/lib/supportDialog';

const valid: SupportConfig = {
  upiId: 'jane.doe-01@okaxis',
  payeeName: 'Jane Doe',
  transactionNote: 'Support Switchyard',
};

function params(uri: string): URLSearchParams {
  return new URL(uri).searchParams;
}

describe('buildUpiPaymentUri', () => {
  it('builds a standard upi://pay URI in pa, pn, tn, cu order', () => {
    expect(buildUpiPaymentUri(valid)).toBe(
      'upi://pay?pa=jane.doe-01@okaxis&pn=Jane%20Doe&tn=Support%20Switchyard&cu=INR'
    );
  });

  it('percent-encodes payee name and note (spaces as %20, never +)', () => {
    const uri = buildUpiPaymentUri({ ...valid, payeeName: 'A & B = C?', transactionNote: 'Thanks #1 +more' });
    expect(uri).toContain('pn=A%20%26%20B%20%3D%20C%3F');
    expect(uri).toContain('tn=Thanks%20%231%20%2Bmore');
    expect(uri).not.toContain('+');
    expect(params(uri).get('pn')).toBe('A & B = C?');
    expect(params(uri).get('tn')).toBe('Thanks #1 +more');
  });

  it('keeps the UPI ID readable and round-trips it exactly', () => {
    const uri = buildUpiPaymentUri(valid);
    expect(params(uri).get('pa')).toBe('jane.doe-01@okaxis');
  });

  it('trims surrounding whitespace from values', () => {
    const uri = buildUpiPaymentUri({ upiId: ' jane@ybl ', payeeName: ' Jane ', transactionNote: ' Support Switchyard ' });
    expect(uri).toBe('upi://pay?pa=jane@ybl&pn=Jane&tn=Support%20Switchyard&cu=INR');
  });

  it('never includes an amount parameter', () => {
    const uri = buildUpiPaymentUri(valid);
    expect(params(uri).has('am')).toBe(false);
    expect(uri).not.toMatch(/[?&]am=/);
  });

  it('always sets currency to INR', () => {
    expect(params(buildUpiPaymentUri(valid)).get('cu')).toBe('INR');
  });

  it('throws instead of building a URI from unusable details', () => {
    expect(() => buildUpiPaymentUri({ ...valid, upiId: 'not-a-upi-id' })).toThrow(/upiIdInvalid/);
  });
});

describe('checkSupportConfig', () => {
  it('accepts real-looking details', () => {
    expect(checkSupportConfig(valid)).toEqual({ ok: true });
  });

  it('reports the shipped placeholders as not configured', () => {
    expect(checkSupportConfig({ ...valid, upiId: 'REPLACE_WITH_YOUR_UPI_ID' })).toEqual({
      ok: false,
      reason: 'upiIdNotConfigured',
    });
    expect(checkSupportConfig({ ...valid, payeeName: 'REPLACE_WITH_YOUR_PAYEE_NAME' })).toEqual({
      ok: false,
      reason: 'payeeNameNotConfigured',
    });
    expect(checkSupportConfig({ ...valid, upiId: 'yourname@bank' }).ok).toBe(false);
  });

  it('treats the current SUPPORT_CONFIG as unconfigured while placeholders remain', () => {
    const placeholder = /REPLACE_WITH/.test(SUPPORT_CONFIG.upiId) || /REPLACE_WITH/.test(SUPPORT_CONFIG.payeeName);
    expect(checkSupportConfig(SUPPORT_CONFIG).ok).toBe(!placeholder);
  });

  it('rejects empty values', () => {
    expect(checkSupportConfig({ ...valid, upiId: '  ' })).toEqual({ ok: false, reason: 'upiIdNotConfigured' });
    expect(checkSupportConfig({ ...valid, payeeName: '' })).toEqual({ ok: false, reason: 'payeeNameNotConfigured' });
    expect(checkSupportConfig({ ...valid, transactionNote: '' })).toEqual({ ok: false, reason: 'noteInvalid' });
  });

  it.each(['jane', 'jane@', '@okaxis', 'jane@ok axis', 'jane@@okaxis', 'ja ne@okaxis', 'jane@1bank', 'jane&am=1@ybl'])(
    'rejects malformed UPI ID %s',
    (upiId) => {
      expect(checkSupportConfig({ ...valid, upiId })).toEqual({ ok: false, reason: 'upiIdInvalid' });
    }
  );

  it('rejects payee names with control characters or excessive length', () => {
    expect(checkSupportConfig({ ...valid, payeeName: 'Jane\nDoe' })).toEqual({ ok: false, reason: 'payeeNameInvalid' });
    expect(checkSupportConfig({ ...valid, payeeName: 'x'.repeat(100) })).toEqual({ ok: false, reason: 'payeeNameInvalid' });
  });
});

describe('buildQrSvg', () => {
  function pathFor(text: string): string {
    const qr = encode(text, { ecc: 'M', border: 4 });
    let path = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)));
    return path;
  }

  it('encodes the full UPI payment URI, not just the UPI ID', () => {
    const uri = buildUpiPaymentUri(valid);
    const svg = buildQrSvg(uri);
    expect(svg.path).toBe(pathFor(uri));
    expect(svg.path).not.toBe(pathFor(valid.upiId));
  });

  it('includes a 4-module quiet zone and a square grid', () => {
    const uri = buildUpiPaymentUri(valid);
    const qr = encode(uri, { ecc: 'M', border: 0 });
    const svg = buildQrSvg(uri);
    expect(svg.size).toBe(qr.size + 8);
    expect(svg.path).not.toMatch(/M[0-3] /); // nothing drawn in the left quiet zone
    expect(svg.path.length).toBeGreaterThan(0);
  });

  it('rejects empty input', () => {
    expect(() => buildQrSvg('')).toThrow();
  });
});

describe('copyText', () => {
  it('writes the UPI ID to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyText('jane@ybl', { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('jane@ybl');
  });

  it('reports failure when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    await expect(copyText('jane@ybl', { writeText })).resolves.toBe('failed');
  });

  it('reports failure when no clipboard is available or text is empty', async () => {
    await expect(copyText('jane@ybl', undefined)).resolves.toBe('failed');
    const writeText = vi.fn();
    await expect(copyText('', { writeText })).resolves.toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('support dialog open/close', () => {
  function fakeDialog() {
    const d = {
      open: false,
      showModal: vi.fn(() => {
        d.open = true;
      }),
      close: vi.fn(() => {
        d.open = false;
      }),
    };
    return d;
  }

  it('opens as a modal once', () => {
    const d = fakeDialog();
    openDialog(d);
    openDialog(d);
    expect(d.open).toBe(true);
    expect(d.showModal).toHaveBeenCalledTimes(1);
  });

  it('closes and returns focus to the trigger', () => {
    const d = fakeDialog();
    const trigger = { focus: vi.fn() };
    openDialog(d);
    closeDialog(d, trigger);
    expect(d.open).toBe(false);
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it('does not call close on an already closed dialog', () => {
    const d = fakeDialog();
    closeDialog(d);
    expect(d.close).not.toHaveBeenCalled();
  });

  it('tolerates a missing dialog element', () => {
    expect(() => openDialog(undefined)).not.toThrow();
    expect(() => closeDialog(undefined, null)).not.toThrow();
  });

  it('treats clicks on the dialog element itself as backdrop clicks', () => {
    const d = fakeDialog();
    expect(isBackdropClick(d, d)).toBe(true);
    expect(isBackdropClick({}, d)).toBe(false);
    expect(isBackdropClick(null, null)).toBe(false);
  });
});
