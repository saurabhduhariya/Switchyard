<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import QuotaBoxes from './QuotaBoxes.svelte';
  import QuotaErrorNotice from './QuotaErrorNotice.svelte';
  import OverflowMenu, { type MenuItem } from './OverflowMenu.svelte';
  import Icon from './Icon.svelte';
  import { accountDisplayName } from '../../../src/shared/accountName';
  import { formatCompactAge } from '../lib/formatQuota';
  import { postToHost } from '../lib/vscode';
  import { getMode, getQuotaError, getTrend, isRefreshing, startRefresh } from '../stores/app.svelte';
  import { shortTierName } from '../lib/tier';
  import { shouldEstimate } from '../../../src/shared/quotaEstimate';

  interface Props {
    account: AccountMeta;
    /** Leave the email address off the card entirely. */
    hideEmail: boolean;
  }

  let { account, hideEmail }: Props = $props();

  let menuOpen = $state(false);
  let menuBtn: HTMLButtonElement | undefined = $state();
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  let username = $derived(accountDisplayName(account, hideEmail));
  let tierName = $derived(account.plan || account.quota?.tierName || 'Antigravity Quota');
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
    if (isRefreshing()) return;
    startRefresh();
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

  // Profile-folder actions only exist in profile mode; token swap has no per-account folder.
  let menuItems = $derived<MenuItem[]>([
    { label: 'Refresh quota', icon: 'refresh', action: handleRefresh },
    { label: 'Rename', icon: 'edit', action: startRename },
    { label: account.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', action: handleTogglePin },
    ...(getMode() === 'profile'
      ? ([
          { label: 'Reveal profile folder', icon: 'folder', separator: true, action: handleReveal },
          { label: 'Copy settings into profile', icon: 'copy', action: handleCopySettings },
        ] satisfies MenuItem[])
      : []),
    { label: 'Sign in again…', icon: 'login', separator: true, action: handleReauth },
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
            <span class="pin-icon" title="Pinned to top">
              <Icon name="pin" size={11} />
            </span>
          {/if}
        </div>
        {#if !hideEmail}
          <div class="email" title={account.email}>{account.email}</div>
        {/if}
        <div class="meta">
          <span class="sr-only">Active account.</span>
          {#if getMode() === 'profile'}
            <span>This window</span>
            <span class="sep" aria-hidden="true">·</span>
          {/if}
          <span class="meta-item" title="Tier: {tierName}">{shortTierName(tierName)}</span>
          <span class="sep" aria-hidden="true">·</span>
          <span class="meta-item" title="Last updated">{age}</span>
        </div>
      {/if}
    </div>

    <!-- Rename and Refresh show on hover/focus; both are also in the ⋮ menu. -->
    <div class="header-actions">
      <button class="icon-btn reveal" onclick={startRename} title="Rename account" aria-label="Rename">
        <Icon name="edit" size={13} />
      </button>
      <button
        class="icon-btn reveal"
        class:busy={isRefreshing()}
        onclick={handleRefresh}
        title={isRefreshing() ? 'Refreshing…' : 'Refresh quota'}
        aria-label={isRefreshing() ? 'Refreshing quota' : 'Refresh quota'}
        aria-busy={isRefreshing()}
      >
        <span class="spin-box" class:spinning={isRefreshing()}><Icon name="refresh" size={13} /></span>
      </button>
      <button
        class="icon-btn"
        bind:this={menuBtn}
        onclick={() => (menuOpen = !menuOpen)}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Icon name="dots" size={14} />
      </button>
    </div>
  </div>

  <!-- Quota Cards -->
  {#if getQuotaError() && getQuotaError()!.accountId === account.id}
    <QuotaErrorNotice error={getQuotaError()!} hasQuota={!!account.quota} onretry={handleRefresh} />
  {/if}
  {#if account.quota || !getQuotaError()}
    <QuotaBoxes
      quota={account.quota}
      {tierName}
      estimate={shouldEstimate(account.quota, true)}
      trend={getTrend(account.id)}
      emptyText="Loading quota…"
    />
  {/if}

  {#if menuOpen && menuBtn}
    <OverflowMenu items={menuItems} anchor={menuBtn} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
  /* "Active" is shown once: the green left bar (plus the avatar's dot). */
  .active-card {
    container-type: inline-size;
    padding: 12px;
    border-radius: 8px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    border-left: 3px solid var(--vscode-testing-iconPassed, #4ec9b0);
    position: relative;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    min-width: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #9aa0a6);
    white-space: nowrap;
    overflow: hidden;
  }

  .meta-item {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sep {
    opacity: 0.6;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* Secondary icons appear on hover or keyboard focus; hidden on narrow cards. */
  .icon-btn.reveal {
    display: none;
  }

  .active-card:hover .icon-btn.reveal,
  .active-card:focus-within .icon-btn.reveal,
  .icon-btn.reveal.busy {
    display: flex;
  }

  @container (max-width: 260px) {
    .active-card:hover .icon-btn.reveal,
    .active-card:focus-within .icon-btn.reveal {
      display: none;
    }
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
