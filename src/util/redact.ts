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
  result = result.replace(/ya29\.[A-Za-z0-9._-]+/g, 'ya29.***');
  result = result.replace(/1(\/\/|%2F%2F)[A-Za-z0-9._-]+/g, '1//***');
  result = result.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer ***');
  result = result.replace(/[A-Za-z0-9+/=]{32,}/g, (match) => `[REDACTED_B64_${match.length}]`);

  if (options.redactEmail) {
    result = result.replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1***$2');
  }

  return result;
}
