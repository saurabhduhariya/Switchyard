/**
 * Email masking utility.
 * "rahul@gmail.com" → "r****@gmail.com"
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at);

  if (local.length <= 1) {
    return `${local}****${domain}`;
  }
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 4))}${domain}`;
}
