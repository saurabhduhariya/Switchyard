import { beforeEach, describe, expect, it, vi } from 'vitest';

const createdItems: Array<{
  id: string;
  alignment: number;
  priority: number;
  name?: string;
  command?: string;
  text: string;
  tooltip: unknown;
  backgroundColor?: unknown;
  visible: boolean;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  MarkdownString: class MarkdownString {
    public isTrusted?: boolean | { enabledCommands: string[] };
    constructor(public value: string, public supportThemeIcons = false) {}
  },
  ThemeColor: class ThemeColor {
    constructor(public readonly id: string) {}
  },
  window: {
    createStatusBarItem: vi.fn((id: string, alignment: number, priority: number) => {
      const item = {
        id,
        alignment,
        priority,
        name: undefined as string | undefined,
        command: undefined as string | undefined,
        text: '',
        tooltip: '',
        backgroundColor: undefined as unknown,
        visible: false,
        show: vi.fn(function (this: any) {
          this.visible = true;
        }),
        hide: vi.fn(function (this: any) {
          this.visible = false;
        }),
        dispose: vi.fn(),
      };
      createdItems.push(item);
      return item;
    }),
  },
}));

import { StatusBar } from '../../src/ui/StatusBar';
import {
  buildStatusBarPresentation,
  renderBlockBar,
  renderUnicodeSparkline,
} from '../../src/shared/statusBarModel';
import type { AccountMeta, AccountQuotaSummary } from '../../src/shared/messages';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function makeQuota(opts: {
  tier?: string;
  gw?: number;
  g5?: number;
  cw?: number;
  c5?: number;
  resetOffset?: number;
  source?: 'live' | 'cache';
  updatedAt?: number;
}): AccountQuotaSummary {
  const b = (pct?: number, resetOffset = 5 * DAY) =>
    pct === undefined ? undefined : { remainingPercent: pct, resetTime: iso(resetOffset) };
  return {
    tierName: opts.tier ?? 'Google AI Pro Quota',
    updatedAt: opts.updatedAt ?? NOW - 60_000,
    source: opts.source ?? 'live',
    gemini: {
      name: 'Gemini',
      weekly: b(opts.gw, opts.resetOffset ?? 5 * DAY),
      fiveHour: b(opts.g5, 3 * HOUR),
    },
    claudeGpt: {
      name: 'Claude + GPT',
      weekly: b(opts.cw, 6 * DAY),
      fiveHour: b(opts.c5, 4 * HOUR),
    },
  };
}

const PRO_ACTIVE: AccountMeta = {
  id: 'acc-1',
  email: 'dev@example.com',
  label: 'Work',
  plan: 'Pro',
  addedAt: 1,
  quota: makeQuota({ gw: 84, g5: 100, cw: 42, c5: 80 }),
};

const WORK_OTHER: AccountMeta = {
  id: 'acc-2',
  email: 'alt@example.com',
  label: 'Personal [Backup] (2)',
  plan: 'Pro',
  addedAt: 2,
  pinned: true,
  quota: makeQuota({ gw: 95, g5: 90, cw: 100, c5: 100, source: 'cache' }),
};

describe('statusBarModel', () => {
  it('renders unicode block bars accurately across boundaries', () => {
    expect(renderBlockBar(undefined)).toBe('[░░░░░░]');
    expect(renderBlockBar(0)).toBe('[░░░░░░]');
    expect(renderBlockBar(3)).toBe('[█░░░░░]');
    expect(renderBlockBar(42)).toBe('[███░░░]');
    expect(renderBlockBar(68)).toBe('[████░░]');
    expect(renderBlockBar(84)).toBe('[█████░]');
    expect(renderBlockBar(99)).toBe('[█████░]');
    expect(renderBlockBar(100)).toBe('[██████]');
  });

  it('renders compact unicode sparklines from history points', () => {
    expect(renderUnicodeSparkline(undefined)).toBe('');
    expect(renderUnicodeSparkline([50])).toBe('');
    expect(renderUnicodeSparkline([100, 75, 50, 25, 0])).toBe('█▆▅▃▁');
    expect(renderUnicodeSparkline([100, 80, 60, 40, 20, 10, 5, 2, 1, 0])).toHaveLength(8);
  });

  it('hides both items when no accounts exist, and handles signed-out state', () => {
    const empty = buildStatusBarPresentation([], undefined);
    expect(empty.accountItem.visible).toBe(false);
    expect(empty.quotaItem.visible).toBe(false);

    const signedOut = buildStatusBarPresentation([PRO_ACTIVE, WORK_OTHER], undefined, false, { now: NOW });
    expect(signedOut.accountItem.visible).toBe(true);
    expect(signedOut.accountItem.text).toBe('$(account) No active account');
    expect(signedOut.quotaItem.visible).toBe(false);
    expect(signedOut.tooltipMarkdown).toContain('command:switchyard.switchAccount');
  });

  it('formats all four statusBarMode variants faithfully', () => {
    const accounts = [PRO_ACTIVE, WORK_OTHER];

    const quotaMode = buildStatusBarPresentation(accounts, 'acc-1', false, { mode: 'quota', now: NOW });
    expect(quotaMode.accountItem.text).toBe('$(account) dev@example.com');
    expect(quotaMode.quotaItem.text).toBe('$(pulse) Gem 84% · Cld 42%');

    const graphMode = buildStatusBarPresentation(accounts, 'acc-1', false, { mode: 'compactGraph', now: NOW });
    expect(graphMode.quotaItem.text).toBe('Gem [█████░] 84% · Cld [███░░░] 42%');

    const minimalMode = buildStatusBarPresentation(accounts, 'acc-1', false, { mode: 'minimal', now: NOW });
    expect(minimalMode.quotaItem.visible).toBe(true);
    expect(minimalMode.quotaItem.text).toBe('Pro');

    const burnMode = buildStatusBarPresentation(accounts, 'acc-1', false, {
      mode: 'burnRate',
      burnRates: {
        'acc-1': {
          gemini: { burnRatePerHour: 18, tteMinutes: 140 },
          claudeGpt: { burnRatePerHour: 0, tteMinutes: null },
        },
      },
      pacing: {
        bucket: 'gemini.fiveHour',
        burnRatePerHour: 18,
        tteMinutes: 140,
        ttrMinutes: 258,
        safety: 'critical',
        recommendedDelaySec: 25,
      },
      now: NOW,
    });
    expect(burnMode.quotaItem.text).toBe('$(warning) Gem 84% (-18%/h · ~2.3h left) · Cld 42%');
    expect(burnMode.tooltipMarkdown).toContain('**Pacing (Gemini 5h):** -18%/h · ~2.3h left');
    expect(burnMode.tooltipMarkdown).toContain('slow down (~25s pause)');

    const idleBurnMode = buildStatusBarPresentation(accounts, 'acc-1', false, {
      mode: 'burnRate',
      burnRates: { 'acc-1': { gemini: { burnRatePerHour: 0, tteMinutes: null } } },
      now: NOW,
    });
    expect(idleBurnMode.quotaItem.text).toBe('$(pulse) Gem 84% · Cld 42% (0%/h)');
  });

  it('computes dynamic warning (<=15%) and error (0%) severities while respecting Starter tiers and passed resets', () => {
    const warnAcc: AccountMeta = {
      ...PRO_ACTIVE,
      quota: makeQuota({ gw: 80, g5: 15, cw: 90, c5: 90 }),
    };
    const warnRes = buildStatusBarPresentation([warnAcc], 'acc-1', false, { now: NOW });
    expect(warnRes.quotaItem.severity).toBe('warning');
    expect(warnRes.quotaItem.text).toBe('$(pulse) Gem 15% · Cld 90%');

    const errAcc: AccountMeta = {
      ...PRO_ACTIVE,
      quota: makeQuota({ gw: 80, g5: 0, cw: 90, c5: 90 }),
    };
    const errRes = buildStatusBarPresentation([errAcc], 'acc-1', false, { now: NOW });
    expect(errRes.quotaItem.severity).toBe('error');

    // Minimal mode with no recognizable tier hides quotaItem and propagates severity to accountItem
    const unknownTierWarn: AccountMeta = {
      id: 'acc-unk',
      email: 'unk@example.com',
      addedAt: 1,
      quota: makeQuota({ tier: 'Antigravity Quota', gw: 10, g5: 50, cw: 80, c5: 80 }),
    };
    const minimalFallback = buildStatusBarPresentation([unknownTierWarn], 'acc-unk', false, {
      mode: 'minimal',
      now: NOW,
    });
    expect(minimalFallback.quotaItem.visible).toBe(false);
    expect(minimalFallback.accountItem.severity).toBe('warning');

    // Starter tier has no 5h window: stale 0 in fiveHour must not trigger error
    const starterAcc: AccountMeta = {
      ...PRO_ACTIVE,
      plan: 'Free',
      quota: makeQuota({ tier: 'Antigravity Starter Quota', gw: 65, g5: 0, cw: 80, c5: 0 }),
    };
    const starterRes = buildStatusBarPresentation([starterAcc], 'acc-1', false, { now: NOW });
    expect(starterRes.quotaItem.severity).toBe('none');
    expect(starterRes.tooltipMarkdown).toContain('| **Gemini** | 65% | — |');

    // Reset already passed on stale reading -> estimated ~100%, so not error
    const refilled: AccountMeta = {
      ...PRO_ACTIVE,
      quota: makeQuota({
        gw: 0,
        g5: 100,
        cw: 100,
        c5: 100,
        resetOffset: -1 * HOUR,
        updatedAt: NOW - 2 * HOUR,
      }),
    };
    const refillRes = buildStatusBarPresentation([refilled], 'acc-1', false, { now: NOW });
    expect(refillRes.quotaItem.severity).toBe('none');
    expect(refillRes.quotaItem.text).toContain('Gem ~100%');
  });

  it('respects hideEmails strictly and escapes markdown in labels', () => {
    const res = buildStatusBarPresentation([PRO_ACTIVE, WORK_OTHER], 'acc-1', true, {
      trends: { 'acc-1': { gemini: { points: [100, 90, 84] } } },
      now: NOW,
    });
    expect(res.accountItem.text).toBe('$(account) Work');
    expect(res.tooltipMarkdown).not.toContain('dev@example.com');
    expect(res.tooltipMarkdown).not.toContain('alt@example.com');
    expect(res.tooltipMarkdown).toContain('\\[Backup\\]');
    expect(res.tooltipMarkdown).toContain('command:switchyard.switchAccount?%5B%22acc-2%22%5D');
    expect(res.tooltipMarkdown).toContain('command:switchyard.refresh');
    expect(res.tooltipMarkdown).toContain('command:switchyard.cycleNextAccount');
  });
});

describe('StatusBar VS Code Adapter', () => {
  beforeEach(() => {
    createdItems.length = 0;
  });

  it('creates dual status bar items, applies ThemeColor severity and clears it when healthy', () => {
    const sb = new StatusBar();
    expect(createdItems).toHaveLength(2);
    const [accountItem, quotaItem] = createdItems as [typeof createdItems[0], typeof createdItems[0]];
    expect(accountItem.id).toBe('switchyard.statusBar.account');
    expect(accountItem.priority).toBe(50);
    expect(quotaItem.id).toBe('switchyard.statusBar.quota');
    expect(quotaItem.priority).toBe(49);

    const warnAcc: AccountMeta = {
      ...PRO_ACTIVE,
      quota: makeQuota({ gw: 12, g5: 50, cw: 80, c5: 80 }),
    };
    sb.update([warnAcc, WORK_OTHER], 'acc-1', false, { mode: 'quota', now: NOW });

    expect(accountItem.visible).toBe(true);
    expect(quotaItem.visible).toBe(true);
    expect((quotaItem.backgroundColor as any)?.id).toBe('statusBarItem.warningBackground');
    expect((quotaItem.tooltip as any)?.supportThemeIcons).toBe(true);
    expect((quotaItem.tooltip as any)?.isTrusted?.enabledCommands).toContain('switchyard.switchAccount');

    // Update with healthy account -> clears warning background
    sb.update([PRO_ACTIVE, WORK_OTHER], 'acc-1', false, { mode: 'quota', now: NOW });
    expect(quotaItem.backgroundColor).toBeUndefined();

    sb.dispose();
    expect(accountItem.dispose).toHaveBeenCalledOnce();
    expect(quotaItem.dispose).toHaveBeenCalledOnce();
  });
});

