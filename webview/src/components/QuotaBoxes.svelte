<script lang="ts">
  import type { AccountQuotaSummary, QuotaBucket } from '../../../src/shared/messages';
  import { formatCountdown, formatPercentage } from '../lib/formatQuota';

  interface Props {
    quota?: AccountQuotaSummary;
  }

  let { quota }: Props = $props();

  // Tick every 30s to update countdowns live
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  });

  function getBucketPercent(bucket?: QuotaBucket, fallbackNum?: number): string {
    if (bucket) {
      if (bucket.disabled) return '-';
      if (bucket.remainingPercent !== undefined) {
        return formatPercentage(bucket.remainingPercent);
      }
      if (bucket.remainingFraction !== undefined) {
        return formatPercentage(Math.round(bucket.remainingFraction * 10000) / 100);
      }
    }
    return fallbackNum !== undefined ? formatPercentage(fallbackNum) : '-';
  }

  function getBucketCountdown(bucket?: QuotaBucket, fallbackReset?: string): string | undefined {
    if (bucket?.disabled) return undefined;
    const resetTime = bucket?.resetTime || fallbackReset;
    if (!resetTime) return undefined;
    return formatCountdown(resetTime);
  }

  // Gemini derivations
  let geminiWeeklyPercent = $derived(
    getBucketPercent(quota?.gemini?.weekly, quota?.gemini?.weeklyRemaining)
  );
  let geminiWeeklyCountdown = $derived(
    getBucketCountdown(quota?.gemini?.weekly, quota?.gemini?.weeklyResetTime) || 'Resets in -'
  );

  let gemini5hPercent = $derived(
    getBucketPercent(quota?.gemini?.fiveHour, quota?.gemini?.rolling5hRemaining)
  );
  let gemini5hCountdown = $derived(
    getBucketCountdown(quota?.gemini?.fiveHour, quota?.gemini?.rolling5hResetTime)
  );

  // Claude + GPT derivations
  let claudeWeeklyPercent = $derived(
    getBucketPercent(quota?.claudeGpt?.weekly, quota?.claudeGpt?.weeklyRemaining)
  );
  let claudeWeeklyCountdown = $derived(
    getBucketCountdown(quota?.claudeGpt?.weekly, quota?.claudeGpt?.weeklyResetTime) || 'Resets in -'
  );

  let claude5hPercent = $derived(
    getBucketPercent(quota?.claudeGpt?.fiveHour, quota?.claudeGpt?.rolling5hRemaining)
  );
  let claude5hCountdown = $derived(
    getBucketCountdown(quota?.claudeGpt?.fiveHour, quota?.claudeGpt?.rolling5hResetTime)
  );
</script>

<div class="quota-grid">
  <!-- Gemini Box -->
  <div class="quota-box">
    <div class="box-title">Gemini</div>
    
    <div class="quota-pair">
      <div class="metric-row">
        <span class="metric-label">Weekly</span>
        <span class="metric-val">{geminiWeeklyPercent}</span>
      </div>
      <div class="reset-row">{geminiWeeklyCountdown}</div>
    </div>

    <div class="quota-pair sub-pair">
      <div class="metric-row">
        <span class="metric-label">5h</span>
        <span class="metric-val" class:dash={gemini5hPercent === '-'}>{gemini5hPercent}</span>
      </div>
      {#if gemini5hCountdown}
        <div class="reset-row">{gemini5hCountdown}</div>
      {/if}
    </div>
  </div>

  <!-- Claude + GPT Box -->
  <div class="quota-box">
    <div class="box-title">Claude + GPT</div>
    
    <div class="quota-pair">
      <div class="metric-row">
        <span class="metric-label">Weekly</span>
        <span class="metric-val">{claudeWeeklyPercent}</span>
      </div>
      <div class="reset-row">{claudeWeeklyCountdown}</div>
    </div>

    <div class="quota-pair sub-pair">
      <div class="metric-row">
        <span class="metric-label">5h</span>
        <span class="metric-val" class:dash={claude5hPercent === '-'}>{claude5hPercent}</span>
      </div>
      {#if claude5hCountdown}
        <div class="reset-row">{claude5hCountdown}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .quota-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }

  .quota-box {
    background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e), #000 20%);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    gap: 2px;
  }

  .sub-pair {
    margin-top: 2px;
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

  .metric-val.dash {
    color: var(--vscode-descriptionForeground, #8c8c8c);
    font-weight: 500;
  }

  .reset-row {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
