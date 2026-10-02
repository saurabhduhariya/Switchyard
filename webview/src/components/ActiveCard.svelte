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
  }

  let { account, masked }: Props = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  let displayEmail = $derived(masked ? maskEmail(account.email) : account.email);
  let username = $derived(account.label || account.email.split('@')[0]);
  let tierName = $derived(account.quota?.tierName || account.plan || 'Antigravity Quota');
  let age = $derived(account.quota ? formatCompactAge(account.quota.updatedAt, true) : 'Live');

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

  function handleRefresh() {
    postToHost({ type: 'refreshQuota', accountId: account.id });
  }

  function handleTogglePin() {
    postToHost({ type: 'togglePin', id: account.id });
  }

  function handleReauth() {
    postToHost({ type: 'reauth', id: account.id });
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

  let menuItems = $derived([
    { label: 'Refresh Quota', icon: '⟳', action: handleRefresh },
    { label: account.pinned ? 'Unpin from Top' : 'Pin to Top', icon: '📌', action: handleTogglePin },
    { label: 'Re-authenticate', icon: '🔄', action: handleReauth },
    { label: 'Rename', icon: '✏️', action: startRename },
    { label: 'Reveal Profile Folder', icon: '📂', action: handleReveal },
    { label: 'Copy Settings into Profile', icon: '📋', action: handleCopySettings },
  ]);
</script>

<div class="active-card" aria-current="true" role="listitem">
  <!-- Top Profile Row -->
  <div class="card-header">
    <Avatar email={account.email} size={36} active={true} />
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
      <button class="icon-btn" onclick={handleRefresh} title="Refresh quota" aria-label="Refresh quota">
        ⟳
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
    <span class="active-badge">{getMode() === 'profile' ? 'THIS WINDOW' : 'ACTIVE'}</span>
    <span class="tier-pill" title="Tier: {tierName}">✨ {tierName}</span>
    <span class="time-pill" title="Last updated">⏱️ {age}</span>
  </div>

  <!-- Quota Cards -->
  <QuotaBoxes quota={account.quota} />

  {#if menuOpen}
    <OverflowMenu items={menuItems} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
  .active-card {
    padding: 12px;
    border-radius: 8px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-testing-iconPassed, #4ec9b0);
    border-left: 3px solid var(--vscode-testing-iconPassed, #4ec9b0);
    position: relative;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
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

  .badges-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .active-badge {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--vscode-testing-iconPassed, #4ec9b0);
    color: #000;
    line-height: 1.3;
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
