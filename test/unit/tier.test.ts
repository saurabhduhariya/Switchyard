import { describe, expect, it } from 'vitest';
import {
  barWidth,
  hasFiveHourWindow,
  isPlanTierCompatible,
  isProTier,
  isStale,
  isStarterTier,
  isUltraTier,
  quotaTone,
  shortTierName,
} from '../../webview/src/lib/tier';

describe('tier helpers', () => {
  it('detects the Starter tier by name or raw id', () => {
    expect(isStarterTier('Antigravity Starter Quota')).toBe(true);
    expect(isStarterTier('starter-tier')).toBe(true);
    expect(isStarterTier('free-tier')).toBe(true);
    expect(isStarterTier('Free')).toBe(true);
  });

  it('does not treat paid tiers as Starter', () => {
    expect(isStarterTier('Google AI Pro Quota')).toBe(false);
    expect(isStarterTier('Google AI Ultra')).toBe(false);
    expect(isStarterTier('Antigravity Quota')).toBe(false);
    expect(isStarterTier(undefined)).toBe(false);
    expect(isStarterTier('')).toBe(false);
  });

  it('hasFiveHourWindow is false only for Starter', () => {
    expect(hasFiveHourWindow('Antigravity Starter Quota')).toBe(false);
    expect(hasFiveHourWindow('Google AI Pro Quota')).toBe(true);
    expect(hasFiveHourWindow(undefined)).toBe(true);
  });

  it('shortens tier names without losing meaning', () => {
    expect(shortTierName('Antigravity Starter Quota')).toBe('Starter');
    expect(shortTierName('Google AI Pro Quota')).toBe('Google AI Pro');
    expect(shortTierName('Antigravity Quota')).toBe('Quota');
    expect(shortTierName(undefined)).toBe('Quota');
  });

  it('bands remaining quota into tones', () => {
    expect(quotaTone(100)).toBe('good');
    expect(quotaTone(31)).toBe('good');
    expect(quotaTone(30)).toBe('warn');
    expect(quotaTone(11)).toBe('warn');
    expect(quotaTone(10)).toBe('low');
    expect(quotaTone(0)).toBe('low');
    expect(quotaTone(undefined)).toBe('unknown');
    expect(quotaTone(NaN)).toBe('unknown');
  });

  it('clamps bar width', () => {
    expect(barWidth(150)).toBe(100);
    expect(barWidth(-5)).toBe(0);
    expect(barWidth(42.5)).toBe(42.5);
    expect(barWidth(undefined)).toBe(0);
  });

  it('flags data older than 24h as stale', () => {
    const now = 1_000_000_000_000;
    expect(isStale(now - 60_000, now)).toBe(false);
    expect(isStale(now - 25 * 3600_000, now)).toBe(true);
    expect(isStale(undefined, now)).toBe(false);
  });

  it('detects Ultra and Pro tiers accurately', () => {
    expect(isUltraTier('Google AI Ultra')).toBe(true);
    expect(isUltraTier('Google AI Ultra Quota')).toBe(true);
    expect(isUltraTier('g1-ultra-tier')).toBe(true);
    expect(isUltraTier('Google AI Pro')).toBe(false);
    expect(isUltraTier('Antigravity Starter')).toBe(false);

    expect(isProTier('Google AI Pro')).toBe(true);
    expect(isProTier('Google AI Pro Quota')).toBe(true);
    expect(isProTier('AI Pro')).toBe(true);
    expect(isProTier('g1-pro-tier')).toBe(true);
    expect(isProTier('Google AI Ultra')).toBe(false);
    expect(isProTier('Antigravity Starter')).toBe(false);
  });

  it('validates plan and quota compatibility to prevent cross-account contamination', () => {
    const proQuota = {
      tierName: 'Google AI Pro Quota',
      gemini: { fiveHour: { remainingPercent: 90 } },
    } as any;

    const ultraQuota = {
      tierName: 'Google AI Ultra Quota',
      gemini: { fiveHour: { remainingPercent: 95 } },
    } as any;

    const starterQuota = {
      tierName: 'Antigravity Starter Quota',
      gemini: { weekly: { remainingPercent: 50 } },
    } as any;

    const genericPaidQuota = {
      tierName: 'Antigravity Quota',
      gemini: { fiveHour: { remainingPercent: 80 } },
    } as any;

    // Ultra plan tests
    expect(isPlanTierCompatible('Google AI Ultra', ultraQuota)).toBe(true);
    expect(isPlanTierCompatible('Google AI Ultra', genericPaidQuota)).toBe(true);
    expect(isPlanTierCompatible('Google AI Ultra', proQuota)).toBe(false);
    expect(isPlanTierCompatible('Google AI Ultra', starterQuota)).toBe(false);

    // Pro plan tests
    expect(isPlanTierCompatible('Google AI Pro', proQuota)).toBe(true);
    expect(isPlanTierCompatible('Google AI Pro', genericPaidQuota)).toBe(true);
    expect(isPlanTierCompatible('Google AI Pro', ultraQuota)).toBe(false);
    expect(isPlanTierCompatible('Google AI Pro', starterQuota)).toBe(false);

    // Starter plan tests
    expect(isPlanTierCompatible('Antigravity Starter', starterQuota)).toBe(true);
    expect(isPlanTierCompatible('Antigravity Starter', proQuota)).toBe(false);
    expect(isPlanTierCompatible('Antigravity Starter', ultraQuota)).toBe(false);
    expect(isPlanTierCompatible('Antigravity Starter', genericPaidQuota)).toBe(false);
  });
});
