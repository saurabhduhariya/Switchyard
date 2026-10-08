<script lang="ts">
  import type { CaptureSessionState } from '../../../src/shared/messages';
  import { postToHost } from '../lib/vscode';

  interface Props {
    capture: CaptureSessionState;
  }

  let { capture }: Props = $props();
  let label = $state('');

  function handleSave() {
    postToHost({ type: 'saveCaptured', label: label.trim() || undefined });
  }

  function handleCancel() {
    postToHost({ type: 'cancelCapture' });
  }

  function handleSwitchNow() {
    if (capture.savedAccountId) {
      postToHost({ type: 'switch', id: capture.savedAccountId });
    }
    postToHost({ type: 'dismissCapture' });
  }

  function handleDismiss() {
    postToHost({ type: 'dismissCapture' });
  }

  function handleLegacy() {
    postToHost({ type: 'useLegacyAdd' });
  }

  function detectedNote(): string {
    if (capture.detectedKind === 'active') {
      return 'This is the account you are signed in with right now. Saving refreshes its stored session.';
    }
    if (capture.detectedKind === 'saved') {
      return 'This account is already saved. Saving refreshes its stored session instead of adding a duplicate.';
    }
    return '';
  }

  function minutesLeft(): number {
    return capture.expiresAt ? Math.max(1, Math.ceil((capture.expiresAt - Date.now()) / 60000)) : 10;
  }

  function doneDescription(): string {
    if (capture.updated) {
      return 'This account was already saved. Its session was refreshed.';
    }
    if (capture.promoted) {
      return 'Added. Its sign-in window is now this account\'s profile, so it opens already signed in.';
    }
    return 'Your new account has been added.';
  }

  function handleFinish() {
    postToHost({ type: 'finishCapture' });
  }

  function handleReopen() {
    postToHost({ type: 'reopenCaptureWindow' });
  }

  const stateMessages = {
    launching: {
      title: 'Opening sign-in window...',
      description: 'A new Antigravity window is launching for you to sign in with a different account.',
      badge: 'Launching',
    },
    waitingForSignIn: {
      title: 'Waiting for sign-in',
      description: 'Sign in with your new Google account in the separate window. This window will continue waiting...',
      badge: 'Waiting',
    },
    detected: {
      title: 'Account detected!',
      description: 'Sign-in complete. Add an optional label and click Save to add this account. Unsaved accounts are discarded after 10 minutes.',
      badge: 'Detected',
    },
    finishing: {
      title: 'Reading sign-in...',
      description: 'Closing the sign-in window and reading your new login.',
      badge: 'Finishing',
    },
    saving: {
      title: 'Saving account...',
      description: 'Saving credentials and closing the sign-in window.',
      badge: 'Saving',
    },
    done: {
      title: 'Account saved',
      description: 'Your new account has been added.',
      badge: 'Complete',
    },
    timedOut: {
      title: 'Sign-in timed out',
      description: 'The sign-in window timed out. Try again or cancel.',
      badge: 'Timed Out',
    },
    cancelled: {
      title: 'Cancelled',
      description: 'Account capture was cancelled.',
      badge: 'Cancelled',
    },
    failed: {
      title: 'Failed',
      description: 'Account capture failed. See error details below.',
      badge: 'Failed',
    },
  };

  $effect(() => {
    const msg = stateMessages[capture.state];
  });
</script>

<div class="capture-card" class:detected={capture.state === 'detected'} class:error={capture.state === 'failed' || capture.state === 'timedOut'} role="region" aria-label="Account capture status">
  <div class="capture-header">
    <div class="capture-badge" class:pulsing={capture.state === 'launching' || capture.state === 'waitingForSignIn' || capture.state === 'finishing' || capture.state === 'saving'}>
      {#if capture.state === 'launching' || capture.state === 'waitingForSignIn' || capture.state === 'finishing' || capture.state === 'saving'}
        <span class="spinner"></span>
      {:else if capture.state === 'detected'}
        <span class="check-icon">✓</span>
      {:else if capture.state === 'failed' || capture.state === 'timedOut'}
        <span class="error-icon">!</span>
      {/if}
      <span>{stateMessages[capture.state].badge}</span>
    </div>
  </div>

  <h3 class="capture-title">
    {stateMessages[capture.state].title}
  </h3>

  <p class="capture-desc">
    {capture.state === 'done' ? doneDescription() : stateMessages[capture.state].description}
    {#if capture.state === 'done' && capture.savedEmail}
      <strong>{capture.savedEmail}</strong>
    {:else if capture.detectedEmail}
      <strong>{capture.detectedEmail}</strong>
    {/if}
    {#if capture.state === 'detected' && detectedNote()}
      <span class="capture-note">{detectedNote()}</span>
    {/if}
    {#if capture.state === 'detected' && capture.expiresAt}
      <em>(about {minutesLeft()} min left)</em>
    {/if}
  </p>

  {#if capture.diagnostic && capture.state === 'waitingForSignIn'}
    <p class="capture-desc"><em>{capture.diagnostic}</em></p>
  {/if}

  {#if capture.error}
    <div class="error-message">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {capture.error}
    </div>
  {/if}

  {#if capture.state === 'detected'}
    <div class="input-group">
      <label for="capture-label" class="input-label">Label (optional)</label>
      <input
        id="capture-label"
        type="text"
        class="input"
        bind:value={label}
        placeholder="e.g. Work, Personal, Client A"
        aria-label="Account label"
      />
    </div>
  {/if}

  <div class="capture-actions">
    {#if capture.state === 'waitingForSignIn'}
      <button class="btn btn-primary" onclick={handleFinish} aria-label="I have signed in">
        I've signed in
      </button>
      <button class="btn btn-secondary" onclick={handleReopen} aria-label="Reopen sign-in window">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Reopen Window
      </button>
      <button class="btn btn-ghost" onclick={handleCancel} aria-label="Cancel capture">
        Cancel
      </button>
    {:else if capture.state === 'detected'}
      <button class="btn btn-primary" onclick={handleSave} aria-label="Save account">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        {capture.detectedKind === 'new' || !capture.detectedKind ? 'Save Account' : 'Refresh saved session'}
      </button>
      <button class="btn btn-secondary" onclick={handleCancel} aria-label="Discard and cancel">
        Discard
      </button>
    {:else if capture.state === 'done'}
      {#if capture.savedAccountId}
        <button class="btn btn-primary" onclick={handleSwitchNow} aria-label="Switch to this account now">
          Switch to this account
        </button>
      {/if}
      <button class="btn btn-ghost" onclick={handleDismiss} aria-label="Dismiss">
        Dismiss
      </button>
    {:else if capture.state === 'timedOut' || capture.state === 'failed'}
      <button class="btn btn-secondary" onclick={handleReopen} aria-label="Try again">
        Try Again
      </button>
      <button class="btn btn-secondary" onclick={handleLegacy} aria-label="Use the sign-out method instead">
        Use sign-out method
      </button>
      <button class="btn btn-ghost" onclick={handleCancel} aria-label="Cancel">
        Cancel
      </button>
    {:else if capture.state === 'launching' || capture.state === 'saving' || capture.state === 'finishing'}
      <button class="btn btn-ghost" onclick={handleCancel} aria-label="Cancel" disabled={capture.state !== 'launching'}>
        Cancel
      </button>
    {/if}
  </div>
</div>

<style>
  .capture-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-background, #252526) 90%, var(--vscode-textLink-foreground, #3794ff) 10%);
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 40%, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    margin-bottom: 10px;
    animation: fadeIn 0.25s ease-out;
  }

  .capture-card.detected {
    background: color-mix(in srgb, var(--vscode-editor-background, #252526) 85%, #4cd964 15%);
    border-color: color-mix(in srgb, #4cd964 50%, transparent);
  }

  .capture-card.error {
    background: color-mix(in srgb, var(--vscode-editor-background, #252526) 85%, #f48771 15%);
    border-color: color-mix(in srgb, #f48771 50%, transparent);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .capture-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .capture-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 18%, transparent);
    padding: 3px 8px;
    border-radius: 10px;
  }

  .capture-badge.pulsing {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .check-icon {
    font-size: 14px;
    color: #4cd964;
    font-weight: bold;
  }

  .error-icon {
    font-size: 14px;
    color: #f48771;
    font-weight: bold;
  }

  .capture-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
    margin: 0;
  }

  .capture-desc {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--vscode-descriptionForeground, #999);
    margin: 0;
  }

  .capture-note {
    display: block;
    margin-top: 6px;
    font-size: 11px;
    opacity: 0.85;
  }

  .capture-desc strong {
    color: var(--vscode-foreground, #ccc);
    font-weight: 600;
  }

  .error-message {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #5a1d1d) 80%, transparent);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    border-radius: 4px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--vscode-inputValidation-errorForeground, #f48771);
  }

  .error-message svg {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
  }

  .input {
    padding: 6px 8px;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.4));
    border-radius: 4px;
    color: var(--vscode-input-foreground, #ccc);
    font-size: 12px;
    font-family: inherit;
    transition: border-color 0.1s ease;
  }

  .input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .input::placeholder {
    color: var(--vscode-input-placeholderForeground, #767676);
  }

  .capture-actions {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--vscode-button-background, #007fd4);
    color: var(--vscode-button-foreground, #fff);
    flex: 1;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, #026ec1);
  }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .btn-ghost {
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
  }

  .btn-ghost:hover:not(:disabled) {
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 15%, transparent);
  }

  .btn svg {
    flex-shrink: 0;
  }
</style>
