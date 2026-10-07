import { describe, it, expect } from 'vitest';
import { formatCountdown, formatCompactAge, formatPercentage } from '../../webview/src/lib/formatQuota';

describe('formatQuota', () => {
  describe('formatCountdown', () => {
    it('returns "Resets in -" when resetTime is missing or invalid', () => {
      expect(formatCountdown(undefined)).toBe('Resets in -');
      expect(formatCountdown('')).toBe('Resets in -');
      expect(formatCountdown('invalid-date')).toBe('Resets in -');
    });

    it('returns "Quota Reset" when the reset timestamp has already passed', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      expect(formatCountdown(past)).toBe('Quota Reset');
    });

    it('formats days and hours correctly', () => {
      const future = new Date(Date.now() + (2 * 86400 + 3 * 3600 + 30) * 1000).toISOString();
      expect(formatCountdown(future)).toBe('Resets in 2d 3h');
    });

    it('formats hours and minutes correctly', () => {
      const future = new Date(Date.now() + (4 * 3600 + 15 * 60 + 30) * 1000).toISOString();
      expect(formatCountdown(future)).toBe('Resets in 4h 15m');
    });

    it('formats minutes only when under 1 hour', () => {
      const future = new Date(Date.now() + 25 * 60 * 1000).toISOString();
      expect(formatCountdown(future)).toBe('Resets in 25m');
    });
  });

  describe('formatCompactAge', () => {
    it('returns "Live" when isLive is true', () => {
      expect(formatCompactAge(Date.now() - 10_000, true)).toBe('Live');
    });

    it('returns "Unknown" when timestamp is undefined', () => {
      expect(formatCompactAge(undefined)).toBe('Unknown');
    });

    it('returns "Just now" for timestamps under 60 seconds', () => {
      expect(formatCompactAge(Date.now() - 30_000)).toBe('Just now');
    });

    it('formats minutes, hours, and days ago', () => {
      expect(formatCompactAge(Date.now() - 15 * 60 * 1000)).toBe('15m ago');
      expect(formatCompactAge(Date.now() - (2 * 3600 + 10 * 60) * 1000)).toBe('2h 10m ago');
      expect(formatCompactAge(Date.now() - (2 * 86400 + 5 * 3600) * 1000)).toBe('2d 5h ago');
    });
  });

  describe('formatPercentage', () => {
    it('returns "-" for undefined or null', () => {
      expect(formatPercentage(undefined)).toBe('-');
    });

    it('formats integer percentages without decimals', () => {
      expect(formatPercentage(0)).toBe('0%');
      expect(formatPercentage(100)).toBe('100%');
    });

    it('formats float percentages with up to 2 decimal places', () => {
      expect(formatPercentage(76.42)).toBe('76.42%');
      expect(formatPercentage(60.3678)).toBe('60.37%');
    });
  });
});
