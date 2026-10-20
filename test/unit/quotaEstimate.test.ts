import { describe, expect, it } from 'vitest';
import type { AccountQuotaSummary } from '../../src/shared/messages';
import {
  estimateBucket,
  estimateQuotaSummary,
  hasEstimates,
  LIVE_FRESH_MS,
  shouldEstimate,
} from '../../src/shared/quotaEstimate';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function summary(over: Partial<AccountQuotaSummary> = {}): AccountQuotaSummary {
  return {
    tierName: 'Google AI Pro Quota',
    updatedAt: NOW - 4 * DAY,
    source: 'live',
    gemini: {
      name: 'Gemini',
      weekly: { remainingPercent: 0, resetTime: iso(-2 * DAY) }, // reset passed 2 days ago
      fiveHour: { remainingPercent: 10, resetTime: iso(-3 * HOUR) },
    },
    claudeGpt: {
      name: 'Claude + GPT',
      weekly: { remainingPercent: 40, resetTime: iso(2 * DAY) }, // still in the future
      fiveHour: { remainingPercent: 55, resetTime: iso(HOUR) },
    },
    ...over,
  };
}

describe('estimateBucket', () => {
  it('refills a bucket whose reset time has passed and flags it as estimated', () => {
    const b = estimateBucket({ remainingPercent: 0, resetTime: iso(-HOUR) }, NOW)!;
    expect(b.remainingPercent).toBe(100);
    expect(b.remainingFraction).toBe(1);
    expect(b.estimated).toBe(true);
    expect(b.resetTime).toBeUndefined();
  });

  it('keeps a bucket whose reset time is still ahead', () => {
    const input = { remainingPercent: 40, resetTime: iso(HOUR) };
    expect(estimateBucket(input, NOW)).toBe(input);
  });

  it('treats a reset exactly now as passed', () => {
    expect(estimateBucket({ remainingPercent: 5, resetTime: iso(0) }, NOW)?.estimated).toBe(true);
  });

  it('leaves an already full bucket alone (nothing to correct)', () => {
    const input = { remainingPercent: 100, resetTime: iso(-DAY) };
    expect(estimateBucket(input, NOW)).toBe(input);
  });

  it('uses remainingFraction when there is no percent', () => {
    const b = estimateBucket({ remainingFraction: 0.2, resetTime: iso(-HOUR) }, NOW)!;
    expect(b.estimated).toBe(true);
    expect(b.remainingPercent).toBe(100);
  });

  it('does not invent a value when the amount was never known', () => {
    const input = { resetTime: iso(-HOUR) };
    expect(estimateBucket(input, NOW)).toBe(input);
  });

  it('ignores disabled buckets, missing buckets and unreadable dates', () => {
    const disabled = { disabled: true, remainingPercent: 0, resetTime: iso(-HOUR) };
    expect(estimateBucket(disabled, NOW)).toBe(disabled);
    expect(estimateBucket(undefined, NOW)).toBeUndefined();
    const bad = { remainingPercent: 0, resetTime: 'not a date' };
    expect(estimateBucket(bad, NOW)).toBe(bad);
  });
});

describe('estimateQuotaSummary', () => {
  it('only changes the buckets whose reset passed', () => {
    const out = estimateQuotaSummary(summary(), NOW)!;
    expect(out.gemini.weekly?.remainingPercent).toBe(100);
    expect(out.gemini.weekly?.estimated).toBe(true);
    expect(out.gemini.fiveHour?.estimated).toBe(true);
    expect(out.claudeGpt.weekly?.remainingPercent).toBe(40);
    expect(out.claudeGpt.weekly?.estimated).toBeUndefined();
    expect(out.claudeGpt.fiveHour?.remainingPercent).toBe(55);
  });

  it('never mutates the stored summary', () => {
    const input = summary();
    const snapshot = JSON.stringify(input);
    estimateQuotaSummary(input, NOW);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles the older flat fields (weeklyRemaining / weeklyResetTime)', () => {
    const q = summary({
      gemini: {
        name: 'Gemini',
        weeklyRemaining: 3,
        weeklyResetTime: iso(-DAY),
        rolling5hRemaining: 70,
        rolling5hResetTime: iso(2 * HOUR),
      },
    });
    const out = estimateQuotaSummary(q, NOW)!;
    expect(out.gemini.weekly?.remainingPercent).toBe(100);
    expect(out.gemini.weekly?.estimated).toBe(true);
    expect(out.gemini.fiveHour?.remainingPercent).toBe(70);
    expect(out.gemini.fiveHour?.estimated).toBeUndefined();
  });

  it('returns undefined for no data', () => {
    expect(estimateQuotaSummary(undefined, NOW)).toBeUndefined();
  });

  it('hasEstimates reports whether anything was estimated', () => {
    expect(hasEstimates(estimateQuotaSummary(summary(), NOW))).toBe(true);
    expect(hasEstimates(summary())).toBe(false);
    expect(hasEstimates(undefined)).toBe(false);
  });
});

describe('shouldEstimate', () => {
  it('always estimates for accounts that are not active', () => {
    expect(shouldEstimate(summary({ updatedAt: NOW }), false, NOW)).toBe(true);
  });

  it('does not estimate a fresh live read for the active account', () => {
    expect(shouldEstimate(summary({ updatedAt: NOW - 60_000, source: 'live' }), true, NOW)).toBe(false);
  });

  it('estimates the active account when its data is cached or old', () => {
    expect(shouldEstimate(summary({ source: 'cache', updatedAt: NOW }), true, NOW)).toBe(true);
    expect(shouldEstimate(summary({ source: 'live', updatedAt: NOW - LIVE_FRESH_MS - 1 }), true, NOW)).toBe(true);
  });

  it('is false without quota data', () => {
    expect(shouldEstimate(undefined, false, NOW)).toBe(false);
  });
});
