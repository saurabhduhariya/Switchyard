import { describe, expect, it } from 'vitest';
import { rankCarouselCandidates, selectNextCarouselAccount } from '../../src/shared/accountCarousel';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function quota(g: [number, number], c: [number, number], resetOffsetMs = 3 * DAY): AccountQuotaSummary {
  return {
    tierName: 'Google AI Pro Quota',
    updatedAt: NOW - 60_000,
    source: 'cache',
    gemini: {
      name: 'Gemini',
      weekly: { remainingPercent: g[0], resetTime: iso(resetOffsetMs) },
      fiveHour: { remainingPercent: g[1], resetTime: iso(2 * HOUR) },
    },
    claudeGpt: {
      name: 'Claude + GPT',
      weekly: { remainingPercent: c[0], resetTime: iso(4 * DAY) },
      fiveHour: { remainingPercent: c[1], resetTime: iso(2 * HOUR) },
    },
  };
}

function acct(id: string, extra: Partial<AccountMeta> = {}): AccountMeta {
  return { id, email: `${id}@example.com`, addedAt: 1, ...extra };
}

describe('accountCarousel', () => {
  it('returns undefined when there are no other candidates', () => {
    expect(selectNextCarouselAccount([], undefined, NOW)).toBeUndefined();
    expect(selectNextCarouselAccount([acct('a')], 'a', NOW)).toBeUndefined();
  });

  it('prioritizes pinned healthy accounts over unpinned higher-quota accounts', () => {
    const accounts = [
      acct('active', { quota: quota([10, 10], [10, 10]) }),
      acct('unpinned-full', { quota: quota([100, 100], [100, 100]) }),
      acct('pinned-healthy', { pinned: true, quota: quota([70, 80], [60, 75]) }),
    ];
    expect(selectNextCarouselAccount(accounts, 'active', NOW)?.id).toBe('pinned-healthy');
  });

  it('skips pinned account if exhausted and prefers healthy alternative', () => {
    const accounts = [
      acct('active', { quota: quota([10, 10], [10, 10]) }),
      acct('pinned-empty', { pinned: true, quota: quota([0, 0], [50, 50]) }),
      acct('healthy', { quota: quota([85, 80], [90, 80]) }),
    ];
    expect(selectNextCarouselAccount(accounts, 'active', NOW)?.id).toBe('healthy');
  });

  it('prefers higher quota within the same health tier', () => {
    const accounts = [
      acct('active', { quota: quota([5, 5], [5, 5]) }),
      acct('medium', { quota: quota([40, 50], [45, 50]) }),
      acct('best', { quota: quota([90, 95], [85, 95]) }),
    ];
    expect(selectNextCarouselAccount(accounts, 'active', NOW)?.id).toBe('best');
  });

  it('uses estimated reset values when inactive accounts have passed their reset time', () => {
    const staleResetPassed: AccountQuotaSummary = {
      tierName: 'Antigravity Starter Quota',
      updatedAt: NOW - 3 * DAY,
      source: 'cache',
      gemini: { name: 'Gemini', weekly: { remainingPercent: 0, resetTime: iso(-2 * HOUR) } },
      claudeGpt: { name: 'Claude + GPT', weekly: { remainingPercent: 0, resetTime: iso(-2 * HOUR) } },
    };
    const accounts = [
      acct('active', { quota: quota([5, 5], [5, 5]) }),
      acct('refilled', { plan: 'Free', quota: staleResetPassed }),
      acct('low', { quota: quota([20, 20], [20, 20]) }),
    ];
    expect(selectNextCarouselAccount(accounts, 'active', NOW)?.id).toBe('refilled');
  });

  it('uses LRU lastUsedAt to cycle evenly when accounts tie on health and quota', () => {
    const a = acct('a', { lastUsedAt: NOW - 1 * HOUR, quota: quota([100, 100], [100, 100]) });
    const b = acct('b', { lastUsedAt: NOW - 5 * HOUR, quota: quota([100, 100], [100, 100]) });
    const c = acct('c', { lastUsedAt: NOW - 3 * HOUR, quota: quota([100, 100], [100, 100]) });

    // On 'a', 'b' was used longest ago -> switches to 'b'
    expect(selectNextCarouselAccount([a, b, c], 'a', NOW)?.id).toBe('b');

    // Now simulate 'b' just became most recently used, leaving 'c' older than 'a' -> switches to 'c'
    const bRecent = { ...b, lastUsedAt: NOW };
    expect(selectNextCarouselAccount([a, bRecent, c], 'b', NOW)?.id).toBe('c');

    const ranked = rankCarouselCandidates([a, bRecent, c], 'b', NOW);
    expect(ranked.map((x) => x.id)).toEqual(['c', 'a']);
  });
});

