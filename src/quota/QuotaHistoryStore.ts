import type * as vscode from 'vscode';
import type { AccountQuotaSummary, QuotaTrend } from '../shared/messages';
import {
  appendSample,
  buildTrend,
  pruneHistory,
  sampleFromQuota,
  type QuotaSample,
} from '../shared/quotaHistory';

export const QUOTA_HISTORY_KEY = 'switchyard.quotaHistory';

type HistoryMap = Record<string, QuotaSample[]>;

/**
 * Keeps each account's recent weekly quota readings in the extension's own storage (local only).
 * Writes are rare: a reading is only stored when it changed or enough time passed.
 */
export class QuotaHistoryStore {
  constructor(private readonly memento: vscode.Memento | undefined) {}

  private load(): HistoryMap {
    return this.memento?.get<HistoryMap>(QUOTA_HISTORY_KEY, {}) ?? {};
  }

  /** Records a reading for an account. Returns true when something was stored. */
  async record(accountId: string, quota: AccountQuotaSummary | undefined, now: number = Date.now()): Promise<boolean> {
    if (!this.memento) return false;
    const sample = sampleFromQuota(quota, now);
    if (!sample) return false;

    const all = this.load();
    const result = appendSample(all[accountId] ?? [], sample);
    if (!result.changed) return false;

    await this.memento.update(QUOTA_HISTORY_KEY, { ...all, [accountId]: result.history });
    return true;
  }

  get(accountId: string): QuotaSample[] {
    return this.load()[accountId] ?? [];
  }

  /** Trend data for each of the given accounts (accounts with nothing to show are left out). */
  trends(accountIds: string[], now: number = Date.now()): Record<string, QuotaTrend> {
    const all = this.load();
    const out: Record<string, QuotaTrend> = {};
    for (const id of accountIds) {
      const trend = buildTrend(all[id] ? pruneHistory(all[id], now) : undefined, now);
      if (trend) out[id] = trend;
    }
    return out;
  }

  /** Forgets accounts that no longer exist. */
  async prune(keepIds: string[]): Promise<void> {
    if (!this.memento) return;
    const all = this.load();
    const keep = new Set(keepIds);
    const stale = Object.keys(all).filter((id) => !keep.has(id));
    if (stale.length === 0) return;
    const next: HistoryMap = {};
    for (const [id, history] of Object.entries(all)) {
      if (keep.has(id)) next[id] = history;
    }
    await this.memento.update(QUOTA_HISTORY_KEY, next);
  }
}
