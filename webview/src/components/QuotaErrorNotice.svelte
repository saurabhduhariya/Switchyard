<script lang="ts">
  import type { QuotaErrorState } from '../../../src/shared/messages';
  import Icon from './Icon.svelte';

  interface Props {
    error: QuotaErrorState;
    /** Whether older numbers are still shown below this notice. */
    hasQuota: boolean;
    onretry: () => void;
  }

  let { error, hasQuota, onretry }: Props = $props();

  // Give instant feedback; the next state update replaces this notice (or the numbers) anyway.
  let retrying = $state(false);

  function retry() {
    if (retrying) return;
    retrying = true;
    onretry();
    setTimeout(() => (retrying = false), 2000);
  }
</script>

<div class="quota-error" role="alert">
  <div class="head">
    <Icon name="warning-clock" size={12} class="err-icon" />
    <span class="title">Could not load quota</span>
  </div>
  <p class="message">{error.message}</p>
  {#if hasQuota}
    <p class="hint">Showing the last numbers that were read.</p>
  {/if}
  <button class="retry" onclick={retry} disabled={retrying} aria-label="Retry loading quota">
    {retrying ? 'Retrying…' : 'Retry'}
  </button>
</div>

<style>
  .quota-error {
    margin-top: 10px;
    border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 55%);
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 92%);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-editorWarning-foreground, #cca700);
    font-size: 11px;
    font-weight: 700;
  }

  .message,
  .hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--vscode-foreground, #ccc);
  }

  .hint {
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }

  .retry {
    align-self: flex-start;
    margin-top: 2px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 4px;
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, #fff));
    border: 1px solid var(--vscode-button-border, rgba(255, 255, 255, 0.14));
  }

  .retry:hover:not(:disabled) {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .retry:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .retry:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
</style>
