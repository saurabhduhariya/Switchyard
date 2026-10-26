import type { QuotaTrendSeries } from '../../../src/shared/messages';

/** "Used 12% in 24h", "Used 3% in 5h", "No change in 24h", or a neutral caption when unknown. */
export function formatTrendText(series: QuotaTrendSeries | undefined): string {
  if (!series) return '';
  if (series.usedPercent === undefined || series.spanHours === undefined) return 'Last 7 days';

  const hours = series.spanHours;
  const span = hours >= 23.5 ? '24h' : hours >= 1 ? `${Math.round(hours)}h` : `${Math.max(1, Math.round(hours * 60))}m`;
  const used = series.usedPercent;
  if (used < 0.1) return `No change in ${span}`;
  const text = used >= 10 ? String(Math.round(used)) : String(Math.round(used * 10) / 10);
  return `Used ${text}% in ${span}`;
}

/** Longer description for screen readers and tooltips. */
export function describeTrend(series: QuotaTrendSeries | undefined, label: string): string {
  if (!series || series.points.length < 2) return '';
  const first = Math.round(series.points[0]!);
  const last = Math.round(series.points[series.points.length - 1]!);
  const used = formatTrendText(series);
  return `${label} weekly remaining over the last 7 days: from ${first}% to ${last}%. ${used}.`;
}

export interface SparklineGeometry {
  /** SVG "points" attribute for the line. */
  line: string;
  /** x, y of the last point (drawn as a dot). */
  end: { x: number; y: number };
}

/**
 * Turns remaining-% values into SVG coordinates. The vertical scale is always 0-100% so lines on
 * different accounts can be compared at a glance, with a little padding so the stroke is not clipped.
 */
export function sparklineGeometry(points: number[], width: number, height: number, pad = 2): SparklineGeometry | undefined {
  if (points.length < 2 || width <= pad * 2 || height <= pad * 2) return undefined;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const coords = points.map((p, i) => {
    const clamped = Math.max(0, Math.min(100, p));
    const x = pad + (i / (points.length - 1)) * innerW;
    const y = pad + (1 - clamped / 100) * innerH;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  });
  return {
    line: coords.map((c) => `${c.x},${c.y}`).join(' '),
    end: coords[coords.length - 1]!,
  };
}
