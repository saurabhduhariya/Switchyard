<script lang="ts">
  import { clearToast } from '../stores/app.svelte';
  import { postToHost } from '../lib/vscode';
  import Icon from './Icon.svelte';

  interface Props {
    message: string;
    accountId?: string;
  }

  let { message, accountId }: Props = $props();
  let visible = $state(true);

  function handleSave() {
    if (accountId) {
      postToHost({ type: 'saveDetected', id: accountId });
    }
    // Clear the toast locally — do NOT send dismissToast to the host
    // because that would clear pendingSnapshot before handleSaveDetected runs
    visible = false;
    setTimeout(() => clearToast(), 200);
  }

  function dismiss() {
    postToHost({ type: 'dismissToast' });
    visible = false;
    setTimeout(() => clearToast(), 200);
  }
</script>

{#if visible}
  <div class="toast" role="status" aria-live="polite">
    <span class="toast-icon" aria-hidden="true">
      <Icon name="bell" size={14} />
    </span>
    <span class="toast-text">{message}</span>
    <div class="toast-actions">
      {#if accountId}
        <button class="toast-btn save" onclick={handleSave}>Save</button>
      {/if}
      <button class="toast-btn dismiss" onclick={dismiss}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--vscode-editorInfo-background, color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 85%));
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 60%);
    animation: toastIn 0.25s ease-out;
  }

  .toast-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .toast-text {
    flex: 1;
    font-size: 11.5px;
    color: var(--vscode-foreground, #ccc);
    line-height: 1.4;
  }

  .toast-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .toast-btn {
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    padding: 3px 8px;
  }

  .toast-btn.save {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .toast-btn.save:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .toast-btn.dismiss {
    background: transparent;
    color: var(--vscode-descriptionForeground, #888);
  }

  .toast-btn.dismiss:hover {
    color: var(--vscode-foreground, #ccc);
  }

  .toast-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
