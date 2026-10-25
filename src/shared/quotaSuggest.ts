import type { AccountMeta, SwitchSuggestion } from './messages';
import { estimateQuotaSummary, shouldEstimate } from './quotaEstimate';
import { type BucketReading, HEALTHY_QUOTA_PERCENT, LOW_QUOTA_PERCENT, readBuckets } from './quotaRules';

function formatPercent(percent: number, estimated: boolean): string {
  const rounded = Math.round(percent * 100) / 100;
  return `${estimated ? '~' : ''}${rounded}%`;
}

function joinTexts(parts: string[]): string {
  if (parts.length <= 2) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
}

/**
 * Suggests a better account when the signed-in one is running low.
 *
 * - "Low" means a bucket at or below LOW_QUOTA_PERCENT.
 * - Only buckets that are low are compared. A candidate must have at least HEALTHY_QUOTA_PERCENT
 *   in each of them that it has (Starter accounts have no 5-hour window, so that one does not count against them).
 * - The signed-in account's own numbers are estimated when they are not a recent live read, so a
 *   stale "0%" whose reset already passed does not trigger a suggestion.
 * - Other accounts are never live, so their numbers are estimated and flagged as such.
 *
 * Pure: no I/O, no clock other than `now`.
 */
export function suggestBestAccount(
  accounts: AccountMeta[],
  activeId: string | undefined,
  now: number = Date.now()
): SwitchSuggestion | undefined {
  if (!activeId) return undefined;
  const active = accounts.find((a) => a.id === activeId);
  if (!active?.quota) return undefined;

  const activeQuota = shouldEstimate(active.quota, true, now)
    ? estimateQuotaSummary(active.quota, now)
    : active.quota;

  const lowBuckets = readBuckets(activeQuota).filter(
    (b) => b.percent !== undefined && b.percent <= LOW_QUOTA_PERCENT
  );
  if (lowBuckets.length === 0) return undefined;

  interface Candidate {
    account: AccountMeta;
    verified: BucketReading[];
    score: number;
  }
  const candidates: Candidate[] = [];

  for (const account of accounts) {
    if (account.id === activeId || !account.quota) continue;
    const readings = readBuckets(estimateQuotaSummary(account.quota, now));

    const verified: BucketReading[] = [];
    for (const low of lowBuckets) {
      const match = readings.find((r) => r.group === low.group && r.window === low.window);
      if (match && match.percent !== undefined) verified.push(match);
    }
    if (verified.length === 0) continue;
    if (verified.some((r) => (r.percent as number) < HEALTHY_QUOTA_PERCENT)) continue;

    const worst = Math.min(...verified.map((r) => r.percent as number));
    const weekly = readings.filter((r) => r.window === 'weekly' && r.percent !== undefined);
    const weeklyAvg = weekly.length
      ? weekly.reduce((sum, r) => sum + (r.percent as number), 0) / weekly.length
      : 0;
    // The bucket that is running out matters most; the rest of the account breaks ties.
    candidates.push({ account, verified, score: worst + weeklyAvg * 0.1 });
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => b.score - a.score || a.account.email.localeCompare(b.account.email));
  const best = candidates[0];
  if (!best) return undefined;

  const signature = lowBuckets.map((b) => `${b.group}.${b.window}@${b.resetTime ?? ''}`).join(',');
  return {
    key: `${activeId}|${signature}|${best.account.id}`,
    accountId: best.account.id,
    lowText: joinTexts(lowBuckets.map((b) => `${b.label} ${formatPercent(b.percent as number, false)}`)),
    betterText: joinTexts(
      best.verified.map((b) => `${b.label} ${formatPercent(b.percent as number, b.estimated === true)}`)
    ),
    estimated: best.verified.some((b) => b.estimated === true),
  };
}
