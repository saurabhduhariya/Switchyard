import * as vscode from 'vscode';
import type { AccountMeta } from '../shared/messages';
import { accountDisplayName, bucketLabel, LOW_QUOTA_PERCENT, readBuckets } from '../shared/quotaRules';
import type { Logger } from '../util/logger';

export const QUOTA_RESET_NOTIFIED_KEY = 'switchyard.quotaResetNotified';

/** A reset is only announced if it happened within this window; older ones are recorded silently. */
export const RECENT_RESET_MS = 24 * 60 * 60 * 1000;
/** Remembered notifications are dropped after this long. */
const NOTIFIED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

export interface ResetEvent {
  /** Unique per account, bucket and reset time, so each reset is announced once. */
  key: string;
  accountId: string;
  accountName: string;
  /** "Gemini weekly" */
  bucket: string;
  resetAt: number;
}

export interface ResetScan {
  /** Recent resets to tell the user about. */
  events: ResetEvent[];
  /** Resets that were already long ago: remembered, never announced. */
  silent: ResetEvent[];
}

/**
 * Finds buckets that were low (exhausted) when last checked and whose reset time has now passed.
 *
 * Only accounts that are NOT signed in are considered: the signed-in account's numbers are live and
 * already visible. Pure function: no I/O, no clock other than `now`.
 */
export function findQuotaResets(
  accounts: AccountMeta[],
  activeId: string | undefined,
  notified: Record<string, number>,
  now: number
): ResetScan {
  const events: ResetEvent[] = [];
  const silent: ResetEvent[] = [];

  for (const account of accounts) {
    if (account.id === activeId || !account.quota) continue;

    for (const bucket of readBuckets(account.quota)) {
      if (bucket.percent === undefined || bucket.percent > LOW_QUOTA_PERCENT) continue;
      if (!bucket.resetTime) continue;
      const resetAt = Date.parse(bucket.resetTime);
      if (Number.isNaN(resetAt) || resetAt > now) continue;

      const key = `${account.id}|${bucket.group}|${bucket.window}|${bucket.resetTime}`;
      if (notified[key] !== undefined) continue;

      const event: ResetEvent = {
        key,
        accountId: account.id,
        accountName: accountDisplayName(account),
        bucket: bucketLabel(bucket.group, bucket.window),
        resetAt,
      };
      (now - resetAt <= RECENT_RESET_MS ? events : silent).push(event);
    }
  }
  return { events, silent };
}

/** Builds the text and the buttons for one notification covering all `events`. */
export function describeResets(events: ResetEvent[]): { message: string; switchTo?: ResetEvent } {
  const byAccount = new Map<string, ResetEvent[]>();
  for (const e of events) {
    byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);
  }

  if (byAccount.size === 1) {
    const [first] = events as [ResetEvent, ...ResetEvent[]];
    const buckets = events.map((e) => e.bucket);
    const message =
      buckets.length === 1
        ? `${first.bucket} quota on ${first.accountName} has reset (likely back to 100%).`
        : `${first.accountName}: ${buckets.join(' and ')} quotas have reset (likely back to 100%).`;
    return { message, switchTo: first };
  }

  const names = [...new Set(events.map((e) => e.accountName))];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return { message: `Quota has reset on ${names.length} accounts: ${shown}${more}.` };
}

interface NotifierSettings {
  enabled: boolean;
}

export interface QuotaResetNotifierOptions {
  listAccounts: () => Promise<AccountMeta[]>;
  getActiveId: () => Promise<string | undefined>;
  memento: vscode.Memento;
  logger: Logger;
  readSettings: () => NotifierSettings;
  onSwitch: (accountId: string) => Promise<void> | void;
  onOpenPanel: () => Promise<void> | void;
  onTurnOff: () => Promise<void> | void;
  /** Test seams */
  showMessage?: (message: string, ...actions: string[]) => Thenable<string | undefined>;
  now?: () => number;
}

/**
 * Tells the user when a quota bucket that was exhausted on a saved account has reset, so they know
 * it is worth switching back. Local only: it reads the quota already stored for each account.
 */
export class QuotaResetNotifier {
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(private readonly options: QuotaResetNotifierOptions) {}

  start(): void {
    this.stop();
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }

  /** One pass. Safe to call at any time; overlapping calls are ignored. */
  async check(): Promise<void> {
    if (this.checking) return;
    if (!this.options.readSettings().enabled) return;
    this.checking = true;
    try {
      const now = (this.options.now ?? Date.now)();
      const notified = this.loadNotified(now);
      const { events, silent } = findQuotaResets(
        await this.options.listAccounts(),
        await this.options.getActiveId(),
        notified,
        now
      );
      if (events.length === 0 && silent.length === 0) return;

      // Remember first, so a reset is announced once even if the message is ignored.
      for (const e of [...events, ...silent]) {
        notified[e.key] = now;
      }
      await this.options.memento.update(QUOTA_RESET_NOTIFIED_KEY, notified);

      if (events.length > 0) {
        void this.announce(events);
      }
    } catch (err) {
      this.options.logger.debug('Quota reset check failed:', err);
    } finally {
      this.checking = false;
    }
  }

  private loadNotified(now: number): Record<string, number> {
    const stored = this.options.memento.get<Record<string, number>>(QUOTA_RESET_NOTIFIED_KEY, {}) ?? {};
    const kept: Record<string, number> = {};
    for (const [key, at] of Object.entries(stored)) {
      if (typeof at === 'number' && now - at < NOTIFIED_TTL_MS) kept[key] = at;
    }
    return kept;
  }

  private async announce(events: ResetEvent[]): Promise<void> {
    const { message, switchTo } = describeResets(events);
    const show =
      this.options.showMessage ??
      ((m: string, ...a: string[]) => vscode.window.showInformationMessage(m, ...a));

    const primary = switchTo ? `Switch to ${switchTo.accountName}` : 'Open Switchyard';
    const choice = await show(message, primary, 'Turn Off');

    if (choice === primary) {
      if (switchTo) {
        await this.options.onSwitch(switchTo.accountId);
      } else {
        await this.options.onOpenPanel();
      }
    } else if (choice === 'Turn Off') {
      await this.options.onTurnOff();
    }
  }
}
