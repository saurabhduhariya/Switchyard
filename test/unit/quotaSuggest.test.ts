import { describe, expect, it } from 'vitest';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';
import { readBuckets } from '../../src/shared/quotaRules';
import { suggestBestAccount } from '../../src/shared/quotaSuggest';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

interface Opts {
  tier?: string;
  g?: [number, number?]; // gemini weekly, 5h
  c?: [number, number?]; // claude weekly, 5h
  gReset?: number; // weekly reset offset from NOW
  updatedAt?: number;
  source?: 'live' | 'cache';
}

function quota(o: Opts = {}): AccountQuotaSummary {
  const tier = o.tier ?? 'Google AI Pro Quota';
  const five = !tier.includes('Starter');
  const bucket = (pct: number | undefined, resetOffset: number) =>
    pct === undefined ? undefined : { remainingPercent: pct, resetTime: iso(resetOffset) };
  return {
    tierName: tier,
    updatedAt: o.updatedAt ?? NOW - 60_000,
    source: o.source ?? 'live',
    gemini: {
      name: 'Gemini',
      weekly: bucket(o.g?.[0], o.gReset ?? 3 * DAY),
      fiveHour: five ? bucket(o.g?.[1], 2 * HOUR) : undefined,
    },
    claudeGpt: {
      name: 'Claude + GPT',
      weekly: bucket(o.c?.[0], 4 * DAY),
      fiveHour: five ? bucket(o.c?.[1], 2 * HOUR) : undefined,
    },
  };
}

function acct(id: string, q?: AccountQuotaSummary, extra: Partial<AccountMeta> = {}): AccountMeta {
  return { id, email: `${id}@example.com`, addedAt: 1, quota: q, ...extra } as AccountMeta;
}

describe('suggestBestAccount', () => {
  it('suggests nothing when the active account is fine', () => {
    const accounts = [acct('a', quota({ g: [60, 80], c: [70, 90] })), acct('b', quota({ g: [100, 100], c: [100, 100] }))];
    expect(suggestBestAccount(accounts, 'a', NOW)).toBeUndefined();
  });

  it('suggests nothing without an active account, without quota, or without other accounts', () => {
    expect(suggestBestAccount([acct('a', quota({ g: [5, 5], c: [5, 5] }))], undefined, NOW)).toBeUndefined();
    expect(suggestBestAccount([acct('a')], 'a', NOW)).toBeUndefined();
    expect(suggestBestAccount([acct('a', quota({ g: [5, 50], c: [80, 80] }))], 'a', NOW)).toBeUndefined();
  });

  it('suggests the account with the most left in the bucket that is running out', () => {
    const accounts = [
      acct('a', quota({ g: [8, 70], c: [90, 90] })), // active: Gemini weekly low
      acct('b', quota({ g: [40, 80], c: [100, 100] })),
      acct('c', quota({ g: [95, 80], c: [20, 50] })),
    ];
    const s = suggestBestAccount(accounts, 'a', NOW)!;
    expect(s.accountId).toBe('c'); // 95% Gemini weekly beats 40%
    expect(s.lowText).toBe('Gemini weekly 8%');
    expect(s.betterText).toBe('Gemini weekly 95%');
    expect(s.estimated).toBe(false);
  });

  it('only compares the bucket that is low, not the model that is fine', () => {
    const accounts = [
      acct('a', quota({ g: [100, 100], c: [3, 60] })), // Claude weekly low
      acct('b', quota({ g: [0, 0], c: [80, 80] })), // Gemini exhausted but Claude healthy: fine
    ];
    expect(suggestBestAccount(accounts, 'a', NOW)?.accountId).toBe('b');
  });

  it('does not suggest an account that is itself too low (needs at least 25%)', () => {
    const accounts = [acct('a', quota({ g: [5, 50], c: [50, 50] })), acct('b', quota({ g: [24, 50], c: [50, 50] }))];
    expect(suggestBestAccount(accounts, 'a', NOW)).toBeUndefined();
  });

  it('skips accounts with no quota data', () => {
    const accounts = [acct('a', quota({ g: [5, 50], c: [50, 50] })), acct('b')];
    expect(suggestBestAccount(accounts, 'a', NOW)).toBeUndefined();
  });

  it('marks a candidate whose reset passed as an estimate', () => {
    const accounts = [
      acct('a', quota({ g: [5, 50], c: [50, 50] })),
      acct('b', quota({ g: [0, 0], c: [0, 0], gReset: -2 * DAY, updatedAt: NOW - 4 * DAY })), // refilled by now
    ];
    const s = suggestBestAccount(accounts, 'a', NOW)!;
    expect(s.accountId).toBe('b');
    expect(s.betterText).toBe('Gemini weekly ~100%');
    expect(s.estimated).toBe(true);
  });

  it('does not suggest based on a stale low reading whose reset has already passed', () => {
    const stale = quota({ g: [2, 50], c: [50, 50], gReset: -HOUR, source: 'cache', updatedAt: NOW - 3 * DAY });
    const accounts = [acct('a', stale), acct('b', quota({ g: [100, 100], c: [100, 100] }))];
    expect(suggestBestAccount(accounts, 'a', NOW)).toBeUndefined();
  });

  it('a Starter account has no 5h window, so it cannot be verified for a low 5h bucket', () => {
    const accounts = [
      acct('a', quota({ g: [100, 6], c: [100, 100] })), // Gemini 5h low
      acct('starter', quota({ tier: 'Antigravity Starter Quota', g: [100], c: [100] })),
      acct('pro', quota({ g: [100, 20], c: [100, 100] })), // 5h only 20%: below healthy
    ];
    expect(suggestBestAccount(accounts, 'a', NOW)).toBeUndefined();
    const withGood = [...accounts, acct('pro2', quota({ g: [100, 90], c: [100, 100] }))];
    expect(suggestBestAccount(withGood, 'a', NOW)?.accountId).toBe('pro2');
  });

  it('breaks ties by overall health, then by email, deterministically', () => {
    const accounts = [
      acct('a', quota({ g: [5, 50], c: [50, 50] })),
      acct('z', quota({ g: [90, 50], c: [10, 50] })),
      acct('m', quota({ g: [90, 50], c: [60, 50] })),
    ];
    expect(suggestBestAccount(accounts, 'a', NOW)?.accountId).toBe('m');
    const same = [
      acct('a', quota({ g: [5, 50], c: [50, 50] })),
      acct('y', quota({ g: [90, 50], c: [60, 50] })),
      acct('x', quota({ g: [90, 50], c: [60, 50] })),
    ];
    expect(suggestBestAccount(same, 'a', NOW)?.accountId).toBe('x');
  });

  it('lists several low buckets and keeps the key stable for the same situation', () => {
    const accounts = [
      acct('a', quota({ g: [4, 50], c: [7, 50] })),
      acct('b', quota({ g: [100, 100], c: [100, 100] })),
    ];
    const first = suggestBestAccount(accounts, 'a', NOW)!;
    const second = suggestBestAccount(accounts, 'a', NOW + 60_000)!;
    expect(first.lowText).toBe('Gemini weekly 4%, Claude + GPT weekly 7%');
    expect(first.key).toBe(second.key);
  });

  it('the key changes when the low bucket gets a new reset window', () => {
    const b = acct('b', quota({ g: [100, 100], c: [100, 100] }));
    const k1 = suggestBestAccount([acct('a', quota({ g: [4, 50], c: [50, 50] })), b], 'a', NOW)!.key;
    const k2 = suggestBestAccount([acct('a', quota({ g: [4, 50], c: [50, 50], gReset: 7 * DAY })), b], 'a', NOW)!.key;
    expect(k2).not.toBe(k1);
  });

  it('the key changes when a different account becomes the best one', () => {
    const a = acct('a', quota({ g: [4, 50], c: [50, 50] }));
    const b = acct('b', quota({ g: [60, 100], c: [60, 100] }));
    const c = acct('c', quota({ g: [100, 100], c: [100, 100] }));
    const before = suggestBestAccount([a, b], 'a', NOW)!;
    const after = suggestBestAccount([a, b, c], 'a', NOW)!;
    expect(before.accountId).toBe('b');
    expect(after.accountId).toBe('c');
    expect(after.key).not.toBe(before.key);
  });

  it('suggests an account that rescues at least one low bucket when multiple are low', () => {
    const accounts = [
      acct('a', quota({ tier: 'Antigravity Starter Quota', g: [0], c: [4.57] })),
      acct('b', quota({ tier: 'Google AI Pro Quota', g: [79.92, 77.84], c: [0, 0] })),
    ];
    const s = suggestBestAccount(accounts, 'a', NOW)!;
    expect(s).toBeDefined();
    expect(s.accountId).toBe('b');
    expect(s.lowText).toBe('Gemini weekly 0%');
    expect(s.betterText).toBe('Gemini weekly 79.92%');
  });
});

describe('readBuckets', () => {
  it('skips the 5h window for the Starter tier and disabled buckets', () => {
    const q = quota({ tier: 'Antigravity Starter Quota', g: [50], c: [60] });
    q.claudeGpt.weekly = { remainingPercent: 60, disabled: true };
    expect(readBuckets(q).map((b) => b.label)).toEqual(['Gemini weekly']);
  });

  it('reads the older flat fields too', () => {
    const q: AccountQuotaSummary = {
      tierName: 'Google AI Pro Quota',
      updatedAt: NOW,
      source: 'live',
      gemini: { name: 'Gemini', weeklyRemaining: 12, weeklyResetTime: iso(DAY), rolling5hRemaining: 40 },
      claudeGpt: { name: 'Claude + GPT' },
    };
    expect(readBuckets(q).map((r) => [r.label, r.percent])).toEqual([
      ['Gemini weekly', 12],
      ['Gemini 5h', 40],
    ]);
  });

  it('uses remainingFraction when no percent is given', () => {
    const q = quota({ g: [50, 50], c: [50, 50] });
    q.gemini.weekly = { remainingFraction: 0.07, resetTime: iso(DAY) };
    expect(readBuckets(q)[0]!.percent).toBeCloseTo(7);
  });

  it('returns nothing without a summary', () => {
    expect(readBuckets(undefined)).toEqual([]);
  });
});
