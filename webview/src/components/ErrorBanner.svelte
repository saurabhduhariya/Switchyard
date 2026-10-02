<script lang="ts">
  import { clearError } from '../stores/app.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div class="error-banner" role="alert">
  <span class="error-icon" aria-hidden="true">
    <Icon name="alert" size={14} />
  </span>
  <span class="error-text">{message}</span>
  <button class="dismiss-btn" onclick={clearError} aria-label="Dismiss error">
    <Icon name="close" size={12} />
  </button>
</div>

<style>
  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 88%);
    border: 1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 60%);
    animation: slideIn 0.2s ease-out;
  }

  .error-icon {
    font-size: 14px;
    flex-shrink: 0;
    color: var(--vscode-errorForeground, #f48771);
  }

  .error-text {
    flex: 1;
    font-size: 11.5px;
    color: var(--vscode-foreground, #ccc);
    line-height: 1.4;
  }

  .dismiss-btn {
    border: none;
    background: none;
    color: var(--vscode-foreground, #ccc);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12px;
    border-radius: 3px;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.12s;
  }

  .dismiss-btn:hover {
    opacity: 1;
  }

  .dismiss-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .error-banner {
      animation: none;
    }
  }
</style>
