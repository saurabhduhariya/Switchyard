import { rankCarouselCandidates } from './accountCarousel';
import { accountDisplayName } from './accountName';
import {
  compactTierBadge,
  formatDelayShort,
  formatPacingBucketLabel,
  formatPercentShort,
  formatResetShort,
  formatTteShort,
  shortTierName,
} from './formatQuota';
import type {
  AccountMeta,
  AccountQuotaSummary,
  PacingAdvisory,
  QuotaErrorState,
  QuotaTrend,
  StatusBarMode,
} from './messages';
import type { AccountBurnRates, BucketBurnRate } from './quotaBurnRate';
import { estimateQuotaSummary, shouldEstimate } from './quotaEstimate';
import {
  type BucketReading,
  type QuotaGroupKey,
  readBuckets,
  windowsForTier,
} from './quotaRules';

export const STATUS_BAR_WARNING_PERCENT = 15;

export const TRUSTED_STATUS_BAR_COMMANDS = [
  'switchyard.switchAccount',
  'switchyard.refresh',
  'switchyard.cycleNextAccount',
  'switchyard.openSettings',
  'switchyard.cycleStatusBarMode',
  'agSwitchyard.panel.focus',
] as const;

export type StatusBarSeverity = 'none' | 'warning' | 'error';

export interface StatusBarPresentation {
  accountItem: {
    visible: boolean;
    text: string;
    severity: StatusBarSeverity;
  };
  quotaItem: {
    visible: boolean;
    text: string;
    severity: StatusBarSeverity;
    command: string;
  };
  tooltipMarkdown: string;
}

export interface StatusBarBuildOptions {
  mode?: StatusBarMode;
  trends?: Record<string, QuotaTrend>;
  burnRates?: Record<string, AccountBurnRates>;
  pacing?: PacingAdvisory;
  quotaError?: QuotaErrorState;
  now?: number;
}

const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function buildCommandUri(command: string, args?: unknown[]): string {
  if (!args || args.length === 0) return `command:${command}`;
  const encoded = encodeURIComponent(JSON.stringify(args))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `command:${command}?${encoded}`;
}

export function renderBlockBar(percent: number | undefined, width = 6): string {
  if (percent === undefined || Number.isNaN(percent)) {
    return `[${'░'.repeat(width)}]`;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  let filled = Math.round((clamped / 100) * width);
  if (clamped > 0 && filled === 0) filled = 1;
  if (clamped < 100 && filled === width) filled = width - 1;
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

export function renderUnicodeSparkline(points: number[] | undefined, maxBars = 8): string {
  if (!points || points.length < 2) return '';
  const sampled: number[] = [];
  if (points.length <= maxBars) {
    sampled.push(...points);
  } else {
    for (let i = 0; i < maxBars; i++) {
      const idx = Math.round((i / (maxBars - 1)) * (points.length - 1));
      sampled.push(points[idx]!);
    }
  }
  return sampled
    .map((p) => {
      const clamped = Math.max(0, Math.min(100, p));
      const idx = Math.round((clamped / 100) * (SPARK_BLOCKS.length - 1));
      return SPARK_BLOCKS[idx]!;
    })
    .join('');
}

function formatRateHourly(rate: number): string {
  const val = rate >= 10 || Number.isInteger(rate) ? String(Math.round(rate)) : rate.toFixed(1);
  return `-${val}%/h`;
}

function effectiveSummary(
  quota: AccountQuotaSummary | undefined,
  isActive: boolean,
  now: number
): AccountQuotaSummary | undefined {
  if (!quota) return undefined;
  return shouldEstimate(quota, isActive, now) ? estimateQuotaSummary(quota, now) : quota;
}

interface GroupHeadline {
  group: QuotaGroupKey;
  shortName: string;
  reading: BucketReading;
}

function constrainingGroup(readings: BucketReading[], group: QuotaGroupKey, shortName: string): GroupHeadline | undefined {
  const groupReadings = readings.filter(
    (r): r is BucketReading & { percent: number } =>
      r.group === group && r.percent !== undefined && !Number.isNaN(r.percent)
  );
  if (groupReadings.length === 0) return undefined;

  let best = groupReadings[0]!;
  for (let i = 1; i < groupReadings.length; i++) {
    const candidate = groupReadings[i]!;
    if (candidate.percent < best.percent || (candidate.percent === best.percent && candidate.window === 'weekly')) {
      best = candidate;
    }
  }
  return { group, shortName, reading: best };
}

function formatBucketPct(reading: BucketReading | undefined): string {
  if (!reading || reading.percent === undefined) return '—';
  return `${reading.estimated ? '~' : ''}${formatPercentShort(reading.percent)}`;
}

export function computeQuotaSeverity(readings: BucketReading[]): StatusBarSeverity {
  const numeric = readings
    .map((r) => r.percent)
    .filter((p): p is number => p !== undefined && !Number.isNaN(p));
  if (numeric.length === 0) return 'none';
  const minPct = Math.min(...numeric);
  if (minPct <= 0) return 'error';
  if (minPct <= STATUS_BAR_WARNING_PERCENT) return 'warning';
  return 'none';
}

function formatQuotaItemText(
  mode: StatusBarMode,
  active: AccountMeta,
  effectiveQuota: AccountQuotaSummary | undefined,
  readings: BucketReading[],
  burnRates: AccountBurnRates | undefined,
  pacing: PacingAdvisory | undefined
): { visible: boolean; text: string } {
  if (mode === 'minimal') {
    const badge = compactTierBadge(active.plan || effectiveQuota?.tierName);
    return badge ? { visible: true, text: badge } : { visible: false, text: '' };
  }

  const gem = constrainingGroup(readings, 'gemini', 'Gem');
  const cld = constrainingGroup(readings, 'claudeGpt', 'Cld');
  const groups = [gem, cld].filter((g): g is GroupHeadline => g !== undefined);

  if (groups.length === 0) {
    if (mode === 'compactGraph') {
      return { visible: true, text: `${renderBlockBar(undefined)} —` };
    }
    return { visible: true, text: '$(pulse) Quota: —' };
  }

  if (mode === 'compactGraph') {
    const parts = groups.map(
      (g) => `${g.shortName} ${renderBlockBar(g.reading.percent)} ${formatBucketPct(g.reading)}`
    );
    return { visible: true, text: parts.join(' · ') };
  }

  if (mode === 'burnRate') {
    const parts: string[] = [];
    let anyActiveRate = false;
    for (const g of groups) {
      const rate: BucketBurnRate | undefined = g.group === 'gemini' ? burnRates?.gemini : burnRates?.claudeGpt;
      if (rate && rate.burnRatePerHour >= 0.5) {
        anyActiveRate = true;
        const tte = formatTteShort(rate.tteMinutes);
        const detail = tte ? `${formatRateHourly(rate.burnRatePerHour)} · ${tte}` : formatRateHourly(rate.burnRatePerHour);
        parts.push(`${g.shortName} ${formatBucketPct(g.reading)} (${detail})`);
      } else {
        parts.push(`${g.shortName} ${formatBucketPct(g.reading)}`);
      }
    }
    const icon = pacing?.safety === 'critical' ? '$(warning)' : '$(pulse)';
    const suffix = anyActiveRate ? '' : ' (0%/h)';
    return { visible: true, text: `${icon} ${parts.join(' · ')}${suffix}` };
  }

  // Default: 'quota'
  const parts = groups.map((g) => `${g.shortName} ${formatBucketPct(g.reading)}`);
  return { visible: true, text: `$(pulse) ${parts.join(' · ')}` };
}

/**
 * Formats a concise quota string for tooltips and pickers, e.g. "Gem 84%, Cld ~100%".
 */
export function formatAccountQuotaBrief(
  acc: AccountMeta,
  isActive = false,
  now: number = Date.now()
): string | undefined {
  const effective = effectiveSummary(acc.quota, isActive, now);
  if (!effective) return undefined;
  const readings = readBuckets(effective, acc.plan);
  const gem = constrainingGroup(readings, 'gemini', 'Gem');
  const cld = constrainingGroup(readings, 'claudeGpt', 'Cld');
  const parts = [gem, cld]
    .filter((g): g is GroupHeadline => g !== undefined)
    .map((g) => `${g.shortName} ${formatBucketPct(g.reading)}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function severityIcon(percent: number | undefined): string {
  if (percent === undefined || Number.isNaN(percent)) return '';
  if (percent <= 0) return ' $(error)';
  if (percent <= STATUS_BAR_WARNING_PERCENT) return ' $(warning)';
  return '';
}

function buildQuickSwitchLinks(
  accounts: AccountMeta[],
  activeId: string | undefined,
  hideEmails: boolean,
  now: number
): string | undefined {
  const candidates = rankCarouselCandidates(accounts, activeId, now).slice(0, 3);
  if (candidates.length === 0) return undefined;

  const links = candidates.map((acc) => {
    const name = escapeMarkdown(accountDisplayName(acc, hideEmails));
    const quotaHint = formatAccountQuotaBrief(acc, false, now);
    const suffix = quotaHint ? ` (${escapeMarkdown(quotaHint)})` : '';
    const uri = buildCommandUri('switchyard.switchAccount', [acc.id]);
    return `[${name}${suffix}](${uri})`;
  });

  if (activeId && candidates.length >= 1) {
    links.push(`[Next $(arrow-right)](${buildCommandUri('switchyard.cycleNextAccount')})`);
  }

  return `**Switch to:** ${links.join(' · ')}`;
}

function buildActionFooter(): string {
  return [
    `[$(sync) Refresh Quota](${buildCommandUri('switchyard.refresh')})`,
    `[$(layout-sidebar-left) Open Panel](${buildCommandUri('agSwitchyard.panel.focus')})`,
    `[$(gear) Settings](${buildCommandUri('switchyard.openSettings')})`,
  ].join(' · ');
}

function buildActiveTooltip(
  active: AccountMeta,
  accounts: AccountMeta[],
  effectiveQuota: AccountQuotaSummary | undefined,
  readings: BucketReading[],
  hideEmails: boolean,
  trend: QuotaTrend | undefined,
  burnRates: AccountBurnRates | undefined,
  pacing: PacingAdvisory | undefined,
  quotaError: QuotaErrorState | undefined,
  now: number
): string {
  const sections: string[] = [];
  const displayName = escapeMarkdown(accountDisplayName(active, hideEmails));
  const rawTier = active.plan || effectiveQuota?.tierName;
  const tierLabel = rawTier ? shortTierName(rawTier) : undefined;
  const emailNote =
    !hideEmails && active.label?.trim() ? ` · \`${escapeMarkdown(active.email)}\`` : '';
  const tierBadge = tierLabel && tierLabel !== 'Quota' ? ` — *${escapeMarkdown(tierLabel)}*` : '';

  sections.push(`$(account) **${displayName}**${emailNote}${tierBadge}`);

  if (effectiveQuota && readings.length > 0) {
    const windows = windowsForTier(rawTier);
    const rows: string[] = [
      '| Model | Weekly | 5h | Reset |',
      '| :--- | :---: | :---: | :--- |',
    ];

    const groups: Array<{ key: QuotaGroupKey; title: string; spark?: string }> = [
      { key: 'gemini', title: 'Gemini', spark: renderUnicodeSparkline(trend?.gemini?.points) },
      { key: 'claudeGpt', title: 'Claude + GPT', spark: renderUnicodeSparkline(trend?.claudeGpt?.points) },
    ];

    for (const g of groups) {
      const weekly = readings.find((r) => r.group === g.key && r.window === 'weekly');
      const fiveHour = windows.fiveHour
        ? readings.find((r) => r.group === g.key && r.window === 'fiveHour')
        : undefined;

      const weeklyBase = weekly
        ? `${formatBucketPct(weekly)}${severityIcon(weekly.percent)}`
        : '—';
      const weeklyCell = g.spark ? `${weeklyBase} ${g.spark}` : weeklyBase;

      const fiveHourCell = !windows.fiveHour
        ? '—'
        : fiveHour
          ? `${formatBucketPct(fiveHour)}${severityIcon(fiveHour.percent)}`
          : '—';

      const resetParts: string[] = [];
      if (weekly?.resetTime) {
        resetParts.push(windows.fiveHour ? `W: ${formatResetShort(weekly.resetTime, now)}` : formatResetShort(weekly.resetTime, now));
      } else if (weekly?.estimated) {
        resetParts.push('Reset passed');
      }
      if (windows.fiveHour) {
        if (fiveHour?.resetTime) {
          resetParts.push(`5h: ${formatResetShort(fiveHour.resetTime, now)}`);
        } else if (fiveHour?.estimated) {
          resetParts.push('5h reset');
        }
      }
      const resetCell = resetParts.length > 0 ? resetParts.join(' · ') : '—';

      rows.push(`| **${g.title}** | ${weeklyCell} | ${fiveHourCell} | ${resetCell} |`);
    }

    sections.push(rows.join('\n'));
  } else {
    sections.push('_No quota readings yet._');
  }

  if (pacing) {
    const label = formatPacingBucketLabel(pacing.bucket);
    const tte = formatTteShort(pacing.tteMinutes);
    const ttr = pacing.ttrMinutes !== null ? formatTteShort(pacing.ttrMinutes, false) : undefined;
    const pacingParts = [formatRateHourly(pacing.burnRatePerHour)];
    if (tte) pacingParts.push(tte);
    if (ttr) pacingParts.push(`reset in ${ttr.replace(/^~/, '')}`);
    const delay = formatDelayShort(pacing.recommendedDelaySec);
    const hint = delay
      ? pacing.safety === 'critical'
        ? ` — slow down (${delay} pause)`
        : ` — ease pace (${delay} pause)`
      : pacing.safety === 'sustainable'
        ? ' — safe until reset'
        : '';
    const icon = pacing.safety === 'critical' ? '$(warning)' : '$(flame)';
    sections.push(`${icon} **Pacing (${label}):** ${pacingParts.join(' · ')}${hint}`);
  } else {
    const activeBurnParts: string[] = [];
    if (burnRates?.gemini && burnRates.gemini.burnRatePerHour >= 0.5) {
      const tte = formatTteShort(burnRates.gemini.tteMinutes);
      activeBurnParts.push(
        `Gem ${formatRateHourly(burnRates.gemini.burnRatePerHour)}${tte ? ` (${tte})` : ''}`
      );
    }
    if (burnRates?.claudeGpt && burnRates.claudeGpt.burnRatePerHour >= 0.5) {
      const tte = formatTteShort(burnRates.claudeGpt.tteMinutes);
      activeBurnParts.push(
        `Cld ${formatRateHourly(burnRates.claudeGpt.burnRatePerHour)}${tte ? ` (${tte})` : ''}`
      );
    }
    if (activeBurnParts.length > 0) {
      sections.push(`$(flame) **Burn rate:** ${activeBurnParts.join(' · ')}`);
    }
  }

  if (quotaError && quotaError.accountId === active.id) {
    sections.push(`$(warning) ${escapeMarkdown(quotaError.message)}`);
  }

  const switchLinks = buildQuickSwitchLinks(accounts, active.id, hideEmails, now);
  if (switchLinks) {
    sections.push(switchLinks);
  }

  sections.push(buildActionFooter());
  return sections.join('\n\n');
}

export function buildStatusBarPresentation(
  accounts: AccountMeta[],
  activeId?: string,
  hideEmails = false,
  options: StatusBarBuildOptions = {}
): StatusBarPresentation {
  const mode = options.mode ?? 'quota';
  const now = options.now ?? Date.now();

  if (accounts.length === 0) {
    return {
      accountItem: { visible: false, text: '', severity: 'none' },
      quotaItem: { visible: false, text: '', severity: 'none', command: 'agSwitchyard.panel.focus' },
      tooltipMarkdown: '',
    };
  }

  const active = accounts.find((a) => a.id === activeId);
  if (!active) {
    const switchLinks = buildQuickSwitchLinks(accounts, undefined, hideEmails, now);
    const sections = ['$(account) **Switchyard** · No active account'];
    if (switchLinks) sections.push(switchLinks);
    sections.push(buildActionFooter());

    return {
      accountItem: { visible: true, text: '$(account) No active account', severity: 'none' },
      quotaItem: { visible: false, text: '', severity: 'none', command: 'agSwitchyard.panel.focus' },
      tooltipMarkdown: sections.join('\n\n'),
    };
  }

  const accountLabel = hideEmails ? accountDisplayName(active, true) : active.email;
  const effectiveQuota = effectiveSummary(active.quota, true, now);
  const readings = readBuckets(effectiveQuota, active.plan);
  const severity = computeQuotaSeverity(readings);
  const burnRates = options.burnRates?.[active.id];
  const quotaDisplay = formatQuotaItemText(mode, active, effectiveQuota, readings, burnRates, options.pacing);

  const tooltipMarkdown = buildActiveTooltip(
    active,
    accounts,
    effectiveQuota,
    readings,
    hideEmails,
    options.trends?.[active.id],
    burnRates,
    options.pacing,
    options.quotaError,
    now
  );

  return {
    accountItem: {
      visible: true,
      text: `$(account) ${accountLabel}`,
      // Fallback severity onto account pill only if the secondary quota pill is hidden (minimal mode with unknown tier).
      severity: quotaDisplay.visible ? 'none' : severity,
    },
    quotaItem: {
      visible: quotaDisplay.visible,
      text: quotaDisplay.text,
      severity: quotaDisplay.visible ? severity : 'none',
      command: 'agSwitchyard.panel.focus',
    },
    tooltipMarkdown,
  };
}
