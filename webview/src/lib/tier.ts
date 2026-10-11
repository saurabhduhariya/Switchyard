/**
 * Helpers about an account's Antigravity tier and how to present its quota.
 */

/**
 * The Starter (free) tier has a weekly quota only; there is no rolling 5-hour window.
 * Matches the names the extension produces ("Antigravity Starter Quota") and the raw ids.
 */
export function isStarterTier(tierName?: string): boolean {
  if (!tierName) return false;
  return /\b(starter|free)\b|starter-tier|free-tier/i.test(tierName);
}

/** Whether the rolling 5-hour window exists for this tier. */
export function hasFiveHourWindow(tierName?: string): boolean {
  return !isStarterTier(tierName);
}

/**
 * Short label for the tier pill so it never gets cut off:
 * "Antigravity Starter Quota" -> "Starter", "Google AI Pro Quota" -> "Google AI Pro".
 * The full name stays available as a tooltip.
 */
export function shortTierName(tierName?: string): string {
  if (!tierName) return 'Quota';
  const short = tierName
    .replace(/^Antigravity\s+/i, '')
    .replace(/\s+Quota$/i, '')
    .trim();
  return short || tierName;
}

export type QuotaTone = 'good' | 'warn' | 'low' | 'unknown';

/** Colour band for the remaining percentage. Never the only signal: the number is always shown. */
export function quotaTone(remainingPercent?: number): QuotaTone {
  if (remainingPercent === undefined || remainingPercent === null || isNaN(remainingPercent)) {
    return 'unknown';
  }
  if (remainingPercent <= 10) return 'low';
  if (remainingPercent <= 30) return 'warn';
  return 'good';
}

/** Clamp to 0-100 for drawing a bar. */
export function barWidth(remainingPercent?: number): number {
  if (remainingPercent === undefined || remainingPercent === null || isNaN(remainingPercent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, remainingPercent));
}

/** Quota data older than this is probably out of date for accounts that are not live. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStale(updatedAt?: number, now: number = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - updatedAt > STALE_AFTER_MS;
}
