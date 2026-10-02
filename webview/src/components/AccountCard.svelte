<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import QuotaBoxes from './QuotaBoxes.svelte';
  import OverflowMenu from './OverflowMenu.svelte';
  import { maskEmail } from '../lib/maskEmail';
  import { formatCompactAge } from '../lib/formatQuota';
  import { postToHost } from '../lib/vscode';
  import { getMode } from '../stores/app.svelte';

  interface Props {
    account: AccountMeta;
    masked: boolean;
    disabled?: boolean;
  }

  let { account, masked, disabled = false }: Props = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  let displayEmail = $derived(masked ? maskEmail(account.email) : account.email);
  let username = $derived(account.label || account.email.split('@')[0]);
  let tierName = $derived(account.quota?.tierName || account.plan || 'Antigravity Quota');
  let age = $derived(formatCompactAge(account.quota?.updatedAt || account.lastUsedAt || account.addedAt));

  function handleSwitch() {
    if (disabled) return;
    postToHost({ type: 'switch', id: account.id });
  }

  function startRename() {
    renameValue = account.label ?? '';
    renaming = true;
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

  function handleReauth() {
    postToHost({ type: 'reauth', id: account.id });
  }

  function handleTogglePin() {
    postToHost({ type: 'togglePin', id: account.id });
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
    { label: account.pinned ? 'Unpin from Top' : 'Pin to Top', icon: '📌', action: handleTogglePin },
    { label: 'Re-authenticate', icon: '🔄', action: handleReauth },
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
  <!-- Top Profile Row -->
  <div class="card-header">
    <Avatar email={account.email} size={36} />
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
        <div class="name-row">
          <span class="username" title={account.label || username}>{username}</span>
          {#if account.pinned}
            <span class="pin-icon" title="Pinned to top">📌</span>
          {/if}
        </div>
        <div class="email" title={account.email}>{displayEmail}</div>
      {/if}
    </div>

    <!-- Header Actions -->
    <div class="header-actions">
      <button class="icon-btn" onclick={startRename} title="Rename account" aria-label="Rename">
        ✏️
      </button>
      <button class="icon-btn danger" onclick={handleRemove} title="Remove account" aria-label="Remove">
        🗑️
      </button>
      <button
        class="icon-btn"
        onclick={() => (menuOpen = !menuOpen)}
        title="More actions"
        aria-label="More actions"
      >
        ⋮
      </button>
    </div>
  </div>

  <!-- Middle Action & Badges Row -->
  <div class="badges-row">
    <button
      class="switch-btn"
      onclick={handleSwitch}
      {disabled}
      title={disabled ? 'Switching is disabled in unsupported environment' : undefined}
      aria-label="{getMode() === 'profile' ? 'Open window for' : 'Switch to'} {account.email}"
    >
      <span class="switch-icon">⇄</span> {getMode() === 'profile' ? 'Open' : 'Switch'}
    </button>
    <span class="tier-pill" title="Tier: {tierName}">✨ {tierName}</span>
    <span class="time-pill" title="Quota snapshot age">⏱️ {age}</span>
  </div>

  <!-- Quota Cards -->
  <QuotaBoxes quota={account.quota} />

  {#if menuOpen}
    <OverflowMenu items={menuItems} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
  .account-card {
    padding: 12px;
    border-radius: 8px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: background 0.15s, border-color 0.15s;
  }

  .account-card:hover {
    background: var(--vscode-list-hoverBackground, #25282a);
    border-color: var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
  }

  .account-card:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .card-info {
    min-width: 0;
    flex: 1;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .username {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--vscode-foreground, #ffffff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pin-icon {
    font-size: 11px;
  }

  .email {
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground, #9aa0a6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--vscode-descriptionForeground, #9aa0a6);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    color: var(--vscode-foreground, #fff);
  }

  .icon-btn.danger:hover {
    color: var(--vscode-errorForeground, #f14c4c);
  }

  .badges-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .switch-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-foreground, #ffffff);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    line-height: 1.4;
  }

  .switch-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .switch-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .switch-icon {
    font-size: 12px;
    line-height: 1;
  }

  .tier-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 12px;
    background: rgba(204, 167, 0, 0.12);
    border: 1px solid rgba(204, 167, 0, 0.5);
    color: #e5b700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 170px;
  }

  .time-pill {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--vscode-descriptionForeground, #9aa0a6);
    white-space: nowrap;
  }

  .rename-input {
    width: 100%;
    font-size: 12px;
    padding: 2px 6px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, #007fd4);
    border-radius: 3px;
    outline: none;
  }
</style>
