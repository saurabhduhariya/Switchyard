/**
 * Shared quota formatting and tier-label helpers used across extension host and webview.
 */

function formatResetDuration(resetTimeStr: string | undefined, now: number, prefix: string, expiredText: string, emptyText: string): string {
  if (!resetTimeStr) return emptyText;
  const target = Date.parse(resetTimeStr);
  if (Number.isNaN(target)) return emptyText;

  const diff = target - now;
  if (diff <= 0) return expiredText;

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${prefix}${days}d ${hours}h`;
  if (hours > 0) return `${prefix}${hours}h ${minutes}m`;
  if (minutes > 0) return `${prefix}${minutes}m`;
  return `${prefix}< 1m`;
}

export function formatCountdown(resetTimeStr?: string, now: number = Date.now()): string {
  return formatResetDuration(resetTimeStr, now, 'Resets in ', 'Quota Reset', 'Resets in -');
}

export function formatResetShort(resetTimeStr?: string, now: number = Date.now()): string {
  return formatResetDuration(resetTimeStr, now, '', 'Reset', '—');
}

export function formatCompactAge(ts?: number, isLive = false, now: number = Date.now()): string {
  if (isLive) return 'Live';
  if (!ts) return 'Unknown';

  const diff = now - ts;
  if (diff < 60_000) return 'Just now';

  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h ago` : `${days}d ago`;
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  }
  return `${mins}m ago`;
}

export function formatPercentShort(val?: number): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '-';
  if (val > 0 && val < 1) return '<1%';
  if (val > 99 && val < 100) return '99%';
  return `${Math.round(val)}%`;
}

export function formatPercentage(val?: number): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '-';
  return Number.isInteger(val) ? `${val}%` : `${val.toFixed(2)}%`;
}

export function shortTierName(tierName?: string): string {
  if (!tierName) return 'Quota';
  const short = tierName
    .replace(/^Antigravity\s+/i, '')
    .replace(/\s+Quota$/i, '')
    .trim();
  return short || tierName;
}

/** Compact badge label for minimal status bar mode (e.g. "Google AI Pro Quota" -> "Pro"). */
export function compactTierBadge(tierName?: string): string | undefined {
  if (!tierName) return undefined;
  const trimmed = tierName.trim();
  if (!trimmed) return undefined;
  const short = shortTierName(trimmed);
  if (short === 'Quota') return undefined;
  const withoutBrand = short
    .replace(/^Google\s+AI\s+/i, '')
    .replace(/^AI\s+/i, '')
    .trim();
  return withoutBrand || short;
}

