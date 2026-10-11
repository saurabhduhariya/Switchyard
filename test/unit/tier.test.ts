import { describe, expect, it } from 'vitest';
import {
  barWidth,
  hasFiveHourWindow,
  isStale,
  isStarterTier,
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
});
