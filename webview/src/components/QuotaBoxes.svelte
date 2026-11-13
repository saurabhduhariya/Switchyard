<script lang="ts">
  import type {
    AccountQuotaSummary,
    QuotaBucket,
    QuotaTrend,
    QuotaTrendSeries,
  } from '../../../src/shared/messages';
  import { estimateQuotaSummary, hasEstimates } from '../../../src/shared/quotaEstimate';
  import { formatCountdown, formatPercentage, formatPercentShort } from '../lib/formatQuota';
  import { barWidth, quotaTone, windowsForTier } from '../lib/tier';
  import { describeTrend, formatTrendShort } from '../lib/trend';
  import Sparkline from './Sparkline.svelte';

  interface Props {
    quota?: AccountQuotaSummary;
    /** Tier shown on the card; used when the quota summary has no tier of its own. */
    tierName?: string;
    /** One-line summary instead of the full boxes (used for other accounts in compact view). */
    compact?: boolean;
    /**
     * Show buckets whose reset time has passed as an estimated 100% instead of the old number.
     * Used for accounts that are not live (see src/shared/quotaEstimate.ts).
     */
    estimate?: boolean;
    /** Recent weekly usage, drawn as a small line under the Weekly row. */
    trend?: QuotaTrend;
    /** Shown instead of the boxes when there are no quota numbers at all. */
    emptyText?: string;
  }

  let {
    quota: rawQuota,
    tierName,
    compact = false,
    estimate = false,
    trend,
    emptyText = 'No quota data yet.',
  }: Props = $props();

  // Tick every 30s to update countdowns live
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  });

  // Re-evaluated on the 30s tick, so a bucket flips to "estimated" the moment its reset passes.
  let quota = $derived(estimate ? estimateQuotaSummary(rawQuota, now) : rawQuota);
  let anyEstimated = $derived(hasEstimates(quota));

  /** Numeric remaining percentage (0-100) or undefined when unknown/disabled. */
  function getBucketNumber(bucket?: QuotaBucket, fallbackNum?: number): number | undefined {
    if (bucket) {
      if (bucket.disabled) return undefined;
      if (bucket.remainingPercent !== undefined) return bucket.remainingPercent;
      if (bucket.remainingFraction !== undefined) {
        return Math.round(bucket.remainingFraction * 10000) / 100;
      }
    }
    return fallbackNum;
  }

  function getBucketCountdown(bucket?: QuotaBucket, fallbackReset?: string): string | undefined {
    if (bucket?.disabled) return undefined;
    if (bucket?.estimated) return 'Reset passed, likely full';
    const resetTime = bucket?.resetTime || fallbackReset;
    if (!resetTime) return undefined;
    // `now` is read so the countdown re-renders on the 30s tick
    void now;
    return formatCountdown(resetTime);
  }

  // Which windows exist depends on the tier (see TIERS in src/shared/quotaRules.ts); for example
  // the Starter tier has a weekly quota only and no rolling 5-hour window.
  let windows = $derived(windowsForTier(tierName || quota?.tierName));
  let showFiveHour = $derived(windows.fiveHour);
  let showWeekly = $derived(windows.weekly);
  // Shown as a tooltip instead of an extra line of text under the boxes.
  let planNote = $derived(
    showWeekly && !showFiveHour
      ? 'Weekly quota only on this plan'
      : showFiveHour && !showWeekly
        ? '5-hour quota only on this plan'
        : undefined
  );

  let geminiWeekly = $derived(getBucketNumber(quota?.gemini?.weekly, quota?.gemini?.weeklyRemaining));
  let geminiWeeklyReset = $derived(
    getBucketCountdown(quota?.gemini?.weekly, quota?.gemini?.weeklyResetTime) || 'Resets in -'
  );
  let gemini5h = $derived(getBucketNumber(quota?.gemini?.fiveHour, quota?.gemini?.rolling5hRemaining));
  let gemini5hReset = $derived(
    getBucketCountdown(quota?.gemini?.fiveHour, quota?.gemini?.rolling5hResetTime)
  );

  let claudeWeekly = $derived(getBucketNumber(quota?.claudeGpt?.weekly, quota?.claudeGpt?.weeklyRemaining));
  let claudeWeeklyReset = $derived(
    getBucketCountdown(quota?.claudeGpt?.weekly, quota?.claudeGpt?.weeklyResetTime) || 'Resets in -'
  );
  let claude5h = $derived(
    getBucketNumber(quota?.claudeGpt?.fiveHour, quota?.claudeGpt?.rolling5hRemaining)
  );
  let claude5hReset = $derived(
    getBucketCountdown(quota?.claudeGpt?.fiveHour, quota?.claudeGpt?.rolling5hResetTime)
  );
</script>

{#snippet trendRow(series: QuotaTrendSeries | undefined, group: string)}
  {#if series}
    <div class="trend-row" title={describeTrend(series, group)}>
      <Sparkline points={series.points} label={describeTrend(series, group)} />
      <span class="trend-text">{formatTrendShort(series)}</span>
    </div>
  {/if}
{/snippet}

{#snippet metric(group: string, label: string, pct: number | undefined, reset: string | undefined, sub: boolean, est: boolean)}
  {@const tone = quotaTone(pct)}
  <div class="quota-pair" class:sub-pair={sub}>
    <div class="metric-row">
      <span class="metric-label">{label}</span>
      <span
        class="metric-val"
        class:dash={pct === undefined}
        class:est
        title={est
          ? 'Estimated: the reset time passed since this was last checked'
          : pct === undefined
            ? undefined
            : `${formatPercentage(pct)} remaining`}
        >{est ? '~' : ''}{formatPercentShort(pct)}</span
      >
      {#if tone === 'low'}
        <span class="low-chip">Low</span>
      {/if}
    </div>
    <div
      class="bar"
      role="progressbar"
      aria-label="{group} {label.toLowerCase()} quota remaining"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={pct === undefined ? undefined : Math.round(pct)}
    >
      <div class="bar-fill tone-{tone}" style:width="{barWidth(pct)}%"></div>
    </div>
    {#if reset}
      <div class="reset-row">{reset}</div>
    {/if}
  </div>
{/snippet}

{#if !rawQuota}
  <div class="empty-note" role="note">{emptyText}</div>
{:else if compact}
  <div class="compact-grid">
    {#each [{ name: 'Gemini', weekly: geminiWeekly, five: gemini5h, est: quota?.gemini?.weekly?.estimated === true }, { name: 'Claude + GPT', weekly: claudeWeekly, five: claude5h, est: quota?.claudeGpt?.weekly?.estimated === true }] as g (g.name)}
      <div class="compact-item" title="{g.name}: weekly {formatPercentage(g.weekly)}{showFiveHour ? `, 5h ${formatPercentage(g.five)}` : ''}{planNote ? `. ${planNote}` : ''}">
        <span class="compact-name">{g.name}</span>
        <span class="compact-val">{g.est ? '~' : ''}{formatPercentShort(g.weekly)}</span>
        <div class="bar thin" aria-hidden="true">
          <div class="bar-fill tone-{quotaTone(g.weekly)}" style:width="{barWidth(g.weekly)}%"></div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="quota-grid" title={planNote}>
    <!-- Gemini -->
    <div class="quota-box">
      <div class="box-title">Gemini</div>
      {#if showWeekly}
        {@render metric('Gemini', 'Weekly', geminiWeekly, geminiWeeklyReset, false, quota?.gemini?.weekly?.estimated === true)}
        {@render trendRow(trend?.gemini, 'Gemini')}
      {/if}
      {#if showFiveHour}
        {@render metric('Gemini', '5h', gemini5h, gemini5hReset, showWeekly, quota?.gemini?.fiveHour?.estimated === true)}
      {/if}
    </div>

    <!-- Claude + GPT -->
    <div class="quota-box">
      <div class="box-title">Claude + GPT</div>
      {#if showWeekly}
        {@render metric('Claude and GPT', 'Weekly', claudeWeekly, claudeWeeklyReset, false, quota?.claudeGpt?.weekly?.estimated === true)}
        {@render trendRow(trend?.claudeGpt, 'Claude and GPT')}
      {/if}
      {#if showFiveHour}
        {@render metric('Claude and GPT', '5h', claude5h, claude5hReset, showWeekly, quota?.claudeGpt?.fiveHour?.estimated === true)}
      {/if}
    </div>
  </div>
  {#if anyEstimated}
    <div class="plan-note" role="note">
      ~ Estimated: the reset passed since this account was last checked. Switch to it for exact numbers.
    </div>
  {/if}
{/if}

<style>
  /*
   * Two flat columns inside the account card, split by a single hairline.
   * No borders or backgrounds of their own, so the card doesn't hold boxes
   * inside boxes.
   */
  .quota-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
  }

  .quota-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .quota-box + .quota-box {
    padding-left: 12px;
    margin-left: 12px;
    border-left: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
  }

  /* Narrow sidebars: stack the two columns instead of squeezing them */
  @media (max-width: 320px) {
    .quota-grid {
      grid-template-columns: 1fr;
    }
    .quota-box + .quota-box {
      padding-left: 0;
      margin-left: 0;
      border-left: none;
      padding-top: 10px;
      margin-top: 10px;
      border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    }
  }

  .box-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground, #e0e0e0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .quota-pair {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .sub-pair {
    padding-top: 6px;
    border-top: 1px dashed var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
  }

  .metric-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .metric-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    font-weight: 500;
  }

  .metric-val {
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-foreground, #ffffff);
    font-variant-numeric: tabular-nums;
  }

  .metric-val.est {
    font-style: italic;
  }

  .metric-val.dash {
    color: var(--vscode-descriptionForeground, #8c8c8c);
    font-weight: 500;
  }

  .low-chip {
    margin-left: auto;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 0 5px;
    border-radius: 8px;
    color: var(--vscode-errorForeground, #f48771);
    border: 1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 55%);
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--vscode-foreground, #ccc), transparent 88%);
    overflow: hidden;
  }

  .bar.thin {
    height: 3px;
  }

  .bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  /* Healthy quota is neutral; colour is kept for amber (≤30%) and red (≤10%). */
  .tone-good {
    background: color-mix(in srgb, var(--vscode-foreground, #ccc), transparent 45%);
  }

  .tone-warn {
    background: var(--vscode-editorWarning-foreground, #cca700);
  }

  .tone-low {
    background: var(--vscode-errorForeground, #f14c4c);
  }

  .tone-unknown {
    background: transparent;
  }

  .empty-note {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px dashed var(--vscode-widget-border, rgba(255, 255, 255, 0.14));
    border-radius: 6px;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }

  .trend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .trend-text {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plan-note {
    margin-top: 6px;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }

  .reset-row {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Compact summary */
  .compact-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 8px;
  }

  @media (max-width: 240px) {
    .compact-grid {
      grid-template-columns: 1fr;
    }
  }

  .compact-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 3px 6px;
    min-width: 0;
  }

  .compact-name {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-val {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .compact-item .bar {
    grid-column: 1 / -1;
  }

  @media (prefers-reduced-motion: reduce) {
    .bar-fill {
      transition: none;
    }
  }
</style>
