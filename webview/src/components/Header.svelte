<script lang="ts">
  import { postToHost } from '../lib/vscode';

  function handleRefresh() {
    postToHost({ type: 'ready' });
  }

  function handleSettings() {
    postToHost({ type: 'openSettings' });
  }
</script>

<header class="header">
  <div class="brand">
    <span class="logo" aria-hidden="true">⚡</span>
    <span class="title">Switchyard</span>
  </div>
  <div class="actions">
    <button
      class="icon-btn"
      onclick={handleRefresh}
      aria-label="Refresh accounts"
      title="Refresh"
    >
      ↻
    </button>
    <button
      class="icon-btn"
      onclick={handleSettings}
      aria-label="Settings"
      title="Settings"
    >
      ⚙
    </button>
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .logo {
    font-size: 14px;
  }

  .title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--vscode-foreground, #ccc);
    opacity: 0.85;
  }

  .actions {
    display: flex;
    gap: 2px;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--vscode-foreground, #ccc);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.12s, background 0.12s;
  }

  .icon-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
  }

  .icon-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-btn {
      transition: none;
    }
  }
</style>
