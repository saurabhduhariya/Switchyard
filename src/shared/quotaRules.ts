import type { AccountQuotaSummary, ModelQuotaGroup } from './messages';
import { toBucket } from './quotaEstimate';

/** At or below this remaining percentage a bucket counts as low / exhausted. */
export const LOW_QUOTA_PERCENT = 10;

/** A suggested account must have at least this much left in the bucket that is running out. */
export const HEALTHY_QUOTA_PERCENT = 25;

export type TierId = 'starter' | 'ultra' | 'pro';

/** Which quota windows exist for a tier. A window that does not exist is never shown or compared. */
export interface QuotaWindows {
  weekly: boolean;
  fiveHour: boolean;
}

export interface TierSpec {
  id: TierId;
  /** Friendly name, for documentation and tests. */
  label: string;
  /** Matches tier names ("Google AI Pro Quota") and raw ids ("g1-pro-tier"). Never use the g flag. */
  match: RegExp;
  windows: QuotaWindows;
}

/**
 * The known tiers and the quota windows each one has. To support a new tier, or to change which
 * windows a tier has, edit this table; everything else (panel, notifications, hints, compatibility
 * checks) follows from it.
 *
 * Order matters when a name matches more than one entry: the first match wins, and Starter is first
 * so a free account is never shown a 5-hour window.
 *
 * Starter (free) has a weekly quota only. Pro and Ultra have both a weekly and a 5-hour window.
 * Tiers that are not listed get both windows (see DEFAULT_WINDOWS).
 */
export const TIERS: readonly TierSpec[] = [
  {
    id: 'starter',
    label: 'Antigravity Starter',
    match: /\b(starter|free)\b|starter-tier|free-tier/i,
    windows: { weekly: true, fiveHour: false },
  },
  {
    id: 'ultra',
    label: 'Google AI Ultra',
    match: /\bultra\b|g1-ultra/i,
    windows: { weekly: true, fiveHour: true },
  },
  {
    id: 'pro',
    label: 'Google AI Pro',
    match: /\bpro\b|g1-pro/i,
    windows: { weekly: true, fiveHour: true },
  },
];

/** Used for tiers that are not in the table (for example a generic "Antigravity Quota"). */
export const DEFAULT_WINDOWS: QuotaWindows = { weekly: true, fiveHour: true };

function matchesTier(id: TierId, text?: string): boolean {
  if (!text) return false;
  const spec = TIERS.find((t) => t.id === id);
  return spec ? spec.match.test(text) : false;
}

/** The first table entry that matches this tier name or plan, if any. */
export function tierSpec(tierOrPlan?: string): TierSpec | undefined {
  if (!tierOrPlan) return undefined;
  return TIERS.find((t) => t.match.test(tierOrPlan));
}

/** Which quota windows exist for this tier. */
export function windowsForTier(tierOrPlan?: string): QuotaWindows {
  return tierSpec(tierOrPlan)?.windows ?? DEFAULT_WINDOWS;
}

/**
 * The Starter (free) tier has a weekly quota only; there is no rolling 5-hour window.
 * Matches the names the extension produces ("Antigravity Starter Quota") and the raw ids.
 */
export function isStarterTier(tierName?: string): boolean {
  return matchesTier('starter', tierName);
}

export function hasFiveHourWindow(tierName?: string): boolean {
  return windowsForTier(tierName).fiveHour;
}

/**
 * Detects whether a tier name or plan represents Google AI Ultra.
 */
export function isUltraTier(tierOrPlan?: string): boolean {
  return matchesTier('ultra', tierOrPlan);
}

/**
 * Detects whether a tier name or plan represents Google AI Pro.
 */
export function isProTier(tierOrPlan?: string): boolean {
  if (!tierOrPlan) return false;
  return !isUltraTier(tierOrPlan) && matchesTier('pro', tierOrPlan);
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
  windows: QuotaWindows
): BucketReading[] {
  if (!group) return [];
  const out: BucketReading[] = [];
  const wanted: Array<[QuotaWindowKey, ReturnType<typeof toBucket>]> = [];
  if (windows.weekly) {
    wanted.push(['weekly', toBucket(group.weekly, group.weeklyRemaining, group.weeklyResetTime)]);
  }
  if (windows.fiveHour) {
    wanted.push(['fiveHour', toBucket(group.fiveHour, group.rolling5hRemaining, group.rolling5hResetTime)]);
  }
  for (const [window, bucket] of wanted) {
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

/** All usable buckets of a quota summary. Windows the tier does not have (e.g. 5h on Starter) are never listed. */
export function readBuckets(quota: AccountQuotaSummary | undefined, tierOrPlan?: string): BucketReading[] {
  if (!quota) return [];
  const effectiveTier =
    (tierOrPlan && !isStarterTier(tierOrPlan) ? tierOrPlan : undefined) ||
    quota.tierName ||
    tierOrPlan;
  const windows = windowsForTier(effectiveTier);
  return [
    ...readGroup('gemini', quota.gemini, windows),
    ...readGroup('claudeGpt', quota.claudeGpt, windows),
  ];
}

/** Short display name for an account, matching the panel ("label" or the part before the @). */
export function accountDisplayName(account: { label?: string; email: string }): string {
  return account.label || account.email.split('@')[0] || account.email;
}
