export const SUPPORT_CONFIG: SupportConfig = {
  upiId: 'switchyard@nyes',
  payeeName: 'Saurabh Prajapat',
  transactionNote: 'Support Switchyard',
};

export interface SupportConfig {
  upiId: string;
  payeeName: string;
  transactionNote: string;
}

export type SupportConfigCheck =
  | { ok: true }
  | { ok: false; reason: 'upiIdNotConfigured' | 'upiIdInvalid' | 'payeeNameNotConfigured' | 'payeeNameInvalid' | 'noteInvalid' };

const PLACEHOLDER = /REPLACE_WITH|YOUR_UPI|YOUR_PAYEE|yourname@/i;
const UPI_ID = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isUsableText(value: string, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !CONTROL_CHARS.test(value);
}

/** Checks that the support details are real values, not placeholders. */
export function checkSupportConfig(config: SupportConfig): SupportConfigCheck {
  const upiId = (config.upiId ?? '').trim();
  const payeeName = (config.payeeName ?? '').trim();
  const note = config.transactionNote ?? '';

  if (!upiId || PLACEHOLDER.test(upiId)) return { ok: false, reason: 'upiIdNotConfigured' };
  if (!UPI_ID.test(upiId)) return { ok: false, reason: 'upiIdInvalid' };
  if (!payeeName || PLACEHOLDER.test(payeeName)) return { ok: false, reason: 'payeeNameNotConfigured' };
  if (!isUsableText(payeeName, 99)) return { ok: false, reason: 'payeeNameInvalid' };
  if (!isUsableText(note, 80)) return { ok: false, reason: 'noteInvalid' };
  return { ok: true };
}

/**
 * Percent-encodes a UPI query value (spaces become `%20`, not `+`).
 * `@` is left as-is: it is legal in a URI query (RFC 3986) and some UPI apps
 * fail to decode `%40` in the payee address.
 */
function encodeUpiValue(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, '@');
}

/**
 * Builds `upi://pay?pa=…&pn=…&tn=…&cu=INR`.
 * Deliberately has no `am` (amount) parameter so the payer chooses the amount.
 * Throws if the config is not usable; call {@link checkSupportConfig} first.
 */
export function buildUpiPaymentUri(config: SupportConfig): string {
  const check = checkSupportConfig(config);
  if (!check.ok) {
    throw new Error(`Support config is not usable: ${check.reason}`);
  }
  const params: Array<[string, string]> = [
    ['pa', config.upiId.trim()],
    ['pn', config.payeeName.trim()],
    ['tn', config.transactionNote.trim()],
    ['cu', 'INR'],
  ];
  const query = params.map(([k, v]) => `${k}=${encodeUpiValue(v)}`).join('&');
  return `upi://pay?${query}`;
}
