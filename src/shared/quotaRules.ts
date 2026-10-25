import type { AccountQuotaSummary, ModelQuotaGroup } from './messages';
import { toBucket } from './quotaEstimate';

/** At or below this remaining percentage a bucket counts as low / exhausted. */
export const LOW_QUOTA_PERCENT = 10;

/** A suggested account must have at least this much left in the bucket that is running out. */
export const HEALTHY_QUOTA_PERCENT = 25;

/**
 * The Starter (free) tier has a weekly quota only; there is no rolling 5-hour window.
 * Matches the names the extension produces ("Antigravity Starter Quota") and the raw ids.
 */
export function isStarterTier(tierName?: string): boolean {
  if (!tierName) return false;
  return /\b(starter|free)\b|starter-tier|free-tier/i.test(tierName);
}

export function hasFiveHourWindow(tierName?: string): boolean {
  return !isStarterTier(tierName);
}

/**
 * Detects whether a tier name or plan represents Google AI Ultra.
 */
export function isUltraTier(tierOrPlan?: string): boolean {
  if (!tierOrPlan) return false;
  return /\bultra\b|g1-ultra/i.test(tierOrPlan);
}

/**
 * Detects whether a tier name or plan represents Google AI Pro.
 */
export function isProTier(tierOrPlan?: string): boolean {
  if (!tierOrPlan) return false;
  return !isUltraTier(tierOrPlan) && /\bpro\b|g1-pro/i.test(tierOrPlan);
}

/**
 * Validates whether an incoming quota payload is compatible with an account's plan.
 * Protects against cross-account contamination when switching between Starter, Pro, Ultra, and other plans.
 */
export function isPlanTierCompatible(plan: string | undefined, quota: AccountQuotaSummary): boolean {
  if (!plan) return true;
  const tierName = quota.tierName;

  // 1. Starter accounts must never receive a 5-hour window or paid tier name
  if (isStarterTier(plan)) {
    if (quota.gemini?.fiveHour || quota.claudeGpt?.fiveHour) return false;
    if (tierName && !isStarterTier(tierName)) return false;
    return true;
  }

  // 2. Paid accounts (Pro, Ultra, etc.) must never receive a degraded Starter quota lacking a 5h window
  if (tierName && isStarterTier(tierName) && !quota.gemini?.fiveHour) {
    return false;
  }

  // 3. Ultra accounts must never receive a Pro-specific quota
  if (isUltraTier(plan)) {
    if (tierName && isProTier(tierName)) return false;
    return true;
  }

  // 4. Pro accounts must never receive an Ultra-specific quota
  if (isProTier(plan)) {
    if (tierName && isUltraTier(tierName)) return false;
    return true;
  }

  return true;
}

export type QuotaGroupKey = 'gemini' | 'claudeGpt';
export type QuotaWindowKey = 'weekly' | 'fiveHour';

/** One quota bucket in a normalised, easy-to-compare form. */
export interface BucketReading {
  group: QuotaGroupKey;
  window: QuotaWindowKey;
  /** "Gemini weekly", "Claude + GPT 5h" */
  label: string;
  /** Remaining percentage 0-100, undefined when unknown. */
  percent?: number;
  resetTime?: string;
  estimated?: boolean;
}

const GROUP_LABEL: Record<QuotaGroupKey, string> = {
  gemini: 'Gemini',
  claudeGpt: 'Claude + GPT',
};

const WINDOW_LABEL: Record<QuotaWindowKey, string> = {
  weekly: 'weekly',
  fiveHour: '5h',
};

export function bucketLabel(group: QuotaGroupKey, window: QuotaWindowKey): string {
  return `${GROUP_LABEL[group]} ${WINDOW_LABEL[window]}`;
}

function readGroup(
  key: QuotaGroupKey,
  group: ModelQuotaGroup | undefined,
  includeFiveHour: boolean
): BucketReading[] {
  if (!group) return [];
  const out: BucketReading[] = [];
  const windows: Array<[QuotaWindowKey, ReturnType<typeof toBucket>]> = [
    ['weekly', toBucket(group.weekly, group.weeklyRemaining, group.weeklyResetTime)],
  ];
  if (includeFiveHour) {
    windows.push(['fiveHour', toBucket(group.fiveHour, group.rolling5hRemaining, group.rolling5hResetTime)]);
  }
  for (const [window, bucket] of windows) {
    if (!bucket || bucket.disabled) continue;
    const percent =
      bucket.remainingPercent ??
      (bucket.remainingFraction !== undefined ? bucket.remainingFraction * 100 : undefined);
    out.push({
      group: key,
      window,
      label: bucketLabel(key, window),
      percent,
      resetTime: bucket.resetTime,
      estimated: bucket.estimated === true,
    });
  }
  return out;
}

/** All usable buckets of a quota summary. The Starter tier has no 5-hour window, so none is listed. */
export function readBuckets(quota: AccountQuotaSummary | undefined, tierOrPlan?: string): BucketReading[] {
  if (!quota) return [];
  const effectiveTier =
    (tierOrPlan && !isStarterTier(tierOrPlan) ? tierOrPlan : undefined) ||
    quota.tierName ||
    tierOrPlan;
  const includeFiveHour = hasFiveHourWindow(effectiveTier);
  return [
    ...readGroup('gemini', quota.gemini, includeFiveHour),
    ...readGroup('claudeGpt', quota.claudeGpt, includeFiveHour),
  ];
}

/** Short display name for an account, matching the panel ("label" or the part before the @). */
export function accountDisplayName(account: { label?: string; email: string }): string {
  return account.label || account.email.split('@')[0] || account.email;
}
