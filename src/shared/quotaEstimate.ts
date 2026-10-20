import type { AccountQuotaSummary, ModelQuotaGroup, QuotaBucket } from './messages';

/**
 * Offline estimate for quota numbers that are no longer fresh.
 *
 * Antigravity only reports quota for the account that is signed in right now, so other
 * accounts keep the numbers from the last time they were active. Each bucket carries the time
 * it resets, though. If that time has already passed, the bucket has refilled, so showing the
 * old "0% left" would be misleading. This module marks such buckets as an estimated 100%.
 *
 * It never makes a network call and never changes stored data: it only affects what is shown.
 * It cannot know about usage that happened elsewhere (another device or the web), which is why
 * every changed bucket is flagged `estimated` and the UI labels it.
 */

/** Data from the signed-in account counts as fresh for this long. */
export const LIVE_FRESH_MS = 15 * 60 * 1000;

function parseTime(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/** Combines a bucket with the older flat fields so both shapes are handled the same way. */
function toBucket(
  bucket: QuotaBucket | undefined,
  fallbackPercent?: number,
  fallbackReset?: string
): QuotaBucket | undefined {
  if (bucket) return bucket;
  if (fallbackPercent === undefined && !fallbackReset) return undefined;
  return { remainingPercent: fallbackPercent, resetTime: fallbackReset };
}

/** Returns the bucket unchanged, or a refilled copy if its reset time has passed. */
export function estimateBucket(bucket: QuotaBucket | undefined, now: number): QuotaBucket | undefined {
  if (!bucket || bucket.disabled) return bucket;

  const resetAt = parseTime(bucket.resetTime);
  if (resetAt === undefined || resetAt > now) return bucket;

  const remaining =
    bucket.remainingPercent ??
    (bucket.remainingFraction !== undefined ? bucket.remainingFraction * 100 : undefined);
  // Nothing to correct when it was already full or we never knew the amount.
  if (remaining === undefined || remaining >= 100) return bucket;

  return {
    ...bucket,
    remainingPercent: 100,
    remainingFraction: 1,
    resetTime: undefined, // the next reset is unknown until the account is active again
    estimated: true,
  };
}

function estimateGroup(group: ModelQuotaGroup, now: number): ModelQuotaGroup {
  return {
    ...group,
    weekly: estimateBucket(
      toBucket(group.weekly, group.weeklyRemaining, group.weeklyResetTime),
      now
    ),
    fiveHour: estimateBucket(
      toBucket(group.fiveHour, group.rolling5hRemaining, group.rolling5hResetTime),
      now
    ),
  };
}

export function estimateQuotaSummary(
  quota: AccountQuotaSummary | undefined,
  now: number = Date.now()
): AccountQuotaSummary | undefined {
  if (!quota) return quota;
  return {
    ...quota,
    gemini: estimateGroup(quota.gemini, now),
    claudeGpt: estimateGroup(quota.claudeGpt, now),
  };
}

/** Whether any bucket in the summary is an estimate (used to show a legend). */
export function hasEstimates(quota: AccountQuotaSummary | undefined): boolean {
  if (!quota) return false;
  return [quota.gemini, quota.claudeGpt].some(
    (g) => g?.weekly?.estimated === true || g?.fiveHour?.estimated === true
  );
}

/**
 * Decides whether to estimate for a card.
 * - Accounts that are not active are never refreshed live, so always estimate.
 * - The active account is estimated only when its numbers did not come from a recent live read.
 */
export function shouldEstimate(
  quota: AccountQuotaSummary | undefined,
  isActive: boolean,
  now: number = Date.now()
): boolean {
  if (!quota) return false;
  if (!isActive) return true;
  return quota.source !== 'live' || now - quota.updatedAt > LIVE_FRESH_MS;
}
