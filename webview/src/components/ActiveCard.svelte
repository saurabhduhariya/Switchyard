<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import QuotaBoxes from './QuotaBoxes.svelte';
  import QuotaErrorNotice from './QuotaErrorNotice.svelte';
  import OverflowMenu, { type MenuItem } from './OverflowMenu.svelte';
  import Icon from './Icon.svelte';
  import { accountDisplayName } from '../../../src/shared/accountName';
  import {
    formatDelayShort,
    formatPacingBucketLabel,
    formatPacingBucketShort,
    formatTteShort,
  } from '../../../src/shared/formatQuota';
  import { formatCompactAge } from '../lib/formatQuota';
  import { postToHost } from '../lib/vscode';
  import {
    getMode,
    getPacing,
    getQuotaError,
    getStatusBarMode,
    getTrend,
    isRefreshing,
    startRefresh,
  } from '../stores/app.svelte';
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
  let pacing = $derived(getPacing());
  let pacingExpanded = $state(false);
  let statusBarMode = $derived(getStatusBarMode());

  let pacingSummary = $derived.by(() => {
    if (!pacing) return undefined;
    const rateNum =
      pacing.burnRatePerHour >= 10 || Number.isInteger(pacing.burnRatePerHour)
        ? Math.round(pacing.burnRatePerHour)
        : pacing.burnRatePerHour.toFixed(1);
    const rate = `−${rateNum}%/h`;
    const tte = formatTteShort(pacing.tteMinutes);
    const delay = formatDelayShort(pacing.recommendedDelaySec);
    const ttr = pacing.ttrMinutes !== null ? formatTteShort(pacing.ttrMinutes, false) : undefined;
    const bucket = formatPacingBucketLabel(pacing.bucket);
    const bucketShort = formatPacingBucketShort(pacing.bucket);

    const tail = delay
      ? pacing.safety === 'critical'
        ? `slow down (${delay})`
        : `ease pace (${delay})`
      : pacing.safety === 'sustainable'
        ? 'safe until reset'
        : ttr
          ? `resets ${ttr.replace(/^~/, '')}`
          : undefined;

    const tooltipParts = [`At ${rate}, ${bucket} quota`];
    if (tte) tooltipParts.push(`runs out in ${tte.replace(/\s+left$/, '')}`);
    if (ttr) tooltipParts.push(`(resets in ${ttr.replace(/^~/, '')})`);
    if (delay) tooltipParts.push(`— pausing ${delay} between prompts helps it last until reset.`);
    else if (pacing.safety === 'sustainable') tooltipParts.push('— current pace will last until reset.');

    return {
      bucket,
      bucketShort,
      rate,
      tte,
      tail,
      safety: pacing.safety,
      tooltip: tooltipParts.join(' '),
    };
  });

  function toggleBurnRateStatusBar() {
    const next = statusBarMode === 'burnRate' ? 'quota' : 'burnRate';
    postToHost({ type: 'updateSetting', key: 'statusBarMode', value: next });
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

  {#if pacingSummary}
    <div class="pacing-box safety-{pacingSummary.safety}" class:expanded={pacingExpanded}>
      <button
        type="button"
        class="pacing-strip"
        onclick={() => (pacingExpanded = !pacingExpanded)}
        aria-expanded={pacingExpanded}
        title={pacingSummary.tooltip}
      >
        <Icon name={pacingSummary.safety === 'critical' ? 'warning-clock' : 'zap'} size={12} class="pacing-icon" />
        <span class="pacing-bucket pacing-bucket-full">{pacingSummary.bucket}:</span>
        <span class="pacing-bucket pacing-bucket-short">{pacingSummary.bucketShort}:</span>
        <span class="pacing-rate">{pacingSummary.rate}</span>
        {#if pacingSummary.tte}
          <span class="pacing-tte"><span class="sep" aria-hidden="true">·</span> {pacingSummary.tte}</span>
        {/if}
        {#if pacingSummary.tail}
          <span class="pacing-tail"><span class="sep" aria-hidden="true">·</span> {pacingSummary.tail}</span>
        {/if}
        <span class="pacing-caret" aria-hidden="true">{pacingExpanded ? '▾' : '▸'}</span>
      </button>

      {#if pacingExpanded}
        <div class="pacing-details">
          <p class="pacing-explain">{pacingSummary.tooltip}</p>
          <button type="button" class="pacing-action" onclick={toggleBurnRateStatusBar}>
            {statusBarMode === 'burnRate' ? 'Showing burn rate in status bar ✓' : 'Show burn rate in status bar'}
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if menuOpen && menuBtn}
    <OverflowMenu items={menuItems} anchor={menuBtn} onclose={() => (menuOpen = false)} />
  {/if}
</div>

<style>
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

  .pacing-box {
    margin-top: 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    background: color-mix(in srgb, var(--vscode-foreground, #ccc), transparent 95%);
    color: var(--vscode-descriptionForeground, #9aa0a6);
    overflow: hidden;
  }

  .pacing-box.safety-elevated {
    color: var(--vscode-editorWarning-foreground, #cca700);
    border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 65%);
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700), transparent 92%);
  }

  .pacing-box.safety-critical {
    color: var(--vscode-errorForeground, #f48771);
    border-color: color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 60%);
    background: color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 90%);
  }

  .pacing-strip {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pacing-strip:hover {
    background: color-mix(in srgb, currentColor, transparent 92%);
  }

  .pacing-strip :global(.pacing-icon) {
    flex-shrink: 0;
  }

  .pacing-bucket {
    font-weight: 600;
  }

  .pacing-bucket-short {
    display: none;
  }

  .pacing-caret {
    margin-left: auto;
    font-size: 10px;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .pacing-details {
    padding: 4px 8px 7px;
    border-top: 1px solid color-mix(in srgb, currentColor, transparent 82%);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .pacing-explain {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--vscode-foreground, #e0e0e0);
    opacity: 0.9;
  }

  .pacing-action {
    align-self: flex-start;
    padding: 2px 6px;
    font-size: 10.5px;
    font-family: inherit;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 65%);
    border-radius: 3px;
    cursor: pointer;
  }

  .pacing-action:hover {
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 88%);
  }

  @container (max-width: 390px) {
    .pacing-bucket-full,
    .pacing-tail {
      display: none;
    }
    .pacing-bucket-short {
      display: inline;
    }
  }

  @container (max-width: 245px) {
    .pacing-bucket-short {
      display: none;
    }
  }

  @container (max-width: 175px) {
    .pacing-tte {
      display: none;
    }
  }
</style>
