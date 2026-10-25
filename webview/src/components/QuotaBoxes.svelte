<script lang="ts">
  import type { AccountQuotaSummary, QuotaBucket } from '../../../src/shared/messages';
  import { estimateQuotaSummary, hasEstimates } from '../../../src/shared/quotaEstimate';
  import { formatCountdown, formatPercentage } from '../lib/formatQuota';
  import { barWidth, hasFiveHourWindow, quotaTone } from '../lib/tier';

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
  }

  let { quota: rawQuota, tierName, compact = false, estimate = false }: Props = $props();

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

  // The Starter tier has a weekly quota only: there is no rolling 5-hour window.
  let showFiveHour = $derived(hasFiveHourWindow(tierName));

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

{#snippet metric(group: string, label: string, pct: number | undefined, reset: string | undefined, sub: boolean, est: boolean)}
  {@const tone = quotaTone(pct)}
  <div class="quota-pair" class:sub-pair={sub}>
    <div class="metric-row">
      <span class="metric-label">{label}</span>
      <span
        class="metric-val"
        class:dash={pct === undefined}
        class:est
        title={est ? 'Estimated: the reset time passed since this was last checked' : undefined}
        >{est ? '~' : ''}{formatPercentage(pct)}</span
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

{#if compact}
  <div class="compact-grid">
    {#each [{ name: 'Gemini', weekly: geminiWeekly, five: gemini5h, est: quota?.gemini?.weekly?.estimated === true }, { name: 'Claude + GPT', weekly: claudeWeekly, five: claude5h, est: quota?.claudeGpt?.weekly?.estimated === true }] as g (g.name)}
      <div class="compact-item" title="{g.name}: weekly {formatPercentage(g.weekly)}{showFiveHour ? `, 5h ${formatPercentage(g.five)}` : ''}">
        <span class="compact-name">{g.name}</span>
        <span class="compact-val">{g.est ? '~' : ''}{formatPercentage(g.weekly)}</span>
        <div class="bar thin" aria-hidden="true">
          <div class="bar-fill tone-{quotaTone(g.weekly)}" style:width="{barWidth(g.weekly)}%"></div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="quota-grid">
    <!-- Gemini -->
    <div class="quota-box">
      <div class="box-title">Gemini</div>
      {@render metric('Gemini', 'Weekly', geminiWeekly, geminiWeeklyReset, false, quota?.gemini?.weekly?.estimated === true)}
      {#if showFiveHour}
        {@render metric('Gemini', '5h', gemini5h, gemini5hReset, true, quota?.gemini?.fiveHour?.estimated === true)}
      {/if}
    </div>

    <!-- Claude + GPT -->
    <div class="quota-box">
      <div class="box-title">Claude + GPT</div>
      {@render metric('Claude and GPT', 'Weekly', claudeWeekly, claudeWeeklyReset, false, quota?.claudeGpt?.weekly?.estimated === true)}
      {#if showFiveHour}
        {@render metric('Claude and GPT', '5h', claude5h, claude5hReset, true, quota?.claudeGpt?.fiveHour?.estimated === true)}
      {/if}
    </div>
  </div>
  {#if !showFiveHour}
    <div class="plan-note">Weekly quota only on this plan</div>
  {/if}
  {#if anyEstimated}
    <div class="plan-note" role="note">
      ~ Estimated: the reset passed since this account was last checked. Switch to it for exact numbers.
    </div>
  {/if}
{/if}

<style>
  .quota-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }

  /* Narrow sidebars: stack the two boxes instead of squeezing them */
  @media (max-width: 320px) {
    .quota-grid {
      grid-template-columns: 1fr;
    }
  }

  .quota-box {
    background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e), #000 20%);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    min-width: 0;
  }

  .box-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-foreground, #e0e0e0);
    letter-spacing: -0.2px;
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

  .tone-good {
    background: var(--vscode-testing-iconPassed, #73c991);
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
