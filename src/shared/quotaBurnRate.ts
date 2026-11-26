import type {
  AccountQuotaSummary,
  PacingAdvisory,
  PacingBucketId,
  PacingSafety,
  QuotaTrend,
  QuotaTrendSeries,
} from './messages';
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
export const SHORT_HISTORY_MAX_SAMPLES = 360;
export const SHORT_MIN_SAMPLE_GAP_MS = 2 * MIN;
export const IN_MEMORY_SAMPLE_GAP_MS = 60 * 1000;
/** Smooth velocity across a 30m rolling window with a 10m floor so single burst turns never spike wildly. */
export const RATE_WINDOW_MS = 30 * MIN;
export const MIN_RATE_WINDOW_MS = 10 * MIN;
const RATE_ANCHOR_MAX_AGE_MS = 2 * HOUR;
export const MIN_REPORTED_BURN_RATE = 0.5;
const IDLE_HALF_LIFE_MIN = 15;
const IDLE_DECAY_GRACE_MS = 10 * MIN;
const MAX_RECOMMENDED_DELAY_SEC = 300;
const MIN_RECOMMENDED_DELAY_SEC = 10;

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
  sample: ShortQuotaSample,
  minGapMs: number = SHORT_MIN_SAMPLE_GAP_MS
): { history: ShortQuotaSample[]; changed: boolean } {
  const last = history[history.length - 1];
  if (!last) {
    return { history: pruneShortHistory([sample], sample.t), changed: true };
  }
  if (sample.t <= last.t) {
    return { history, changed: false };
  }

  const unchanged = sameSample(last, sample);
  if (unchanged && sample.t - last.t < minGapMs) {
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
  if (rounded < MIN_REPORTED_BURN_RATE) {
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
  // Keep only samples since the most recent upward quota reset.
  let postResetStart = 0;
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i]![key] as number) > (recent[i - 1]![key] as number)) {
      postResetStart = i;
    }
  }
  const active = recent.slice(postResetStart);

  if (active.length >= 2) {
    const windowCutoff = now - RATE_WINDOW_MS;
    const anchorFloor = now - RATE_ANCHOR_MAX_AGE_MS;
    let anchorIdx = 0;
    for (let i = 0; i < active.length; i++) {
      const t = active[i]!.t;
      if (t <= windowCutoff) {
        anchorIdx = i;
      } else {
        if (i > 0 && active[i - 1]!.t < anchorFloor && t >= windowCutoff) {
          anchorIdx = i;
        }
        break;
      }
    }

    let totalDrop = 0;
    let lastDropAt: number | undefined;
    for (let i = Math.max(1, anchorIdx + 1); i < active.length; i++) {
      const drop = (active[i - 1]![key] as number) - (active[i]![key] as number);
      if (drop >= 0.1) {
        totalDrop += drop;
        lastDropAt = active[i]!.t;
      }
    }

    if (totalDrop >= 0.1 && lastDropAt !== undefined) {
      const spanHours = Math.max(now - active[anchorIdx]!.t, MIN_RATE_WINDOW_MS) / HOUR;
      let rate = totalDrop / spanHours;
      const idleMs = Math.max(0, now - lastDropAt);
      if (idleMs > IDLE_DECAY_GRACE_MS) {
        const decayMinutes = (idleMs - IDLE_DECAY_GRACE_MS) / MIN;
        rate *= Math.pow(0.5, decayMinutes / IDLE_HALF_LIFE_MIN);
      }
      if (rate >= MIN_REPORTED_BURN_RATE) {
        return computeRate(rate, currentPercent);
      }
      return { burnRatePerHour: 0, tteMinutes: null };
    }
  }

  if (
    fallbackTrend?.usedPercent !== undefined &&
    fallbackTrend.spanHours !== undefined &&
    fallbackTrend.spanHours >= 0.5 &&
    fallbackTrend.usedPercent >= MIN_REPORTED_BURN_RATE
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

const SAFETY_RANK: Record<PacingSafety, number> = {
  sustainable: 0,
  elevated: 1,
  critical: 2,
};

function parseResetMinutes(resetTime: string | undefined, now: number): number | null {
  if (!resetTime) return null;
  const resetAt = Date.parse(resetTime);
  if (Number.isNaN(resetAt) || resetAt <= now) return null;
  return Math.max(1, Math.round((resetAt - now) / MIN));
}

export function classifyPacing(
  tteMinutes: number | null,
  ttrMinutes: number | null
): { safety: PacingSafety; recommendedDelaySec?: number } {
  if (tteMinutes === null) {
    return { safety: 'sustainable' };
  }

  if (ttrMinutes !== null && ttrMinutes > 0) {
    // Cap evaluation horizon at 12h so multi-day weekly resets do not trigger false alarms on >12h TTE.
    const horizonMinutes = Math.min(ttrMinutes, 12 * 60);
    if (tteMinutes < horizonMinutes) {
      const ratio = ttrMinutes / Math.max(1, tteMinutes);
      const recommendedDelaySec = Math.round(
        Math.min(MAX_RECOMMENDED_DELAY_SEC, Math.max(MIN_RECOMMENDED_DELAY_SEC, (ratio - 1) * 30))
      );
      const safety: PacingSafety =
        tteMinutes <= 30 || tteMinutes <= horizonMinutes * 0.65 ? 'critical' : 'elevated';
      return { safety, recommendedDelaySec };
    }
    if (tteMinutes <= horizonMinutes * 1.15) {
      return { safety: 'elevated' };
    }
    return { safety: 'sustainable' };
  }

  if (tteMinutes <= 30) return { safety: 'critical' };
  if (tteMinutes <= 120) return { safety: 'elevated' };
  return { safety: 'sustainable' };
}

/**
 * Evaluates all active quota buckets for an account and returns the highest-urgency pacing
 * advisory, or undefined when consumption velocity is idle (< 0.5%/h).
 */
export function computePacingAdvisory(
  samples: ShortQuotaSample[],
  quota: AccountQuotaSummary | undefined,
  plan: string | undefined,
  now: number,
  trend?: QuotaTrend
): PacingAdvisory | undefined {
  if (!quota) return undefined;

  const advisories: PacingAdvisory[] = [];
  for (const reading of readBuckets(quota, plan)) {
    if (reading.percent === undefined || Number.isNaN(reading.percent)) continue;
    const bucketId = `${reading.group}.${reading.window}` as PacingBucketId;
    const key = KEY_MAP[bucketId];
    if (!key) continue;

    const fallbackTrend =
      reading.window === 'weekly'
        ? reading.group === 'gemini'
          ? trend?.gemini
          : trend?.claudeGpt
        : undefined;

    const rate = computeBucketBurnRate(samples, key, reading.percent, now, fallbackTrend);
    if (rate.burnRatePerHour < MIN_REPORTED_BURN_RATE) continue;

    const ttrMinutes = parseResetMinutes(reading.resetTime, now);
    const { safety, recommendedDelaySec } = classifyPacing(rate.tteMinutes, ttrMinutes);

    advisories.push({
      bucket: bucketId,
      burnRatePerHour: rate.burnRatePerHour,
      tteMinutes: rate.tteMinutes,
      ttrMinutes,
      safety,
      ...(recommendedDelaySec !== undefined ? { recommendedDelaySec } : {}),
    });
  }

  if (advisories.length === 0) return undefined;

  advisories.sort((a, b) => {
    const safetyDiff = SAFETY_RANK[b.safety] - SAFETY_RANK[a.safety];
    if (safetyDiff !== 0) return safetyDiff;

    const aTte = a.tteMinutes ?? Number.POSITIVE_INFINITY;
    const bTte = b.tteMinutes ?? Number.POSITIVE_INFINITY;
    if (aTte !== bTte) return aTte - bTte;

    if (b.burnRatePerHour !== a.burnRatePerHour) return b.burnRatePerHour - a.burnRatePerHour;

    const aFive = a.bucket.endsWith('.fiveHour') ? 1 : 0;
    const bFive = b.bucket.endsWith('.fiveHour') ? 1 : 0;
    return bFive - aFive;
  });

  return advisories[0];
}

