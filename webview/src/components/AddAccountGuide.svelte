<script lang="ts">
  import type { AddAccountGuideState } from '../../../src/shared/messages';
  import { postToHost } from '../lib/vscode';

  interface Props {
    guide: AddAccountGuideState;
  }

  let { guide }: Props = $props();

  function handleSignIn() {
    postToHost({ type: 'signIn' });
  }

  function handleCancel() {
    postToHost({ type: 'cancelAddAccount' });
  }
</script>

<div class="guide-card" role="region" aria-label="Sign in guidance">
  <div class="guide-header">
    <div class="guide-badge">
      <span class="badge-dot"></span>
      <span>{guide.expectedEmail ? 'Re-authentication' : 'Add New Account'}</span>
    </div>
  </div>

  <h3 class="guide-title">
    {guide.expectedEmail ? `Sign in to ${guide.expectedEmail}` : 'Sign in with your new account'}
  </h3>

  <p class="guide-desc">
    {#if guide.expectedEmail}
      Click below to open the browser sign-in for <strong>{guide.expectedEmail}</strong>.
    {:else}
      Antigravity is signed out. Click below to sign in with your new Google account in the browser. Switchyard will detect your new account automatically.
    {/if}
  </p>

  <div class="guide-actions">
    <button class="btn btn-primary" onclick={handleSignIn} aria-label="Sign in to Antigravity">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
        <polyline points="10 17 15 12 10 7"/>
        <line x1="15" y1="12" x2="3" y2="12"/>
      </svg>
      Sign In to Antigravity
    </button>

    <button class="btn btn-secondary" onclick={handleCancel} aria-label="Cancel and restore previous account">
      {#if guide.previousEmail}
        Cancel & Restore {guide.previousEmail}
      {:else}
        Cancel
      {/if}
    </button>
  </div>
</div>

<style>
  .guide-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-background, #252526) 90%, var(--vscode-textLink-foreground, #3794ff) 10%);
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 40%, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    margin-bottom: 8px;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .guide-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .guide-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 15%, transparent);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vscode-textLink-foreground, #3794ff);
    animation: pulse 1.8s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 0.4;
      transform: scale(0.9);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
    100% {
      opacity: 0.4;
      transform: scale(0.9);
    }
  }

  .guide-title {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
  }

  .guide-desc {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--vscode-descriptionForeground, #999);
  }

  .guide-desc strong {
    color: var(--vscode-foreground, #eee);
  }

  .guide-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.12s, opacity 0.12s;
  }

  .btn-primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .btn-secondary {
    background: transparent;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 11px;
    padding: 4px 8px;
  }

  .btn-secondary:hover {
    color: var(--vscode-foreground, #ccc);
    text-decoration: underline;
  }

  .btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }
</style>
