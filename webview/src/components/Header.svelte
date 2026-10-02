<script lang="ts">
  import { postToHost } from '../lib/vscode';
  import OverflowMenu from './OverflowMenu.svelte';
  import Icon from './Icon.svelte';

  let menuOpen = $state(false);

  function handleRefresh() {
    postToHost({ type: 'ready' });
  }

  function handleOpenBackups() {
    postToHost({ type: 'openBackupsFolder' });
  }

  function handleRestoreBackup() {
    postToHost({ type: 'restoreBackup' });
  }

  function handleSettings() {
    postToHost({ type: 'openSettings' });
  }

  let menuItems = [
    { label: 'Open Backups Folder', icon: 'folder' as const, action: handleOpenBackups },
    { label: 'Restore Backup…', icon: 'restore' as const, action: handleRestoreBackup },
    { label: 'Settings', icon: 'settings' as const, action: handleSettings },
  ];
</script>

<header class="header">
  <div class="brand">
    <Icon name="zap" size={15} class="brand-icon" />
    <span class="title">Switchyard</span>
  </div>
  <div class="actions">
    <button
      class="icon-btn"
      onclick={handleRefresh}
      aria-label="Refresh accounts"
      title="Refresh"
    >
      <Icon name="refresh" size={14} />
    </button>
    <button
      class="icon-btn"
      onclick={() => (menuOpen = !menuOpen)}
      aria-label="More options"
      title="More options"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
    >
      <Icon name="dots" size={14} />
    </button>
  </div>

  {#if menuOpen}
    <OverflowMenu items={menuItems} onclose={() => (menuOpen = false)} />
  {/if}
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
