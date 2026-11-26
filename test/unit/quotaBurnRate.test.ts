import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';
import {
  appendShortSample,
  computeAccountBurnRates,
  computeBucketBurnRate,
  pruneShortHistory,
  SHORT_HISTORY_MAX_AGE_MS,
  SHORT_MIN_SAMPLE_GAP_MS,
  shortSampleFromQuota,
  type ShortQuotaSample,
} from '../../src/shared/quotaBurnRate';
import { SHORT_QUOTA_HISTORY_KEY, ShortQuotaHistoryStore } from '../../src/quota/QuotaHistoryStore';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function makeQuota(opts: {
  gw?: number;
  g5?: number;
  cw?: number;
  c5?: number;
  tier?: string;
}): AccountQuotaSummary {
  const tier = opts.tier ?? 'Google AI Pro Quota';
  const bucket = (pct?: number) =>
    pct === undefined ? undefined : { remainingPercent: pct, resetTime: '2026-10-17T00:00:00Z' };
  return {
    tierName: tier,
    updatedAt: NOW,
    source: 'live',
    gemini: { name: 'Gemini', weekly: bucket(opts.gw), fiveHour: bucket(opts.g5) },
    claudeGpt: { name: 'Claude + GPT', weekly: bucket(opts.cw), fiveHour: bucket(opts.c5) },
  };
}

describe('quotaBurnRate', () => {
  it('extracts both weekly and 5h buckets respecting tier rules', () => {
    expect(shortSampleFromQuota(makeQuota({ gw: 84, g5: 60, cw: 90, c5: 42 }), NOW)).toEqual({
      t: NOW,
      gw: 84,
      g5: 60,
      cw: 90,
      c5: 42,
    });
    expect(
      shortSampleFromQuota(
        makeQuota({ gw: 84, g5: 60, cw: 90, c5: 42, tier: 'Antigravity Starter Quota' }),
        NOW
      )
    ).toEqual({ t: NOW, gw: 84, cw: 90 });
  });

  it('prunes samples older than 6 hours and avoids writing frequent duplicates', () => {
    const first: ShortQuotaSample = { t: NOW - 10 * MIN, gw: 90, g5: 80 };
    const r1 = appendShortSample([], first);
    expect(r1.changed).toBe(true);

    const dup = appendShortSample(r1.history, { t: NOW - 9 * MIN, gw: 90, g5: 80 });
    expect(dup.changed).toBe(false);

    const later = appendShortSample(r1.history, {
      t: NOW - 10 * MIN + SHORT_MIN_SAMPLE_GAP_MS,
      gw: 90,
      g5: 80,
    });
    expect(later.changed).toBe(true);

    const oldAndFresh = pruneShortHistory(
      [{ t: NOW - SHORT_HISTORY_MAX_AGE_MS - MIN, gw: 50 }, { t: NOW - MIN, gw: 40 }],
      NOW
    );
    expect(oldAndFresh).toEqual([{ t: NOW - MIN, gw: 40 }]);
  });

  it('computes EMA hourly burn rate and TTE across negative deltas and ignores resets', () => {
    // 18% dropped in 1h across two steps, after an earlier quota reset jump
    const samples: ShortQuotaSample[] = [
      { t: NOW - 180 * MIN, g5: 10 },
      { t: NOW - 60 * MIN, g5: 60 }, // reset upward -> restart velocity window
      { t: NOW - 30 * MIN, g5: 51 }, // -9% in 0.5h = 18%/h
      { t: NOW, g5: 42 }, // -9% in 0.5h = 18%/h
    ];

    const rate = computeBucketBurnRate(samples, 'g5', 42, NOW);
    expect(rate.burnRatePerHour).toBe(18);
    expect(rate.tteMinutes).toBe(Math.round((42 / 18) * 60));
  });

  it('decays burn rate smoothly when user has been idle past the grace period', () => {
    const samples: ShortQuotaSample[] = [
      { t: NOW - 90 * MIN, g5: 60 },
      { t: NOW - 60 * MIN, g5: 50 }, // 20%/h 1 hour ago, then completely idle for 60m
    ];
    const rate = computeBucketBurnRate(samples, 'g5', 50, NOW);
    expect(rate.burnRatePerHour).toBeLessThan(5);
  });

  it('falls back to 24h QuotaTrendSeries when short history has no drops', () => {
    const quota = makeQuota({ gw: 76, g5: 100 });
    const rates = computeAccountBurnRates([], quota, 'Pro', NOW, {
      gemini: { points: [100, 76], usedPercent: 24, spanHours: 4 },
    });
    expect(rates.gemini?.burnRatePerHour).toBe(6);
    expect(rates.gemini?.tteMinutes).toBe(Math.round((76 / 6) * 60));
  });

  it('persists short samples per account via ShortQuotaHistoryStore', async () => {
    const stored: Record<string, unknown> = {};
    const memento = {
      get: (k: string, d?: unknown) => (k in stored ? stored[k] : d),
      update: vi.fn(async (k: string, v: unknown) => {
        stored[k] = v;
      }),
    };
    const store = new ShortQuotaHistoryStore(memento as any);
    await store.record('acc-1', makeQuota({ gw: 80, g5: 60 }), NOW - 60 * MIN);
    await store.record('acc-1', makeQuota({ gw: 78, g5: 42 }), NOW);
    expect(stored[SHORT_QUOTA_HISTORY_KEY]).toBeDefined();

    const acc: AccountMeta = {
      id: 'acc-1',
      email: 'a@example.com',
      addedAt: 1,
      quota: makeQuota({ gw: 78, g5: 42 }),
    };
    const allRates = store.burnRatesFor([acc], {}, NOW);
    expect(allRates['acc-1']?.gemini?.burnRatePerHour).toBe(18);
  });
});

