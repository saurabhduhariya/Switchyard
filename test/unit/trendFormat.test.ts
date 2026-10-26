import { describe, expect, it } from 'vitest';
import { describeTrend, formatTrendText, sparklineGeometry } from '../../webview/src/lib/trend';

describe('formatTrendText', () => {
  it('says how much was used and over what time', () => {
    expect(formatTrendText({ points: [90, 80], usedPercent: 12.4, spanHours: 24 })).toBe('Used 12% in 24h');
    expect(formatTrendText({ points: [90, 80], usedPercent: 3.46, spanHours: 24 })).toBe('Used 3.5% in 24h');
  });

  it('is honest when history is shorter than a day', () => {
    expect(formatTrendText({ points: [90, 80], usedPercent: 5, spanHours: 5 })).toBe('Used 5% in 5h');
    expect(formatTrendText({ points: [90, 80], usedPercent: 1, spanHours: 0.5 })).toBe('Used 1% in 30m');
    expect(formatTrendText({ points: [90, 80], usedPercent: 1, spanHours: 23.6 })).toBe('Used 1% in 24h');
  });

  it('reports no usage as no change', () => {
    expect(formatTrendText({ points: [80, 80], usedPercent: 0, spanHours: 24 })).toBe('No change in 24h');
    expect(formatTrendText({ points: [80, 80], usedPercent: 0.04, spanHours: 24 })).toBe('No change in 24h');
  });

  it('falls back to a neutral caption when the 24h figure is not available', () => {
    expect(formatTrendText({ points: [90, 80] })).toBe('Last 7 days');
    expect(formatTrendText(undefined)).toBe('');
  });
});

describe('describeTrend', () => {
  it('spells out the line for screen readers', () => {
    const text = describeTrend({ points: [90.2, 85, 79.6], usedPercent: 10, spanHours: 24 }, 'Gemini');
    expect(text).toBe('Gemini weekly remaining over the last 7 days: from 90% to 80%. Used 10% in 24h.');
  });

  it('is empty without enough points', () => {
    expect(describeTrend(undefined, 'Gemini')).toBe('');
    expect(describeTrend({ points: [50] }, 'Gemini')).toBe('');
  });
});

describe('sparklineGeometry', () => {
  it('maps 100% to the top and 0% to the bottom of the padded area', () => {
    const g = sparklineGeometry([100, 0], 64, 18, 2)!;
    expect(g.line).toBe('2,2 62,16');
    expect(g.end).toEqual({ x: 62, y: 16 });
  });

  it('spreads points evenly from left to right', () => {
    const g = sparklineGeometry([50, 50, 50], 64, 18, 2)!;
    const xs = g.line.split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs).toEqual([2, 32, 62]);
  });

  it('clamps out-of-range values instead of drawing outside the box', () => {
    const g = sparklineGeometry([150, -20], 64, 18, 2)!;
    expect(g.line).toBe('2,2 62,16');
  });

  it('needs two points and a usable size', () => {
    expect(sparklineGeometry([50], 64, 18)).toBeUndefined();
    expect(sparklineGeometry([], 64, 18)).toBeUndefined();
    expect(sparklineGeometry([1, 2], 3, 3)).toBeUndefined();
  });
});
