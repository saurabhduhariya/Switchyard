export interface RedactOptions {
  redactEmail?: boolean;
}

/**
 * Redacts sensitive tokens (OAuth tokens, refresh tokens, long base64 blocks)
 * and optionally emails from text strings.
 */
export function redact(input: string, options: RedactOptions = {}): string {
  if (!input || typeof input !== 'string') {
    return input;
  }

  let result = input;

  // Mask OAuth access tokens (ya29.*)
  result = result.replace(/ya29\.[A-Za-z0-9._-]+/g, 'ya29.***');

  // Mask Google refresh tokens (1//* or 1%2F%2F*)
  result = result.replace(/1(\/\/|%2F%2F)[A-Za-z0-9._-]+/g, '1//***');

  // Mask Bearer authorization headers
  result = result.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer ***');

  // Mask long base64 strings (>= 32 chars of pure base64)
  result = result.replace(/[A-Za-z0-9+/=]{32,}/g, (match) => `[REDACTED_B64_${match.length}]`);

  // Optionally mask email addresses
  if (options.redactEmail) {
    result = result.replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1***$2');
  }

  return result;
}
