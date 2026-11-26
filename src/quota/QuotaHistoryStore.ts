import type * as vscode from 'vscode';
import type { AccountMeta, AccountQuotaSummary, QuotaTrend } from '../shared/messages';
import {
  appendShortSample,
  computeAccountBurnRates,
  pruneShortHistory,
  shortSampleFromQuota,
  type AccountBurnRates,
  type ShortQuotaSample,
} from '../shared/quotaBurnRate';
import {
  appendSample,
  buildTrend,
  pruneHistory,
  sampleFromQuota,
  type QuotaSample,
} from '../shared/quotaHistory';

export const QUOTA_HISTORY_KEY = 'switchyard.quotaHistory';
export const SHORT_QUOTA_HISTORY_KEY = 'switchyard.shortQuotaHistory';

class MementoSampleStore<S> {
  constructor(
    private readonly memento: vscode.Memento | undefined,
    private readonly storageKey: string,
    private readonly toSample: (quota: AccountQuotaSummary | undefined, now: number) => S | undefined,
    private readonly appendFn: (history: S[], sample: S) => { history: S[]; changed: boolean }
  ) {}

  load(): Record<string, S[]> {
    return this.memento?.get<Record<string, S[]>>(this.storageKey, {}) ?? {};
  }

  async record(accountId: string, quota: AccountQuotaSummary | undefined, now: number): Promise<boolean> {
    if (!this.memento) return false;
    const sample = this.toSample(quota, now);
    if (!sample) return false;

    const all = this.load();
    const result = this.appendFn(all[accountId] ?? [], sample);
    if (!result.changed) return false;

    await this.memento.update(this.storageKey, { ...all, [accountId]: result.history });
    return true;
  }

  get(accountId: string): S[] {
    return this.load()[accountId] ?? [];
  }

  async prune(keepIds: string[]): Promise<void> {
    if (!this.memento) return;
    const all = this.load();
    const keep = new Set(keepIds);
    const stale = Object.keys(all).filter((id) => !keep.has(id));
    if (stale.length === 0) return;
    const next: Record<string, S[]> = {};
    for (const [id, history] of Object.entries(all)) {
      if (keep.has(id)) next[id] = history;
    }
    await this.memento.update(this.storageKey, next);
  }
}

/**
 * Keeps each account's recent weekly quota readings in the extension's own storage (local only).
 */
export class QuotaHistoryStore {
  private readonly inner: MementoSampleStore<QuotaSample>;

  constructor(memento: vscode.Memento | undefined) {
    this.inner = new MementoSampleStore(memento, QUOTA_HISTORY_KEY, sampleFromQuota, appendSample);
  }

  async record(accountId: string, quota: AccountQuotaSummary | undefined, now: number = Date.now()): Promise<boolean> {
    return this.inner.record(accountId, quota, now);
  }

  get(accountId: string): QuotaSample[] {
    return this.inner.get(accountId);
  }

  trends(accountIds: string[], now: number = Date.now()): Record<string, QuotaTrend> {
    const all = this.inner.load();
    const out: Record<string, QuotaTrend> = {};
    for (const id of accountIds) {
      const trend = buildTrend(all[id] ? pruneHistory(all[id], now) : undefined, now);
      if (trend) out[id] = trend;
    }
    return out;
  }

  async prune(keepIds: string[]): Promise<void> {
    return this.inner.prune(keepIds);
  }
}

/**
 * Keeps short-horizon multi-bucket readings (5h + weekly) for status-bar burn-rate tracking.
 */
export class ShortQuotaHistoryStore {
  private readonly inner: MementoSampleStore<ShortQuotaSample>;

  constructor(memento: vscode.Memento | undefined) {
    this.inner = new MementoSampleStore(memento, SHORT_QUOTA_HISTORY_KEY, shortSampleFromQuota, appendShortSample);
  }

  async record(accountId: string, quota: AccountQuotaSummary | undefined, now: number = Date.now()): Promise<boolean> {
    return this.inner.record(accountId, quota, now);
  }

  get(accountId: string): ShortQuotaSample[] {
    return this.inner.get(accountId);
  }

  burnRatesFor(
    accounts: AccountMeta[],
    trends: Record<string, QuotaTrend> = {},
    now: number = Date.now()
  ): Record<string, AccountBurnRates> {
    const all = this.inner.load();
    const out: Record<string, AccountBurnRates> = {};
    for (const acc of accounts) {
      if (!acc.quota) continue;
      const raw = all[acc.id];
      const samples = raw ? pruneShortHistory(raw, now) : [];
      out[acc.id] = computeAccountBurnRates(samples, acc.quota, acc.plan, now, trends[acc.id]);
    }
    return out;
  }

  async prune(keepIds: string[]): Promise<void> {
    return this.inner.prune(keepIds);
  }
}
