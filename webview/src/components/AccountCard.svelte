<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import OverflowMenu from './OverflowMenu.svelte';
  import { maskEmail } from '../lib/maskEmail';
  import { timeAgo } from '../lib/timeAgo';
  import { postToHost } from '../lib/vscode';
  import { getMode } from '../stores/app.svelte';

  interface Props {
    account: AccountMeta;
    masked: boolean;
  }

  let { account, masked }: Props = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  let displayEmail = $derived(masked ? maskEmail(account.email) : account.email);
  let lastUsed = $derived(timeAgo(account.lastUsedAt));

  function handleSwitch() {
    postToHost({ type: 'switch', id: account.id });
  }

  function startRename() {
    renameValue = account.label ?? '';
    renaming = true;
    // Focus will be handled by the $effect below
  }

  $effect(() => {
    if (renaming && renameInput) {
      renameInput.focus();
    }
  });

  function submitRename() {
    const val = renameValue.trim();
    postToHost({ type: 'rename', id: account.id, label: val });
    renaming = false;
  }

  function cancelRename() {
    renaming = false;
  }

  function handleRemove() {
    postToHost({ type: 'remove', id: account.id });
  }

  function handleReveal() {
    postToHost({ type: 'revealProfile', id: account.id });
  }

  function handleCopySettings() {
    postToHost({ type: 'copySettings', id: account.id });
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitRename();
    if (e.key === 'Escape') cancelRename();
  }

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSwitch();
    }
    if (e.key === 'F2') {
      e.preventDefault();
      startRename();
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      handleRemove();
    }
  }

  let menuItems = $derived([
    { label: 'Rename', icon: '✏️', action: startRename },
    { label: 'Reveal Profile Folder', icon: '📂', action: handleReveal },
    { label: 'Copy Settings into Profile', icon: '📋', action: handleCopySettings },
    { label: 'Remove', icon: '🗑️', danger: true, action: handleRemove },
  ]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="account-card"
  role="listitem"
  tabindex="0"
  onkeydown={handleCardKeydown}
  aria-label="{getMode() === 'profile' ? 'Open window for' : 'Switch to'} {account.email}"
>
  <div class="card-body">
    <Avatar email={account.email} size={32} />
    <div class="card-info">
      {#if renaming}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename-input"
          type="text"
          bind:value={renameValue}
          bind:this={renameInput}
          onkeydown={handleRenameKeydown}
          onblur={cancelRename}
          placeholder="Label (e.g. Work)"
        />
      {:else}
        <div class="email-row">
          <span class="email" title={account.email}>{displayEmail}</span>
          {#if account.label}
            <span class="label-chip">{account.label}</span>
          {/if}
        </div>
        <span class="last-used">{lastUsed}</span>
      {/if}
    </div>

    <div class="card-actions">
      <button
        class="btn switch-btn"
        onclick={handleSwitch}
        aria-label="{getMode() === 'profile' ? 'Open window for' : 'Switch to'} {account.email}"
      >
        {getMode() === 'profile' ? 'Open' : 'Switch'}
      </button>
      <button
        class="btn icon-btn"
        onclick={() => (menuOpen = !menuOpen)}
        aria-label="More actions for {account.email}"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        ⋮
      </button>
    </div>
  </div>

  {#if menuOpen}
    <OverflowMenu items={menuItems} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
  .account-card {
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--vscode-editor-background, #252526);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    position: relative;
    transition: background 0.15s, border-color 0.15s;
  }

  .account-card:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    border-color: var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
  }

  .account-card:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }

  .card-body {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .card-info {
    flex: 1;
    min-width: 0;
  }

  .email-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .email {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-foreground, #ccc);
  }

  .label-chip {
    font-size: 9.5px;
    padding: 1px 5px;
    border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    flex-shrink: 0;
  }

  .last-used {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #888);
    margin-top: 2px;
    display: block;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .account-card:hover .card-actions,
  .account-card:focus-within .card-actions {
    opacity: 1;
  }

  .btn {
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    padding: 4px 10px;
    transition: background 0.12s;
  }

  .switch-btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .switch-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .icon-btn {
    background: transparent;
    color: var(--vscode-foreground, #ccc);
    font-size: 16px;
    padding: 2px 6px;
    line-height: 1;
  }

  .icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
  }

  .rename-input {
    width: 100%;
    padding: 3px 6px;
    border: 1px solid var(--vscode-inputBorder, #3c3c3c);
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .rename-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  @media (prefers-reduced-motion: reduce) {
    .account-card,
    .card-actions {
      transition: none;
    }
  }
</style>
