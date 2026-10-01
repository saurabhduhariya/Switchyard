<script lang="ts">
  import type { AccountMeta } from '../../../src/shared/messages';
  import Avatar from './Avatar.svelte';
  import { maskEmail } from '../lib/maskEmail';
  import { timeAgo } from '../lib/timeAgo';
  import { getMode } from '../stores/app.svelte';

  interface Props {
    account: AccountMeta;
    masked: boolean;
  }

  let { account, masked }: Props = $props();

  let displayEmail = $derived(masked ? maskEmail(account.email) : account.email);
  let since = $derived(timeAgo(account.lastUsedAt ?? account.addedAt));
</script>

<div class="active-card" aria-current="true" role="listitem">
  <div class="card-header">
    <Avatar email={account.email} size={36} active={true} />
    <div class="card-info">
      <div class="email-row">
        <span class="email" title={account.email}>{displayEmail}</span>
        <span class="active-badge">{getMode() === 'profile' ? 'THIS WINDOW' : 'ACTIVE'}</span>
      </div>
      <div class="meta-row">
        {#if account.label}
          <span class="label-chip">{account.label}</span>
        {/if}
        {#if account.plan}
          <span class="plan-badge">{account.plan}</span>
        {/if}
        <span class="since">Active {since}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .active-card {
    padding: 12px;
    border-radius: 6px;
    background: var(--vscode-editor-background, #252526);
    border: 1px solid var(--vscode-testing-iconPassed, #4ec9b0);
    border-left: 3px solid var(--vscode-testing-iconPassed, #4ec9b0);
    position: relative;
    overflow: hidden;
  }

  .active-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--vscode-testing-iconPassed, #4ec9b0), transparent 92%),
      transparent 60%
    );
    pointer-events: none;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    position: relative;
    z-index: 1;
  }

  .card-info {
    min-width: 0;
    flex: 1;
  }

  .email-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .email {
    font-size: 12.5px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-foreground, #ccc);
  }

  .active-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vscode-testing-iconPassed, #4ec9b0);
    color: #000;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .label-chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
  }

  .plan-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 75%);
    color: var(--vscode-textLink-foreground, #3794ff);
  }

  .since {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #888);
  }
</style>
