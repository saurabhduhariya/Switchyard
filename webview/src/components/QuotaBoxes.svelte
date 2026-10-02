<script lang="ts">
  import type { AccountQuotaSummary } from '../../../src/shared/messages';
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

  // Calculate live values
  let geminiCountdown = $derived(
    quota?.gemini?.weeklyResetTime ? formatCountdown(quota.gemini.weeklyResetTime) : 'Resets in -'
  );

  let claudeGptCountdown = $derived(
    quota?.claudeGpt?.weeklyResetTime ? formatCountdown(quota.claudeGpt.weeklyResetTime) : 'Resets in -'
  );

  let geminiPercent = $derived(
    quota?.gemini?.weeklyRemaining !== undefined ? formatPercentage(quota.gemini.weeklyRemaining) : '-'
  );

  let claudeGptPercent = $derived(
    quota?.claudeGpt?.weeklyRemaining !== undefined ? formatPercentage(quota.claudeGpt.weeklyRemaining) : '0%'
  );
</script>

<div class="quota-grid">
  <!-- Gemini Box -->
  <div class="quota-box">
    <div class="box-title">Gemini</div>
    <div class="metric-row">
      <span class="metric-label">Weekly</span>
      <span class="metric-val">{geminiPercent}</span>
    </div>
    <div class="reset-row">{geminiCountdown}</div>
    <div class="sub-metric">5h <span class="dash">-</span></div>
  </div>

  <!-- Claude + GPT Box -->
  <div class="quota-box">
    <div class="box-title">Claude + GPT</div>
    <div class="metric-row">
      <span class="metric-label">Weekly</span>
      <span class="metric-val">{claudeGptPercent}</span>
    </div>
    <div class="reset-row">{claudeGptCountdown}</div>
    <div class="sub-metric">5h <span class="dash">-</span></div>
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
    gap: 4px;
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

  .metric-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 2px;
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

  .reset-row {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub-metric {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #8c8c8c);
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }

  .dash {
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }
</style>
