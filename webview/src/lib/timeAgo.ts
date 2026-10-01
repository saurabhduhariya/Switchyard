/**
 * Relative time formatting — "2 hours ago", "just now", etc.
 */
export function timeAgo(ts: number | undefined): string {
  if (!ts) return 'Never';

  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);

  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
