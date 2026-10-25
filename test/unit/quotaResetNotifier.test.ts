import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';
import {
  describeResets,
  findQuotaResets,
  QUOTA_RESET_NOTIFIED_KEY,
  QuotaResetNotifier,
  RECENT_RESET_MS,
} from '../../src/quota/QuotaResetNotifier';

vi.mock('vscode', () => ({
  window: { showInformationMessage: vi.fn() },
}));

const NOW = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

function quota(opts: {
  gWeekly?: number;
  gReset?: number;
  cWeekly?: number;
  cReset?: number;
  tier?: string;
}): AccountQuotaSummary {
  return {
    tierName: opts.tier ?? 'Google AI Pro Quota',
    updatedAt: NOW - 2 * DAY,
    source: 'live',
    gemini: {
      name: 'Gemini',
      weekly:
        opts.gWeekly === undefined ? undefined : { remainingPercent: opts.gWeekly, resetTime: iso(opts.gReset ?? DAY) },
    },
    claudeGpt: {
      name: 'Claude + GPT',
      weekly:
        opts.cWeekly === undefined ? undefined : { remainingPercent: opts.cWeekly, resetTime: iso(opts.cReset ?? DAY) },
    },
  };
}

const acct = (id: string, q?: AccountQuotaSummary, label?: string): AccountMeta =>
  ({ id, email: `${id}@example.com`, label, addedAt: 1, quota: q }) as AccountMeta;

describe('findQuotaResets', () => {
  it('reports an exhausted bucket whose reset time has passed', () => {
    const scan = findQuotaResets([acct('kk', quota({ gWeekly: 0, gReset: -HOUR }))], 'other', {}, NOW);
    expect(scan.events).toHaveLength(1);
    expect(scan.events[0]).toMatchObject({ accountId: 'kk', accountName: 'kk', bucket: 'Gemini weekly' });
    expect(scan.silent).toHaveLength(0);
  });

  it('ignores buckets that were not exhausted, have not reset yet, or belong to the active account', () => {
    const accounts = [
      acct('plenty', quota({ gWeekly: 60, gReset: -HOUR })), // was not low: nothing to announce
      acct('later', quota({ gWeekly: 2, gReset: HOUR })), // reset still ahead
      acct('active', quota({ gWeekly: 0, gReset: -HOUR })), // signed in: live data, already visible
      acct('noquota'),
    ];
    const scan = findQuotaResets(accounts, 'active', {}, NOW);
    expect(scan.events).toHaveLength(0);
    expect(scan.silent).toHaveLength(0);
  });

  it('treats 10% as exhausted but 11% as not', () => {
    const at10 = findQuotaResets([acct('a', quota({ gWeekly: 10, gReset: -HOUR }))], 'x', {}, NOW);
    const at11 = findQuotaResets([acct('a', quota({ gWeekly: 11, gReset: -HOUR }))], 'x', {}, NOW);
    expect(at10.events).toHaveLength(1);
    expect(at11.events).toHaveLength(0);
  });

  it('announces each reset only once', () => {
    const accounts = [acct('kk', quota({ gWeekly: 0, gReset: -HOUR }))];
    const first = findQuotaResets(accounts, 'x', {}, NOW);
    const notified = { [first.events[0]!.key]: NOW };
    expect(findQuotaResets(accounts, 'x', notified, NOW + HOUR).events).toHaveLength(0);
  });

  it('records very old resets silently instead of announcing them', () => {
    const accounts = [acct('kk', quota({ gWeekly: 0, gReset: -(RECENT_RESET_MS + HOUR) }))];
    const scan = findQuotaResets(accounts, 'x', {}, NOW);
    expect(scan.events).toHaveLength(0);
    expect(scan.silent).toHaveLength(1);
  });

  it('a new reset window (new reset time) is a new event', () => {
    const a1 = [acct('kk', quota({ gWeekly: 0, gReset: -2 * DAY }))];
    const a2 = [acct('kk', quota({ gWeekly: 0, gReset: -HOUR }))];
    const key1 = findQuotaResets(a1, 'x', {}, NOW).silent[0]!.key;
    expect(findQuotaResets(a2, 'x', { [key1]: NOW }, NOW).events).toHaveLength(1);
  });

  it('uses the account label when there is one, and skips the 5h window on Starter', () => {
    const q = quota({ gWeekly: 0, gReset: -HOUR, tier: 'Antigravity Starter Quota' });
    q.gemini.fiveHour = { remainingPercent: 0, resetTime: iso(-HOUR) };
    const scan = findQuotaResets([acct('kk', q, 'Work')], 'x', {}, NOW);
    expect(scan.events.map((e) => [e.accountName, e.bucket])).toEqual([['Work', 'Gemini weekly']]);
  });
});

describe('describeResets', () => {
  const ev = (accountId: string, bucket: string) => ({
    key: `${accountId}${bucket}`,
    accountId,
    accountName: accountId,
    bucket,
    resetAt: NOW,
  });

  it('single bucket on one account offers a switch', () => {
    const r = describeResets([ev('kk', 'Gemini weekly')]);
    expect(r.message).toBe('Gemini weekly quota on kk has reset (likely back to 100%).');
    expect(r.switchTo?.accountId).toBe('kk');
  });

  it('several buckets on one account are combined', () => {
    const r = describeResets([ev('kk', 'Gemini weekly'), ev('kk', 'Claude + GPT weekly')]);
    expect(r.message).toBe('kk: Gemini weekly and Claude + GPT weekly quotas have reset (likely back to 100%).');
    expect(r.switchTo?.accountId).toBe('kk');
  });

  it('several accounts give one message with no single switch target', () => {
    const r = describeResets([ev('a', 'Gemini weekly'), ev('b', 'Gemini weekly'), ev('c', 'x'), ev('d', 'y')]);
    expect(r.message).toBe('Quota has reset on 4 accounts: a, b, c and 1 more.');
    expect(r.switchTo).toBeUndefined();
  });
});

describe('QuotaResetNotifier', () => {
  let stored: Record<string, unknown>;
  let memento: any;
  const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    stored = {};
    memento = {
      get: (k: string, d?: unknown) => (k in stored ? stored[k] : d),
      update: vi.fn(async (k: string, v: unknown) => {
        stored[k] = v;
      }),
    };
  });
  afterEach(() => vi.restoreAllMocks());

  function make(over: Record<string, unknown> = {}) {
    const calls = { switch: [] as string[], open: 0, off: 0 };
    const show = vi.fn(async (_m: string, ..._a: string[]) => undefined as string | undefined);
    const notifier = new QuotaResetNotifier({
      listAccounts: async () => [acct('kk', quota({ gWeekly: 0, gReset: -HOUR }))],
      getActiveId: async () => 'someone-else',
      memento,
      logger,
      readSettings: () => ({ enabled: true }),
      onSwitch: (id) => void calls.switch.push(id),
      onOpenPanel: () => void calls.open++,
      onTurnOff: () => void calls.off++,
      showMessage: show,
      now: () => NOW,
      ...over,
    });
    return { notifier, show, calls };
  }

  it('shows one notification, then never again for the same reset', async () => {
    const { notifier, show } = make();
    await notifier.check();
    await notifier.check();
    await notifier.check();
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0]![0]).toContain('Gemini weekly quota on kk has reset');
    expect(Object.keys(stored[QUOTA_RESET_NOTIFIED_KEY] as object)).toHaveLength(1);
  });

  it('does not repeat after a restart (the memory is persisted)', async () => {
    await make().notifier.check();
    const second = make();
    await second.notifier.check();
    expect(second.show).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off, and announces later once it is turned on', async () => {
    let enabled = false;
    const { notifier, show } = make({ readSettings: () => ({ enabled }) });
    await notifier.check();
    expect(show).not.toHaveBeenCalled();
    enabled = true;
    await notifier.check();
    expect(show).toHaveBeenCalledOnce();
  });

  it('the Switch button switches to that account', async () => {
    const { notifier, show, calls } = make();
    show.mockResolvedValueOnce('Switch to kk');
    await notifier.check();
    await vi.waitFor(() => expect(calls.switch).toEqual(['kk']));
  });

  it('Turn Off calls the turn-off handler', async () => {
    const { notifier, show, calls } = make();
    show.mockResolvedValueOnce('Turn Off');
    await notifier.check();
    await vi.waitFor(() => expect(calls.off).toBe(1));
  });

  it('with several accounts the button opens the panel', async () => {
    const { notifier, show, calls } = make({
      listAccounts: async () => [
        acct('a', quota({ gWeekly: 0, gReset: -HOUR })),
        acct('b', quota({ gWeekly: 0, gReset: -HOUR })),
      ],
    });
    show.mockResolvedValueOnce('Open Switchyard');
    await notifier.check();
    await vi.waitFor(() => expect(calls.open).toBe(1));
    expect(calls.switch).toEqual([]);
  });

  it('old resets are remembered but not announced', async () => {
    const { notifier, show } = make({
      listAccounts: async () => [acct('kk', quota({ gWeekly: 0, gReset: -(RECENT_RESET_MS + HOUR) }))],
    });
    await notifier.check();
    expect(show).not.toHaveBeenCalled();
    expect(Object.keys(stored[QUOTA_RESET_NOTIFIED_KEY] as object)).toHaveLength(1);
  });

  it('forgets remembered notifications after 30 days but keeps recent ones', async () => {
    stored[QUOTA_RESET_NOTIFIED_KEY] = { 'old|key': NOW - 31 * DAY, 'fresh|key': NOW - DAY };
    await make().notifier.check(); // a new event forces the memory to be rewritten
    const saved = stored[QUOTA_RESET_NOTIFIED_KEY] as Record<string, number>;
    expect(saved['old|key']).toBeUndefined();
    expect(saved['fresh|key']).toBeDefined();
  });

  it('survives a failing account list', async () => {
    const { notifier, show } = make({
      listAccounts: async () => {
        throw new Error('storage unavailable');
      },
    });
    await expect(notifier.check()).resolves.toBeUndefined();
    expect(show).not.toHaveBeenCalled();
  });

  it('overlapping checks only announce once', async () => {
    const { notifier, show } = make();
    await Promise.all([notifier.check(), notifier.check(), notifier.check()]);
    expect(show).toHaveBeenCalledOnce();
  });
});
