import type { AccountQuotaSummary, QuotaTrend, QuotaTrendSeries } from './messages';
import { readBuckets, type QuotaGroupKey } from './quotaRules';

/**
 * A small, capped history of each account's weekly remaining quota, used to draw a sparkline and to
 * say "used X% in the last 24 h". Everything here is pure: no I/O and no clock other than `now`.
 *
 * Storage is kept tiny on purpose: samples are only added when something changed, runs of identical
 * readings collapse into their two end points, and anything older than a week (or beyond 200
 * samples) is dropped.
 */

/** One reading. g = Gemini weekly remaining %, c = Claude + GPT weekly remaining %. */
export interface QuotaSample {
  t: number;
  g?: number;
  c?: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const HISTORY_MAX_AGE_MS = 7 * DAY;
export const HISTORY_MAX_SAMPLES = 200;
/** An unchanged reading is only worth storing this often. */
export const MIN_SAMPLE_GAP_MS = 30 * 60 * 1000;
/** Changes smaller than this (in percentage points) are treated as "no change". */
export const MIN_CHANGE = 0.1;
export const USED_WINDOW_MS = DAY;
export const SPARKLINE_POINTS = 24;
/** "Used in the last 24 h" needs at least this much history to mean anything. */
const MIN_USED_SPAN_MS = 30 * 60 * 1000;
/**
 * The reading just before the window is used as the starting point only if it is this recent.
 * Otherwise a drop that happened days ago (before the account was last opened) would be counted as
 * today's usage.
 */
const BASELINE_MAX_GAP_MS = 6 * HOUR;

const KEY: Record<QuotaGroupKey, 'g' | 'c'> = { gemini: 'g', claudeGpt: 'c' };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Takes a reading from a quota summary, or undefined when it has no usable weekly numbers. */
export function sampleFromQuota(quota: AccountQuotaSummary | undefined, now: number): QuotaSample | undefined {
  if (!quota) return undefined;
  const sample: QuotaSample = { t: now };
  for (const bucket of readBuckets(quota)) {
    if (bucket.window !== 'weekly' || bucket.percent === undefined || Number.isNaN(bucket.percent)) continue;
    sample[KEY[bucket.group]] = round1(Math.max(0, Math.min(100, bucket.percent)));
  }
  return sample.g === undefined && sample.c === undefined ? undefined : sample;
}

function sameValue(a?: number, b?: number): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) < MIN_CHANGE;
}

function sameReading(a: QuotaSample, b: QuotaSample): boolean {
  return sameValue(a.g, b.g) && sameValue(a.c, b.c);
}

export function pruneHistory(history: QuotaSample[], now: number): QuotaSample[] {
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const kept = history.filter((s) => s.t >= cutoff);
  return kept.length > HISTORY_MAX_SAMPLES ? kept.slice(kept.length - HISTORY_MAX_SAMPLES) : kept;
}

/**
 * Adds a reading. Returns the new history and whether it needs saving.
 * Never mutates the input.
 */
export function appendSample(
  history: QuotaSample[],
  sample: QuotaSample
): { history: QuotaSample[]; changed: boolean } {
  const last = history[history.length - 1];

  if (!last) {
    return { history: pruneHistory([sample], sample.t), changed: true };
  }
  // Clock moved backwards or duplicate timestamp: ignore rather than corrupt the order.
  if (sample.t <= last.t) {
    return { history, changed: false };
  }

  const unchanged = sameReading(last, sample);
  if (unchanged && sample.t - last.t < MIN_SAMPLE_GAP_MS) {
    return { history, changed: false };
  }

  const beforeLast = history[history.length - 2];
  if (unchanged && beforeLast && sameReading(beforeLast, last)) {
    // A flat run already has both end points; just move the end point forward.
    const next = history.slice(0, -1);
    next.push({ ...last, t: sample.t });
    return { history: pruneHistory(next, sample.t), changed: true };
  }

  return { history: pruneHistory([...history, sample], sample.t), changed: true };
}

/** Value of the latest sample at or before `t` (or the first sample if `t` is before all of them). */
function valueAt(history: QuotaSample[], t: number, key: 'g' | 'c'): number | undefined {
  let value: number | undefined;
  for (const s of history) {
    if (s.t > t) break;
    if (s[key] !== undefined) value = s[key];
  }
  if (value !== undefined) return value;
  return history.find((s) => s[key] !== undefined)?.[key];
}

/**
 * How much of the weekly quota was used in the last `windowMs`: the sum of every drop between
 * neighbouring readings. Increases (a reset) are ignored. Undefined when the account has not been
 * read recently or there is not enough history to say anything honest.
 */
export function usedInWindow(
  history: QuotaSample[],
  group: QuotaGroupKey,
  now: number,
  windowMs: number = USED_WINDOW_MS
): { used: number; spanMs: number } | undefined {
  const key = KEY[group];
  const readings = history.filter((s) => s[key] !== undefined);
  const lastReading = readings[readings.length - 1];
  if (!lastReading || now - lastReading.t > windowMs) return undefined;

  const cutoff = now - windowMs;
  let startIndex = readings.findIndex((s) => s.t >= cutoff);
  if (startIndex === -1) return undefined;
  // Use the reading just before the window as the starting point, but only if it is recent.
  const before = readings[startIndex - 1];
  if (before && cutoff - before.t <= BASELINE_MAX_GAP_MS) startIndex -= 1;
  const inWindow = readings.slice(startIndex);
  if (inWindow.length < 2) return undefined;

  let used = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const drop = (inWindow[i - 1]![key] as number) - (inWindow[i]![key] as number);
    if (drop > 0) used += drop;
  }
  const spanMs = Math.min(windowMs, lastReading.t - Math.max(inWindow[0]!.t, cutoff));
  if (spanMs < MIN_USED_SPAN_MS) return undefined;
  return { used: round1(used), spanMs };
}

/** Evenly spaced remaining-% points over the available history (at most the last 7 days). */
export function sparklinePoints(
  history: QuotaSample[],
  group: QuotaGroupKey,
  now: number,
  count: number = SPARKLINE_POINTS
): number[] | undefined {
  const key = KEY[group];
  const readings = history.filter((s) => s[key] !== undefined);
  const first = readings[0];
  // One reading says nothing about a trend; a flat line would wrongly suggest "no usage".
  if (!first || readings.length < 2) return undefined;

  const start = Math.max(now - HISTORY_MAX_AGE_MS, first.t);
  const span = now - start;
  if (span < MIN_USED_SPAN_MS || count < 2) return undefined;

  const step = span / (count - 1);
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = valueAt(readings, start + i * step, key);
    if (v !== undefined) points.push(v);
  }
  return points.length >= 2 ? points : undefined;
}

export function trendForGroup(
  history: QuotaSample[],
  group: QuotaGroupKey,
  now: number
): QuotaTrendSeries | undefined {
  const points = sparklinePoints(history, group, now);
  if (!points) return undefined;
  const series: QuotaTrendSeries = { points };
  const used = usedInWindow(history, group, now);
  if (used) {
    series.usedPercent = used.used;
    series.spanHours = Math.round((used.spanMs / HOUR) * 10) / 10;
  }
  return series;
}

/** Everything the panel needs to draw one account's trend, or undefined when there is nothing to show. */
export function buildTrend(history: QuotaSample[] | undefined, now: number): QuotaTrend | undefined {
  if (!history || history.length === 0) return undefined;
  const gemini = trendForGroup(history, 'gemini', now);
  const claudeGpt = trendForGroup(history, 'claudeGpt', now);
  if (!gemini && !claudeGpt) return undefined;
  const trend: QuotaTrend = {};
  if (gemini) trend.gemini = gemini;
  if (claudeGpt) trend.claudeGpt = claudeGpt;
  return trend;
}
