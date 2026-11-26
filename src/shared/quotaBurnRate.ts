import type { AccountQuotaSummary, QuotaTrend, QuotaTrendSeries } from './messages';
import { readBuckets } from './quotaRules';

export interface ShortQuotaSample {
  t: number;
  gw?: number;
  g5?: number;
  cw?: number;
  c5?: number;
}

export interface BucketBurnRate {
  burnRatePerHour: number;
  tteMinutes: number | null;
}

export interface AccountBurnRates {
  gemini?: BucketBurnRate;
  claudeGpt?: BucketBurnRate;
}

export type ShortBucketKey = 'gw' | 'g5' | 'cw' | 'c5';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const SHORT_HISTORY_MAX_AGE_MS = 6 * HOUR;
export const SHORT_HISTORY_MAX_SAMPLES = 120;
export const SHORT_MIN_SAMPLE_GAP_MS = 2 * MIN;
const EMA_ALPHA = 0.3;
const MIN_REPORTED_RATE = 0.5;
const IDLE_HALF_LIFE_MIN = 15;
const IDLE_DECAY_GRACE_MS = 10 * MIN;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const KEY_MAP: Record<string, ShortBucketKey> = {
  'gemini.weekly': 'gw',
  'gemini.fiveHour': 'g5',
  'claudeGpt.weekly': 'cw',
  'claudeGpt.fiveHour': 'c5',
};

export function shortSampleFromQuota(quota: AccountQuotaSummary | undefined, now: number): ShortQuotaSample | undefined {
  if (!quota) return undefined;
  const sample: ShortQuotaSample = { t: now };
  let hasValue = false;
  for (const bucket of readBuckets(quota)) {
    if (bucket.percent === undefined || Number.isNaN(bucket.percent)) continue;
    const key = KEY_MAP[`${bucket.group}.${bucket.window}`];
    if (!key) continue;
    sample[key] = round1(Math.max(0, Math.min(100, bucket.percent)));
    hasValue = true;
  }
  return hasValue ? sample : undefined;
}

function sameValue(a?: number, b?: number): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) < 0.1;
}

function sameSample(a: ShortQuotaSample, b: ShortQuotaSample): boolean {
  return (
    sameValue(a.gw, b.gw) &&
    sameValue(a.g5, b.g5) &&
    sameValue(a.cw, b.cw) &&
    sameValue(a.c5, b.c5)
  );
}

export function pruneShortHistory(history: ShortQuotaSample[], now: number): ShortQuotaSample[] {
  const cutoff = now - SHORT_HISTORY_MAX_AGE_MS;
  const kept = history.filter((s) => s.t >= cutoff);
  return kept.length > SHORT_HISTORY_MAX_SAMPLES
    ? kept.slice(kept.length - SHORT_HISTORY_MAX_SAMPLES)
    : kept;
}

export function appendShortSample(
  history: ShortQuotaSample[],
  sample: ShortQuotaSample
): { history: ShortQuotaSample[]; changed: boolean } {
  const last = history[history.length - 1];
  if (!last) {
    return { history: pruneShortHistory([sample], sample.t), changed: true };
  }
  if (sample.t <= last.t) {
    return { history, changed: false };
  }

  const unchanged = sameSample(last, sample);
  if (unchanged && sample.t - last.t < SHORT_MIN_SAMPLE_GAP_MS) {
    return { history, changed: false };
  }

  const beforeLast = history[history.length - 2];
  if (unchanged && beforeLast && sameSample(beforeLast, last)) {
    const next = history.slice(0, -1);
    next.push({ ...last, t: sample.t });
    return { history: pruneShortHistory(next, sample.t), changed: true };
  }

  return { history: pruneShortHistory([...history, sample], sample.t), changed: true };
}

function computeRate(burnRatePerHour: number, currentPercent: number | undefined): BucketBurnRate {
  const rounded = round1(burnRatePerHour);
  if (rounded < MIN_REPORTED_RATE) {
    return { burnRatePerHour: 0, tteMinutes: null };
  }
  const tteMinutes =
    currentPercent !== undefined && !Number.isNaN(currentPercent)
      ? Math.max(0, Math.round((currentPercent / rounded) * 60))
      : null;
  return { burnRatePerHour: rounded, tteMinutes };
}

export function computeBucketBurnRate(
  history: ShortQuotaSample[],
  key: ShortBucketKey,
  currentPercent: number | undefined,
  now: number,
  fallbackTrend?: QuotaTrendSeries
): BucketBurnRate {
  const recent = pruneShortHistory(history, now).filter((s) => s[key] !== undefined);
  let ema = 0;
  let hasDrop = false;
  let lastDropAt: number | undefined;

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]!;
    const curr = recent[i]!;
    const prevVal = prev[key]!;
    const currVal = curr[key]!;
    const dtMs = curr.t - prev.t;
    if (dtMs <= 0) continue;

    if (currVal > prevVal) {
      // Quota reset: start velocity fresh from post-reset samples.
      ema = 0;
      hasDrop = false;
      lastDropAt = undefined;
      continue;
    }

    const drop = prevVal - currVal;
    if (drop >= 0.1) {
      const dtHours = Math.max(dtMs, 30_000) / HOUR;
      const instRate = drop / dtHours;
      ema = hasDrop ? EMA_ALPHA * instRate + (1 - EMA_ALPHA) * ema : instRate;
      hasDrop = true;
      lastDropAt = curr.t;
    } else if (hasDrop && dtMs >= 5 * MIN) {
      ema *= 1 - EMA_ALPHA;
    }
  }

  if (hasDrop && lastDropAt !== undefined && ema >= MIN_REPORTED_RATE) {
    const idleMs = Math.max(0, now - lastDropAt);
    if (idleMs > IDLE_DECAY_GRACE_MS) {
      const decayMinutes = (idleMs - IDLE_DECAY_GRACE_MS) / MIN;
      ema *= Math.pow(0.5, decayMinutes / IDLE_HALF_LIFE_MIN);
    }
    if (ema >= MIN_REPORTED_RATE) {
      return computeRate(ema, currentPercent);
    }
  }

  if (
    fallbackTrend?.usedPercent !== undefined &&
    fallbackTrend.spanHours !== undefined &&
    fallbackTrend.spanHours >= 0.5 &&
    fallbackTrend.usedPercent >= MIN_REPORTED_RATE
  ) {
    return computeRate(fallbackTrend.usedPercent / fallbackTrend.spanHours, currentPercent);
  }

  return { burnRatePerHour: 0, tteMinutes: null };
}

function selectGroupBurnRate(
  samples: ShortQuotaSample[],
  weeklyKey: ShortBucketKey,
  fiveHourKey: ShortBucketKey,
  weeklyPct: number | undefined,
  fiveHourPct: number | undefined,
  now: number,
  fallbackTrend?: QuotaTrendSeries
): BucketBurnRate | undefined {
  if (weeklyPct === undefined && fiveHourPct === undefined) return undefined;

  const fiveHourRate =
    fiveHourPct !== undefined
      ? computeBucketBurnRate(samples, fiveHourKey, fiveHourPct, now)
      : undefined;
  const weeklyRate =
    weeklyPct !== undefined
      ? computeBucketBurnRate(samples, weeklyKey, weeklyPct, now, fallbackTrend)
      : undefined;

  if (fiveHourRate && weeklyRate) {
    if (fiveHourPct !== undefined && weeklyPct !== undefined && fiveHourPct <= weeklyPct && fiveHourRate.burnRatePerHour > 0) {
      return fiveHourRate;
    }
    return fiveHourRate.burnRatePerHour >= weeklyRate.burnRatePerHour ? fiveHourRate : weeklyRate;
  }
  return fiveHourRate ?? weeklyRate;
}

export function computeAccountBurnRates(
  samples: ShortQuotaSample[],
  quota: AccountQuotaSummary | undefined,
  plan: string | undefined,
  now: number,
  trend?: QuotaTrend
): AccountBurnRates {
  if (!quota) return {};
  const buckets = readBuckets(quota, plan);
  const findPct = (group: 'gemini' | 'claudeGpt', window: 'weekly' | 'fiveHour') =>
    buckets.find((b) => b.group === group && b.window === window)?.percent;

  const gemini = selectGroupBurnRate(
    samples,
    'gw',
    'g5',
    findPct('gemini', 'weekly'),
    findPct('gemini', 'fiveHour'),
    now,
    trend?.gemini
  );
  const claudeGpt = selectGroupBurnRate(
    samples,
    'cw',
    'c5',
    findPct('claudeGpt', 'weekly'),
    findPct('claudeGpt', 'fiveHour'),
    now,
    trend?.claudeGpt
  );

  return {
    ...(gemini ? { gemini } : {}),
    ...(claudeGpt ? { claudeGpt } : {}),
  };
}

