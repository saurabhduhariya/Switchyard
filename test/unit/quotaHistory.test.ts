import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountQuotaSummary } from '../../src/shared/messages';
import {
  appendSample,
  buildTrend,
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_SAMPLES,
  MIN_SAMPLE_GAP_MS,
  pruneHistory,
  sampleFromQuota,
  sparklinePoints,
  usedInWindow,
  type QuotaSample,
} from '../../src/shared/quotaHistory';
import { QUOTA_HISTORY_KEY, QuotaHistoryStore } from '../../src/quota/QuotaHistoryStore';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function quota(g?: number, c?: number, tier = 'Google AI Pro Quota'): AccountQuotaSummary {
  const bucket = (pct?: number) => (pct === undefined ? undefined : { remainingPercent: pct, resetTime: '2026-10-20T00:00:00Z' });
  return {
    tierName: tier,
    updatedAt: NOW,
    source: 'live',
    gemini: { name: 'Gemini', weekly: bucket(g), fiveHour: { remainingPercent: 33, resetTime: '2026-10-10T15:00:00Z' } },
    claudeGpt: { name: 'Claude + GPT', weekly: bucket(c) },
  };
}

describe('sampleFromQuota', () => {
  it('takes the weekly numbers of both groups, rounded to 0.1, ignoring 5h', () => {
    expect(sampleFromQuota(quota(87.34, 55.06), NOW)).toEqual({ t: NOW, g: 87.3, c: 55.1 });
  });

  it('works when only one group has data', () => {
    expect(sampleFromQuota(quota(40, undefined), NOW)).toEqual({ t: NOW, g: 40 });
  });

  it('gives nothing when there are no weekly numbers or no quota', () => {
    expect(sampleFromQuota(quota(undefined, undefined), NOW)).toBeUndefined();
    expect(sampleFromQuota(undefined, NOW)).toBeUndefined();
  });

  it('clamps out-of-range values', () => {
    expect(sampleFromQuota(quota(140, -5), NOW)).toEqual({ t: NOW, g: 100, c: 0 });
  });
});

describe('appendSample', () => {
  const s = (t: number, g?: number, c?: number): QuotaSample => ({ t, g, c });

  it('stores the first reading', () => {
    const r = appendSample([], s(NOW, 50, 60));
    expect(r.changed).toBe(true);
    expect(r.history).toEqual([s(NOW, 50, 60)]);
  });

  it('skips an unchanged reading that is too soon after the last one', () => {
    const history = [s(NOW, 50, 60)];
    const r = appendSample(history, s(NOW + MIN, 50, 60));
    expect(r.changed).toBe(false);
    expect(r.history).toBe(history);
  });

  it('stores a changed reading immediately', () => {
    const r = appendSample([s(NOW, 50, 60)], s(NOW + MIN, 49.5, 60));
    expect(r.changed).toBe(true);
    expect(r.history).toHaveLength(2);
  });

  it('treats differences under 0.1 as no change', () => {
    expect(appendSample([s(NOW, 50, 60)], s(NOW + MIN, 50.05, 60)).changed).toBe(false);
  });

  it('stores an unchanged reading once enough time has passed', () => {
    const r = appendSample([s(NOW, 50, 60)], s(NOW + MIN_SAMPLE_GAP_MS, 50, 60));
    expect(r.changed).toBe(true);
    expect(r.history).toHaveLength(2);
  });

  it('collapses a long flat run into its two end points', () => {
    let history: QuotaSample[] = [s(NOW, 50, 60)];
    for (let i = 1; i <= 40; i++) {
      history = appendSample(history, s(NOW + i * MIN_SAMPLE_GAP_MS, 50, 60)).history;
    }
    expect(history).toHaveLength(2);
    expect(history[0]!.t).toBe(NOW);
    expect(history[1]!.t).toBe(NOW + 40 * MIN_SAMPLE_GAP_MS);
  });

  it('a drop after a flat run starts a new step (the plateau is kept)', () => {
    let history: QuotaSample[] = [s(NOW, 50, 60)];
    for (let i = 1; i <= 5; i++) history = appendSample(history, s(NOW + i * MIN_SAMPLE_GAP_MS, 50, 60)).history;
    history = appendSample(history, s(NOW + 6 * MIN_SAMPLE_GAP_MS, 45, 60)).history;
    expect(history.map((x) => x.g)).toEqual([50, 50, 45]);
  });

  it('ignores a reading that is not newer than the last one', () => {
    const history = [s(NOW, 50, 60)];
    expect(appendSample(history, s(NOW - HOUR, 10, 10)).changed).toBe(false);
    expect(appendSample(history, s(NOW, 10, 10)).changed).toBe(false);
  });

  it('never mutates its input', () => {
    const history = [s(NOW, 50, 60), s(NOW + HOUR, 50, 60)];
    const snapshot = JSON.stringify(history);
    appendSample(history, s(NOW + 2 * HOUR, 50, 60));
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it('caps the number of samples and drops anything older than a week', () => {
    let history: QuotaSample[] = [];
    for (let i = 0; i < HISTORY_MAX_SAMPLES + 50; i++) {
      history = appendSample(history, s(NOW + i * 2 * MIN, 100 - i * 0.2, 50)).history;
    }
    expect(history.length).toBeLessThanOrEqual(HISTORY_MAX_SAMPLES);

    const old = [s(NOW - HISTORY_MAX_AGE_MS - HOUR, 90, 90), s(NOW - HOUR, 80, 80)];
    expect(pruneHistory(old, NOW)).toEqual([s(NOW - HOUR, 80, 80)]);
  });
});

describe('usedInWindow', () => {
  const s = (t: number, g: number): QuotaSample => ({ t, g });

  it('adds up the drops in the last 24 hours', () => {
    const history = [s(NOW - 20 * HOUR, 90), s(NOW - 10 * HOUR, 80), s(NOW - 1 * HOUR, 70)];
    const r = usedInWindow(history, 'gemini', NOW)!;
    expect(r.used).toBe(20);
    expect(r.spanMs).toBe(19 * HOUR);
  });

  it('ignores increases (a reset) instead of subtracting them', () => {
    const history = [s(NOW - 20 * HOUR, 10), s(NOW - 10 * HOUR, 100), s(NOW - 1 * HOUR, 95)];
    expect(usedInWindow(history, 'gemini', NOW)!.used).toBe(5);
  });

  it('uses a recent reading from just before the window as the starting point', () => {
    const history = [s(NOW - 26 * HOUR, 80), s(NOW - 1 * HOUR, 70)];
    // 26h ago is 2h before the window starts: counted as the start
    expect(usedInWindow(history, 'gemini', NOW)!.used).toBe(10);
  });

  it('does not blame today for a drop that happened before a long gap', () => {
    const history = [s(NOW - 6 * DAY, 80), s(NOW - 1 * HOUR, 60)];
    expect(usedInWindow(history, 'gemini', NOW)).toBeUndefined(); // only one reading in the window
  });

  it('says nothing when the account was not read in the last 24 hours', () => {
    const history = [s(NOW - 3 * DAY, 90), s(NOW - 2 * DAY, 80)];
    expect(usedInWindow(history, 'gemini', NOW)).toBeUndefined();
  });

  it('says nothing for very short history or a single reading', () => {
    expect(usedInWindow([s(NOW - 5 * MIN, 90), s(NOW - 1 * MIN, 89)], 'gemini', NOW)).toBeUndefined();
    expect(usedInWindow([s(NOW - HOUR, 90)], 'gemini', NOW)).toBeUndefined();
    expect(usedInWindow([], 'gemini', NOW)).toBeUndefined();
  });

  it('reports a shorter span when history is short, so the label can be honest', () => {
    const r = usedInWindow([s(NOW - 3 * HOUR, 90), s(NOW - 1 * HOUR, 85)], 'gemini', NOW)!;
    expect(r.used).toBe(5);
    expect(r.spanMs).toBe(2 * HOUR);
  });

  it('handles the two groups independently', () => {
    const history: QuotaSample[] = [
      { t: NOW - 5 * HOUR, g: 90, c: 50 },
      { t: NOW - 1 * HOUR, g: 80, c: 50 },
    ];
    expect(usedInWindow(history, 'gemini', NOW)!.used).toBe(10);
    expect(usedInWindow(history, 'claudeGpt', NOW)!.used).toBe(0);
  });
});

describe('sparklinePoints / buildTrend', () => {
  it('gives 24 evenly spaced points covering the available history', () => {
    const history: QuotaSample[] = [
      { t: NOW - 3 * DAY, g: 100 },
      { t: NOW - 2 * DAY, g: 80 },
      { t: NOW - 1 * DAY, g: 60 },
      { t: NOW, g: 40 },
    ];
    const points = sparklinePoints(history, 'gemini', NOW)!;
    expect(points).toHaveLength(24);
    expect(points[0]).toBe(100);
    expect(points[23]).toBe(40);
    for (let i = 1; i < points.length; i++) expect(points[i]!).toBeLessThanOrEqual(points[i - 1]!);
  });

  it('needs enough history to draw anything', () => {
    expect(sparklinePoints([{ t: NOW, g: 50 }], 'gemini', NOW)).toBeUndefined();
    expect(sparklinePoints([{ t: NOW - 5 * MIN, g: 50 }, { t: NOW, g: 49 }], 'gemini', NOW)).toBeUndefined();
    expect(sparklinePoints([], 'gemini', NOW)).toBeUndefined();
  });

  it('a single old reading is not a trend (it would draw a misleading flat line)', () => {
    expect(sparklinePoints([{ t: NOW - 5 * HOUR, g: 50 }], 'gemini', NOW)).toBeUndefined();
    expect(buildTrend([{ t: NOW - 5 * HOUR, g: 50, c: 50 }], NOW)).toBeUndefined();
  });

  it('only looks back a week', () => {
    const history: QuotaSample[] = [{ t: NOW - 20 * DAY, g: 5 }, { t: NOW - 3 * DAY, g: 90 }, { t: NOW, g: 80 }];
    const points = sparklinePoints(history, 'gemini', NOW)!;
    expect(points[0]).toBe(5); // value carried forward from before the window
    expect(points[23]).toBe(80);
  });

  it('buildTrend combines points and the 24h figure per group', () => {
    const history: QuotaSample[] = [
      { t: NOW - 10 * HOUR, g: 90, c: 70 },
      { t: NOW - 1 * HOUR, g: 80, c: 70 },
    ];
    const trend = buildTrend(history, NOW)!;
    expect(trend.gemini?.points).toHaveLength(24);
    expect(trend.gemini?.usedPercent).toBe(10);
    expect(trend.gemini?.spanHours).toBe(9);
    expect(trend.claudeGpt?.usedPercent).toBe(0);
  });

  it('buildTrend is undefined when there is nothing to show', () => {
    expect(buildTrend(undefined, NOW)).toBeUndefined();
    expect(buildTrend([], NOW)).toBeUndefined();
    expect(buildTrend([{ t: NOW, g: 50 }], NOW)).toBeUndefined();
  });
});

describe('QuotaHistoryStore', () => {
  let stored: Record<string, unknown>;
  let memento: any;

  beforeEach(() => {
    stored = {};
    memento = {
      get: (k: string, d?: unknown) => (k in stored ? stored[k] : d),
      update: vi.fn(async (k: string, v: unknown) => {
        stored[k] = v;
      }),
    };
  });

  it('records readings per account and only writes when something changed', async () => {
    const store = new QuotaHistoryStore(memento);
    expect(await store.record('a', quota(80, 70), NOW)).toBe(true);
    expect(await store.record('a', quota(80, 70), NOW + MIN)).toBe(false); // too soon, unchanged
    expect(await store.record('a', quota(79, 70), NOW + 2 * MIN)).toBe(true);
    expect(memento.update).toHaveBeenCalledTimes(2);
    expect(store.get('a')).toHaveLength(2);
    expect(store.get('b')).toEqual([]);
  });

  it('keeps accounts separate', async () => {
    const store = new QuotaHistoryStore(memento);
    await store.record('a', quota(80, 70), NOW);
    await store.record('b', quota(10, 20), NOW);
    expect(store.get('a')[0]).toMatchObject({ g: 80, c: 70 });
    expect(store.get('b')[0]).toMatchObject({ g: 10, c: 20 });
  });

  it('survives a restart (it reads from the memento)', async () => {
    await new QuotaHistoryStore(memento).record('a', quota(80, 70), NOW);
    expect(new QuotaHistoryStore(memento).get('a')).toHaveLength(1);
    expect(stored[QUOTA_HISTORY_KEY]).toBeDefined();
  });

  it('builds trends only for accounts that have enough history', async () => {
    const store = new QuotaHistoryStore(memento);
    await store.record('a', quota(90, 70), NOW - 10 * HOUR);
    await store.record('a', quota(80, 70), NOW - 1 * HOUR);
    await store.record('lonely', quota(50, 50), NOW);
    const trends = store.trends(['a', 'lonely', 'missing'], NOW);
    expect(Object.keys(trends)).toEqual(['a']);
    expect(trends.a?.gemini?.usedPercent).toBe(10);
  });

  it('forgets accounts that were removed', async () => {
    const store = new QuotaHistoryStore(memento);
    await store.record('a', quota(80, 70), NOW);
    await store.record('gone', quota(80, 70), NOW);
    await store.prune(['a']);
    expect(store.get('gone')).toEqual([]);
    expect(store.get('a')).toHaveLength(1);
    memento.update.mockClear();
    await store.prune(['a']); // nothing to remove: no write
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('does nothing (and does not crash) without storage or without usable numbers', async () => {
    const none = new QuotaHistoryStore(undefined);
    expect(await none.record('a', quota(80, 70), NOW)).toBe(false);
    expect(none.trends(['a'], NOW)).toEqual({});
    await none.prune([]);
    const store = new QuotaHistoryStore(memento);
    expect(await store.record('a', quota(undefined, undefined), NOW)).toBe(false);
  });
});
