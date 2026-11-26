import type { AccountMeta } from './messages';
import { estimateQuotaSummary } from './quotaEstimate';
import { HEALTHY_QUOTA_PERCENT, readBuckets } from './quotaRules';

interface CarouselCandidate {
  account: AccountMeta;
  tierRank: number;
  minPercent: number;
  avgPercent: number;
}

function scoreCandidate(account: AccountMeta, now: number): CarouselCandidate {
  const pinned = account.pinned === true;
  const readings = account.quota
    ? readBuckets(estimateQuotaSummary(account.quota, now), account.plan).filter(
        (b): b is typeof b & { percent: number } => b.percent !== undefined && !Number.isNaN(b.percent)
      )
    : [];

  if (readings.length === 0) {
    return {
      account,
      tierRank: pinned ? 1 : 0,
      minPercent: -1,
      avgPercent: -1,
    };
  }

  const minPercent = Math.min(...readings.map((r) => r.percent));
  const avgPercent = readings.reduce((sum, r) => sum + r.percent, 0) / readings.length;

  let tierRank: number;
  if (minPercent >= HEALTHY_QUOTA_PERCENT) {
    tierRank = pinned ? 5 : 4;
  } else if (minPercent > 0) {
    tierRank = pinned ? 3 : 2;
  } else {
    tierRank = pinned ? -1 : -2;
  }

  return { account, tierRank, minPercent, avgPercent };
}

/**
 * Ranks candidate accounts (excluding `activeId`) for carousel switching.
 * Prioritizes pinned & healthy accounts with highest remaining quota, falling back to
 * LRU (`lastUsedAt` oldest first) and email order so tied accounts rotate evenly.
 */
export function rankCarouselCandidates(
  accounts: AccountMeta[],
  activeId: string | undefined,
  now: number = Date.now()
): AccountMeta[] {
  const candidates = accounts
    .filter((a) => a.id !== activeId)
    .map((a) => scoreCandidate(a, now));

  candidates.sort((a, b) => {
    if (b.tierRank !== a.tierRank) return b.tierRank - a.tierRank;
    if (b.minPercent !== a.minPercent) return b.minPercent - a.minPercent;
    if (b.avgPercent !== a.avgPercent) return b.avgPercent - a.avgPercent;
    const aUsed = a.account.lastUsedAt ?? 0;
    const bUsed = b.account.lastUsedAt ?? 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.account.email.localeCompare(b.account.email);
  });

  return candidates.map((c) => c.account);
}

/** Picks the next best candidate account for the quick-switch carousel. */
export function selectNextCarouselAccount(
  accounts: AccountMeta[],
  activeId: string | undefined,
  now: number = Date.now()
): AccountMeta | undefined {
  return rankCarouselCandidates(accounts, activeId, now)[0];
}
