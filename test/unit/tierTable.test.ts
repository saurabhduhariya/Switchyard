import { describe, expect, it } from 'vitest';
import type { AccountQuotaSummary } from '../../src/shared/messages';
import {
  DEFAULT_WINDOWS,
  hasFiveHourWindow,
  isProTier,
  isStarterTier,
  isUltraTier,
  readBuckets,
  TIERS,
  tierSpec,
  type TierSpec,
  windowsForTier,
} from '../../src/shared/quotaRules';

const quotaWith = (tierName: string): AccountQuotaSummary => ({
  tierName,
  updatedAt: 1,
  source: 'live',
  gemini: {
    name: 'Gemini',
    weekly: { remainingPercent: 50, resetTime: '2026-10-20T00:00:00Z' },
    fiveHour: { remainingPercent: 70, resetTime: '2026-10-10T17:00:00Z' },
  },
  claudeGpt: {
    name: 'Claude + GPT',
    weekly: { remainingPercent: 60, resetTime: '2026-10-20T00:00:00Z' },
    fiveHour: { remainingPercent: 80, resetTime: '2026-10-10T17:00:00Z' },
  },
});

describe('tier table', () => {
  it('every entry is well formed and its regex has no sticky state', () => {
    expect(TIERS.length).toBeGreaterThan(0);
    for (const spec of TIERS) {
      expect(spec.id).toBeTruthy();
      expect(spec.label).toBeTruthy();
      expect(spec.match.global).toBe(false);
      expect(spec.match.sticky).toBe(false);
      // repeated calls must give the same answer (a /g regex would alternate)
      const first = spec.match.test(spec.label);
      expect(spec.match.test(spec.label)).toBe(first);
      expect(spec.match.test(spec.label)).toBe(first);
    }
  });

  it('every entry matches its own label and resolves to itself', () => {
    for (const spec of TIERS) {
      expect(tierSpec(spec.label)?.id).toBe(spec.id);
    }
  });

  it.each([
    ['Antigravity Starter Quota', { weekly: true, fiveHour: false }],
    ['starter-tier', { weekly: true, fiveHour: false }],
    ['free-tier', { weekly: true, fiveHour: false }],
    ['Google AI Pro Quota', { weekly: true, fiveHour: true }],
    ['g1-pro-tier', { weekly: true, fiveHour: true }],
    ['Google AI Ultra Quota', { weekly: true, fiveHour: true }],
    ['g1-ultra-tier', { weekly: true, fiveHour: true }],
  ])('%s -> windows %j', (name, windows) => {
    // Note: if windows has extra property from object comparison, windowsForTier returns QuotaWindows
    const expected = 'freeHour' in windows ? { weekly: windows.weekly, fiveHour: windows.fiveHour } : windows;
    expect(windowsForTier(name)).toEqual(expected);
  });

  it('tiers that are not in the table, or no tier at all, get both windows', () => {
    expect(windowsForTier('Antigravity Quota')).toEqual(DEFAULT_WINDOWS);
    expect(windowsForTier('Some Future Plan')).toEqual(DEFAULT_WINDOWS);
    expect(windowsForTier(undefined)).toEqual(DEFAULT_WINDOWS);
    expect(windowsForTier('')).toEqual(DEFAULT_WINDOWS);
    expect(tierSpec('Some Future Plan')).toBeUndefined();
  });

  it('the predicates agree with the table', () => {
    expect(isStarterTier('Antigravity Starter Quota')).toBe(true);
    expect(isUltraTier('Google AI Ultra')).toBe(true);
    expect(isProTier('Google AI Pro')).toBe(true);
    expect(isProTier('Google AI Ultra')).toBe(false); // Ultra is never Pro
    expect(hasFiveHourWindow('Antigravity Starter Quota')).toBe(false);
    expect(hasFiveHourWindow('Google AI Pro')).toBe(true);
    expect(hasFiveHourWindow(undefined)).toBe(true);
  });

  it('a name that matches several tiers resolves to Starter first, so a free account never shows 5h', () => {
    expect(tierSpec('Google AI Pro (free trial)')?.id).toBe('starter');
    expect(hasFiveHourWindow('Google AI Pro (free trial)')).toBe(false);
  });

  it('readBuckets follows the table: Starter lists only weekly buckets, Pro lists both', () => {
    expect(readBuckets(quotaWith('Antigravity Starter Quota')).map((b) => b.label)).toEqual([
      'Gemini weekly',
      'Claude + GPT weekly',
    ]);
    expect(readBuckets(quotaWith('Google AI Pro Quota')).map((b) => b.label)).toEqual([
      'Gemini weekly',
      'Gemini 5h',
      'Claude + GPT weekly',
      'Claude + GPT 5h',
    ]);
  });

  it('a new tier is supported by adding one table entry (no other code changes)', () => {
    const fake: TierSpec = {
      id: 'pro',
      label: 'Experimental',
      match: /\bexperimental\b/i,
      windows: { weekly: false, fiveHour: true }, // a tier that has only a 5-hour window
    };
    (TIERS as TierSpec[]).unshift(fake);
    try {
      expect(windowsForTier('Experimental Plan')).toEqual({ weekly: false, fiveHour: true });
      expect(readBuckets(quotaWith('Experimental Plan')).map((b) => b.label)).toEqual([
        'Gemini 5h',
        'Claude + GPT 5h',
      ]);
    } finally {
      (TIERS as TierSpec[]).shift();
    }
    expect(windowsForTier('Experimental Plan')).toEqual(DEFAULT_WINDOWS);
  });

  it('readBuckets prefers the account plan over a degraded quota tier name', () => {
    // a Pro account whose quota arrived labelled Starter must still read as Pro
    const buckets = readBuckets(quotaWith('Antigravity Starter Quota'), 'Google AI Pro');
    expect(buckets.map((b) => b.window)).toContain('fiveHour');
  });
});
