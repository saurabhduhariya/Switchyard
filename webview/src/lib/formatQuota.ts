/**
 * Formats countdown string like "Resets in 2d 3h", "Resets in 12m", or "Quota Reset"
 */
export function formatCountdown(resetTimeStr?: string): string {
  if (!resetTimeStr) return 'Resets in -';

  try {
    const target = new Date(resetTimeStr).getTime();
    if (isNaN(target)) {
      return 'Resets in -';
    }
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      return 'Quota Reset';
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
      return `Resets in ${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `Resets in ${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `Resets in ${minutes}m`;
    }
    return 'Resets in < 1m';
  } catch {
    return 'Resets in -';
  }
}

/**
 * Formats compact age string like "2d 2h ago", "15m ago", or "Live"
 */
export function formatCompactAge(ts?: number, isLive = false): string {
  if (isLive) return 'Live';
  if (!ts) return 'Unknown';

  const diff = Date.now() - ts;
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

/**
 * Formats quota percentage: e.g. 76.42 -> "76.42%", 0 -> "0%", undefined -> "-"
 */
export function formatPercentage(val?: number): string {
  if (val === undefined || val === null || isNaN(val)) return '-';
  // If it has decimal places, show up to 2 decimal places, otherwise integer
  return Number.isInteger(val) ? `${val}%` : `${val.toFixed(2)}%`;
}
