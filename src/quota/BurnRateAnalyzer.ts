import type * as vscode from 'vscode';
import type { AccountMeta, AccountQuotaSummary, PacingAdvisory, QuotaTrend } from '../shared/messages';
import {
  appendShortSample,
  computeAccountBurnRates,
  computePacingAdvisory,
  IN_MEMORY_SAMPLE_GAP_MS,
  pruneShortHistory,
  shortSampleFromQuota,
  type AccountBurnRates,
  type ShortQuotaSample,
} from '../shared/quotaBurnRate';
import { ShortQuotaHistoryStore } from './QuotaHistoryStore';

export interface BurnAnalysisResult {
  burnRates: Record<string, AccountBurnRates>;
  pacing?: PacingAdvisory;
}

/**
 * Windowed burn-rate & pacing analyzer backed by a fast in-memory ring buffer
 * and persisted 6-hour samples in `ShortQuotaHistoryStore`.
 */
export class BurnRateAnalyzer {
  private readonly store: ShortQuotaHistoryStore;
  private readonly memorySamples = new Map<string, ShortQuotaSample[]>();

  constructor(memento: vscode.Memento | undefined) {
    this.store = new ShortQuotaHistoryStore(memento);
  }

  private samplesFor(accountId: string, now: number): ShortQuotaSample[] {
    let mem = this.memorySamples.get(accountId);
    if (!mem) {
      mem = pruneShortHistory(this.store.get(accountId), now);
      if (mem.length > 0) {
        this.memorySamples.set(accountId, mem);
      }
    } else {
      mem = pruneShortHistory(mem, now);
      this.memorySamples.set(accountId, mem);
    }
    return mem;
  }

  async record(
    accountId: string,
    quota: AccountQuotaSummary | undefined,
    now: number = Date.now()
  ): Promise<boolean> {
    const sample = shortSampleFromQuota(quota, now);
    if (!sample) return false;

    const existing = this.samplesFor(accountId, now);
    const updated = appendShortSample(existing, sample, IN_MEMORY_SAMPLE_GAP_MS);
    if (updated.changed) {
      this.memorySamples.set(accountId, updated.history);
    }

    return this.store.record(accountId, quota, now);
  }

  getSamples(accountId: string, now: number = Date.now()): ShortQuotaSample[] {
    return this.samplesFor(accountId, now);
  }

  analyze(
    accounts: AccountMeta[],
    activeId: string | undefined,
    trends: Record<string, QuotaTrend> = {},
    now: number = Date.now()
  ): BurnAnalysisResult {
    const burnRates: Record<string, AccountBurnRates> = {};
    for (const acc of accounts) {
      if (!acc.quota) continue;
      const samples = this.samplesFor(acc.id, now);
      burnRates[acc.id] = computeAccountBurnRates(samples, acc.quota, acc.plan, now, trends[acc.id]);
    }

    const active = activeId ? accounts.find((a) => a.id === activeId) : undefined;
    const pacing = active
      ? computePacingAdvisory(
          this.samplesFor(active.id, now),
          active.quota,
          active.plan,
          now,
          trends[active.id]
        )
      : undefined;

    return { burnRates, pacing };
  }

  async prune(keepIds: string[]): Promise<void> {
    const keep = new Set(keepIds);
    for (const id of this.memorySamples.keys()) {
      if (!keep.has(id)) {
        this.memorySamples.delete(id);
      }
    }
    await this.store.prune(keepIds);
  }
}

