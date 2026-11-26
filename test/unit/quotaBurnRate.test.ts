import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';
import {
  appendShortSample,
  classifyPacing,
  computeAccountBurnRates,
  computeBucketBurnRate,
  computePacingAdvisory,
  pruneShortHistory,
  SHORT_HISTORY_MAX_AGE_MS,
  SHORT_MIN_SAMPLE_GAP_MS,
  shortSampleFromQuota,
  type ShortQuotaSample,
} from '../../src/shared/quotaBurnRate';
import { BurnRateAnalyzer } from '../../src/quota/BurnRateAnalyzer';
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

  it('classifies pacing sustainability and throttle recommendations accurately', () => {
    expect(classifyPacing(120, 240)).toEqual({ safety: 'critical', recommendedDelaySec: 30 });
    expect(classifyPacing(180, 220)).toEqual({ safety: 'elevated', recommendedDelaySec: 10 });
    expect(classifyPacing(240, 120)).toEqual({ safety: 'sustainable' });
    expect(classifyPacing(2600, 5760)).toEqual({ safety: 'sustainable' });
    expect(classifyPacing(20, null)).toEqual({ safety: 'critical' });
    expect(classifyPacing(90, null)).toEqual({ safety: 'elevated' });
  });

  it('computes PacingAdvisory favoring urgent 5h exhaustion over sustainable weekly', () => {
    const quota = {
      tierName: 'Google AI Pro Quota',
      updatedAt: NOW,
      source: 'live' as const,
      gemini: {
        name: 'Gemini',
        weekly: { remainingPercent: 90, resetTime: new Date(NOW + 5 * 24 * HOUR).toISOString() },
        fiveHour: { remainingPercent: 36, resetTime: new Date(NOW + 4 * HOUR).toISOString() },
      },
      claudeGpt: {
        name: 'Claude + GPT',
        weekly: { remainingPercent: 100, resetTime: new Date(NOW + 5 * 24 * HOUR).toISOString() },
        fiveHour: { remainingPercent: 100, resetTime: new Date(NOW + 4 * HOUR).toISOString() },
      },
    };
    const samples: ShortQuotaSample[] = [
      { t: NOW - 60 * MIN, gw: 94, g5: 60 },
      { t: NOW - 30 * MIN, gw: 92, g5: 48 },
      { t: NOW, gw: 90, g5: 36 }, // -24%/h -> TTE = 90m < TTR = 240m => critical
    ];

    const advisory = computePacingAdvisory(samples, quota, 'Pro', NOW)!;
    expect(advisory.bucket).toBe('gemini.fiveHour');
    expect(advisory.burnRatePerHour).toBe(24);
    expect(advisory.tteMinutes).toBe(90);
    expect(advisory.ttrMinutes).toBe(240);
    expect(advisory.safety).toBe('critical');
    expect(advisory.recommendedDelaySec).toBe(50);

    // Idle history produces no pacing advisory
    expect(computePacingAdvisory([{ t: NOW, gw: 90, g5: 90 }], quota, 'Pro', NOW)).toBeUndefined();
  });

  it('tracks high-resolution samples in BurnRateAnalyzer in memory alongside persisted store', async () => {
    const stored: Record<string, unknown> = {};
    const memento = {
      get: (k: string, d?: unknown) => (k in stored ? stored[k] : d),
      update: vi.fn(async (k: string, v: unknown) => {
        stored[k] = v;
      }),
    };
    const analyzer = new BurnRateAnalyzer(memento as any);

    await analyzer.record('acc-1', makeQuota({ gw: 95, g5: 60 }), NOW - 30 * MIN);
    // Unchanged read at 1m gap enters in-memory ring buffer without triggering a Memento disk write
    await analyzer.record('acc-1', makeQuota({ gw: 95, g5: 60 }), NOW - 29 * MIN);
    // Drop detected immediately enters memory + store
    await analyzer.record('acc-1', makeQuota({ gw: 94, g5: 51 }), NOW);

    expect(memento.update).toHaveBeenCalledTimes(2);
    expect(analyzer.getSamples('acc-1', NOW)).toHaveLength(3);

    const acc: AccountMeta = {
      id: 'acc-1',
      email: 'a@example.com',
      addedAt: 1,
      quota: {
        tierName: 'Google AI Pro Quota',
        updatedAt: NOW,
        source: 'live',
        gemini: {
          name: 'Gemini',
          weekly: { remainingPercent: 94, resetTime: new Date(NOW + 4 * 24 * HOUR).toISOString() },
          fiveHour: { remainingPercent: 51, resetTime: new Date(NOW + 4 * HOUR).toISOString() },
        },
        claudeGpt: { name: 'Claude + GPT' },
      },
    };

    const result = analyzer.analyze([acc], 'acc-1', {}, NOW);
    // Smoothed over full 30m window: 9% consumed in 30m => 18%/h
    expect(result.burnRates['acc-1']?.gemini?.burnRatePerHour).toBe(18);
    expect(result.pacing?.bucket).toBe('gemini.fiveHour');
    expect(result.pacing?.safety).toBe('elevated');

    await analyzer.prune([]);
    expect(analyzer.getSamples('acc-1', NOW)).toEqual([]);
  });

  it('prevents a single 1-minute chunk drop from spiking into triple-digit hourly rates', () => {
    const burst: ShortQuotaSample[] = [
      { t: NOW - 1 * MIN, g5: 75 },
      { t: NOW, g5: 70.7 }, // -4.3% inside 1 minute -> floored across 10m window => 25.8%/h (not 258%/h)
    ];
    const rate = computeBucketBurnRate(burst, 'g5', 70.7, NOW);
    expect(rate.burnRatePerHour).toBe(25.8);
    expect(rate.tteMinutes).toBe(Math.round((70.7 / 25.8) * 60));
  });
});

