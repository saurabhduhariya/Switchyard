<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import QuotaBoxes from './QuotaBoxes.svelte';
  import OverflowMenu from './OverflowMenu.svelte';
  import Icon from './Icon.svelte';
  import { accountDisplayName } from '../../../src/shared/accountName';
  import { formatCompactAge } from '../lib/formatQuota';
  import { postToHost } from '../lib/vscode';
  import { getMode, getTrend, isCompactView } from '../stores/app.svelte';
  import { isStale, shortTierName } from '../lib/tier';

  interface Props {
    account: AccountMeta;
    /** Leave the email address off the card entirely. */
    hideEmail: boolean;
    disabled?: boolean;
  }

  let { account, hideEmail, disabled = false }: Props = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  let username = $derived(accountDisplayName(account, hideEmail));
  // Spoken name for the card and Switch button; never the email when it is hidden.
  let spokenName = $derived(hideEmail ? username : account.email);
  let tierName = $derived(account.plan || account.quota?.tierName || 'Antigravity Quota');
  let age = $derived(formatCompactAge(account.quota?.updatedAt || account.lastUsedAt || account.addedAt));
  // Accounts that are not signed in are not refreshed live, so old numbers may be wrong.
  let stale = $derived(isStale(account.quota?.updatedAt));

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
    { label: account.pinned ? 'Unpin from Top' : 'Pin to Top', icon: 'pin' as const, action: handleTogglePin },
    { label: 'Re-authenticate', icon: 'refresh' as const, action: handleReauth },
    { label: 'Rename', icon: 'edit' as const, action: startRename },
    { label: 'Reveal Profile Folder', icon: 'folder' as const, action: handleReveal },
    { label: 'Copy Settings into Profile', icon: 'copy' as const, action: handleCopySettings },
    { label: 'Remove', icon: 'trash' as const, danger: true, action: handleRemove },
  ]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="account-card"
  role="listitem"
  tabindex="0"
  onkeydown={handleCardKeydown}
  aria-label="{getMode() === 'profile' ? 'Open window for' : 'Switch to'} {spokenName}"
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
            <span class="pin-icon" title="Pinned to top">
              <Icon name="pin" size={11} />
            </span>
          {/if}
        </div>
        {#if !hideEmail}
          <div class="email" title={account.email}>{account.email}</div>
        {/if}
        <div class="meta">
          <span class="meta-item" title="Tier: {tierName}">{shortTierName(tierName)}</span>
          <span class="sep" aria-hidden="true">·</span>
          <span
            class="meta-item age"
            class:stale
            title={stale
              ? `Quota checked ${age}. It may be out of date; switch to this account to refresh it.`
              : `Quota checked ${age}`}
          >
            {#if stale}<Icon name="warning-clock" size={10} />{/if}
            <span>{age}</span>
          </span>
        </div>
      {/if}
    </div>

    <!-- Rename and Remove show on hover/focus; both are also in the ⋮ menu. -->
    <div class="header-actions">
      <button class="icon-btn reveal" onclick={startRename} title="Rename account" aria-label="Rename">
        <Icon name="edit" size={13} />
      </button>
      <button class="icon-btn reveal danger" onclick={handleRemove} title="Remove account" aria-label="Remove">
        <Icon name="trash" size={13} />
      </button>
      <button
        class="icon-btn"
        onclick={() => (menuOpen = !menuOpen)}
        title="More actions"
        aria-label="More actions"
      >
        <Icon name="dots" size={14} />
      </button>
      <button
        class="switch-btn"
        onclick={handleSwitch}
        {disabled}
        title={disabled ? 'Switching is disabled in unsupported environment' : undefined}
        aria-label="{getMode() === 'profile' ? 'Open window for' : 'Switch to'} {spokenName}"
      >
        <Icon name="switch" size={12} class="switch-icon" />
        <span>{getMode() === 'profile' ? 'Open' : 'Switch'}</span>
      </button>
    </div>
  </div>

  <!-- Quota Cards -->
  <QuotaBoxes
    quota={account.quota}
    {tierName}
    compact={isCompactView()}
    estimate={true}
    trend={getTrend(account.id)}
    emptyText="No quota yet. Switch to this account to load it."
  />

  {#if menuOpen}
    <OverflowMenu items={menuItems} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
  .account-card {
    container-type: inline-size;
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

  /* When space is short the tier name shortens with "…"; the age stays whole. */
  .age {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .meta-item:first-child {
    min-width: 0;
  }

  .age.stale {
    color: var(--vscode-editorWarning-foreground, #cca700);
  }

  .sep {
    opacity: 0.6;
  }

  /* Secondary icons appear on hover or keyboard focus; hidden on narrow cards. */
  .icon-btn.reveal {
    display: none;
  }

  .account-card:hover .icon-btn.reveal,
  .account-card:focus-within .icon-btn.reveal {
    display: flex;
  }

  @container (max-width: 300px) {
    .account-card:hover .icon-btn.reveal,
    .account-card:focus-within .icon-btn.reveal {
      display: none;
    }
  }

  .switch-btn {
    flex-shrink: 0;
    margin-left: 2px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--vscode-button-border, rgba(255, 255, 255, 0.14));
    border-radius: 4px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, #ffffff));
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    line-height: 1.5;
  }

  .switch-btn:hover:not(:disabled) {
    background: var(--vscode-button-background, #0e639c);
    border-color: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
  }

  .switch-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
