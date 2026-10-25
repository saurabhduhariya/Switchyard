<script lang="ts">
  import type { AccountMeta, SwitchSuggestion } from '../../../src/shared/messages';
  import { accountDisplayName } from '../../../src/shared/quotaRules';
  import { postToHost } from '../lib/vscode';
  import Icon from './Icon.svelte';

  interface Props {
    suggestion: SwitchSuggestion;
    /** The account being suggested. */
    target: AccountMeta;
    disabled?: boolean;
  }

  let { suggestion, target, disabled = false }: Props = $props();

  let name = $derived(accountDisplayName(target));

  function handleSwitch() {
    if (disabled) return;
    postToHost({ type: 'switch', id: target.id });
  }

  function handleDismiss() {
    postToHost({ type: 'dismissSuggestion', key: suggestion.key });
  }
</script>

<div class="suggest" role="status" aria-live="polite">
  <div class="suggest-head">
    <Icon name="sparkle" size={12} class="suggest-icon" />
    <span class="suggest-title">Running low</span>
  </div>
  <p class="suggest-text">
    <strong>{suggestion.lowText}</strong> on the active account.
    <strong>{name}</strong> has
    <span
      class="better"
      title={suggestion.estimated
        ? 'Estimated: its reset time passed since it was last checked'
        : undefined}>{suggestion.betterText}</span
    >.
  </p>
  <div class="suggest-actions">
    <button
      class="btn primary"
      onclick={handleSwitch}
      {disabled}
      aria-label="Switch to {name}"
    >
      Switch to {name}
    </button>
    <button class="btn ghost" onclick={handleDismiss} aria-label="Not now">Not now</button>
  </div>
</div>

<style>
  .suggest {
    border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 55%);
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 92%);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .suggest-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-editorWarning-foreground, #cca700);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .suggest-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--vscode-foreground, #ccc);
  }

  .better {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .suggest-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }

  .btn {
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    line-height: 1.5;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn.primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
    border: 1px solid var(--vscode-button-background, #0e639c);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .btn.ghost {
    background: transparent;
    color: var(--vscode-descriptionForeground, #9aa0a6);
    border: 1px solid transparent;
  }

  .btn.ghost:hover {
    color: var(--vscode-foreground, #ffffff);
    border-color: var(--vscode-widget-border, rgba(255, 255, 255, 0.14));
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
</style>
