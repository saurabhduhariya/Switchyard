<script lang="ts">
  import Icon from './Icon.svelte';
  import {
    getMode,
    getMaskEmails,
    getConfirmBeforeSwitch,
    getBackupRetention,
  } from '../stores/app.svelte';
  import { postToHost } from '../lib/vscode';

  interface Props {
    onBack: () => void;
  }

  let { onBack }: Props = $props();

  let mode = $derived(getMode());
  let maskEmails = $derived(getMaskEmails());
  let confirmBeforeSwitch = $derived(getConfirmBeforeSwitch());
  let backupRetention = $derived(getBackupRetention());

  function setMode(newMode: 'tokenSwap' | 'profile') {
    if (newMode === mode) return;
    postToHost({ type: 'updateSetting', key: 'mode', value: newMode });
  }

  function toggleMaskEmails() {
    postToHost({ type: 'updateSetting', key: 'maskEmails', value: !maskEmails });
  }

  function toggleConfirm() {
    postToHost({ type: 'updateSetting', key: 'confirmBeforeSwitch', value: !confirmBeforeSwitch });
  }

  function changeRetention(delta: number) {
    const next = Math.max(1, Math.min(20, backupRetention + delta));
    if (next !== backupRetention) {
      postToHost({ type: 'updateSetting', key: 'backupRetention', value: next });
    }
  }

  function openBackupsFolder() {
    postToHost({ type: 'openBackupsFolder' });
  }

  function restoreBackup() {
    postToHost({ type: 'restoreBackup' });
  }

  function openEditorSettings() {
    postToHost({ type: 'openSettingsEditor' });
  }
</script>

<div class="settings-view">
  <!-- Top Bar Navigation -->
  <div class="nav-bar">
    <button class="back-btn" onclick={onBack} aria-label="Back to Accounts" title="Back to Accounts">
      <Icon name="arrow-left" size={13} />
      <span>Accounts</span>
    </button>
    <span class="nav-title">Settings</span>
    <button
      class="icon-btn-subtle"
      onclick={openEditorSettings}
      title="Open in VS Code Settings Editor"
      aria-label="Open in VS Code Settings Editor"
    >
      <Icon name="external" size={13} />
    </button>
  </div>

  <div class="settings-scroll-area">
    <!-- Switching Mode Section -->
    <section class="settings-section">
      <div class="section-header">
        <Icon name="switch" size={12} class="section-icon" />
        <span class="section-title">SWITCHING MODE</span>
      </div>

      <div class="mode-options">
        <button
          type="button"
          class="mode-card {mode === 'tokenSwap' ? 'active' : ''}"
          onclick={() => setMode('tokenSwap')}
        >
          <div class="mode-card-header">
            <div class="radio-circle">
              {#if mode === 'tokenSwap'}
                <div class="radio-dot"></div>
              {/if}
            </div>
            <span class="mode-name">Token Swap</span>
            <span class="badge recommended">Recommended</span>
          </div>
          <p class="mode-desc">
            Swaps authentication tokens directly in the current window. Fast &amp; lightweight reload.
          </p>
        </button>

        <button
          type="button"
          class="mode-card {mode === 'profile' ? 'active' : ''}"
          onclick={() => setMode('profile')}
        >
          <div class="mode-card-header">
            <div class="radio-circle">
              {#if mode === 'profile'}
                <div class="radio-dot"></div>
              {/if}
            </div>
            <span class="mode-name">Isolated Profiles</span>
            <span class="badge side-by-side">Side-by-side</span>
          </div>
          <p class="mode-desc">
            Launches separate, isolated window profiles to run multiple accounts simultaneously.
          </p>
        </button>
      </div>
    </section>

    <!-- Confirmation & Behavior -->
    <section class="settings-section">
      <div class="section-header">
        <Icon name="alert" size={12} class="section-icon" />
        <span class="section-title">BEHAVIOR</span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Confirm Before Switch</div>
          <div class="setting-subtext">
            Prompt for confirmation before reloading the IDE in Token Swap mode.
          </div>
        </div>
        <button
          type="button"
          class="toggle-switch {confirmBeforeSwitch ? 'checked' : ''}"
          onclick={toggleConfirm}
          role="switch"
          aria-checked={confirmBeforeSwitch}
          aria-label="Confirm before switch"
        >
          <span class="toggle-slider"></span>
        </button>
      </div>
    </section>

    <!-- Privacy & Display -->
    <section class="settings-section">
      <div class="section-header">
        <Icon name="lock" size={12} class="section-icon" />
        <span class="section-title">PRIVACY &amp; DISPLAY</span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Mask Email Addresses</div>
          <div class="setting-subtext">
            Hide full emails in cards and status bar (e.g. u***@domain.com).
          </div>
        </div>
        <button
          type="button"
          class="toggle-switch {maskEmails ? 'checked' : ''}"
          onclick={toggleMaskEmails}
          role="switch"
          aria-checked={maskEmails}
          aria-label="Mask email addresses"
        >
          <span class="toggle-slider"></span>
        </button>
      </div>
    </section>

    <!-- Database Backups -->
    <section class="settings-section">
      <div class="section-header">
        <Icon name="folder" size={12} class="section-icon" />
        <span class="section-title">STATE BACKUPS</span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Backup Retention Limit</div>
          <div class="setting-subtext">
            Number of automatic state.vscdb backups kept before switching.
          </div>
        </div>
        <div class="stepper">
          <button
            class="stepper-btn"
            onclick={() => changeRetention(-1)}
            disabled={backupRetention <= 1}
            aria-label="Decrease retention"
          >
            -
          </button>
          <span class="stepper-value">{backupRetention}</span>
          <button
            class="stepper-btn"
            onclick={() => changeRetention(1)}
            disabled={backupRetention >= 20}
            aria-label="Increase retention"
          >
            +
          </button>
        </div>
      </div>

      <div class="backup-actions">
        <button class="action-btn" onclick={openBackupsFolder}>
          <Icon name="folder" size={13} />
          <span>Open Backups Folder</span>
        </button>
        <button class="action-btn secondary" onclick={restoreBackup}>
          <Icon name="restore" size={13} />
          <span>Restore Backup…</span>
        </button>
      </div>
    </section>

    <!-- Info & Advanced Footer -->
    <div class="settings-footer">
      <div class="security-badge">
        <Icon name="lock" size={12} />
        <span>100% Local • Zero Telemetry • Zero External Network</span>
      </div>
      <button class="editor-settings-link" onclick={openEditorSettings}>
        <Icon name="settings" size={12} />
        <span>Open Advanced VS Code Settings</span>
      </button>
    </div>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100vh;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
    background: var(--vscode-sideBar-background);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.1s ease;
  }

  .back-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  .nav-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .icon-btn-subtle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .icon-btn-subtle:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
    color: var(--vscode-foreground);
  }

  .settings-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 2px;
  }

  :global(.section-icon) {
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
  }

  .section-title {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--vscode-descriptionForeground);
  }

  /* Mode Options Cards */
  .mode-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mode-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: var(--vscode-editor-background, rgba(0, 0, 0, 0.15));
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    color: inherit;
    font-family: inherit;
  }

  .mode-card:hover {
    border-color: var(--vscode-focusBorder, #007fd4);
    background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1));
  }

  .mode-card.active {
    border-color: var(--vscode-focusBorder, #007fd4);
    background: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.12));
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
  }

  .mode-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .radio-circle {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .mode-card.active .radio-circle {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .radio-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vscode-focusBorder, #007fd4);
  }

  .mode-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    flex: 1;
  }

  .badge {
    font-size: 9.5px;
    font-weight: 600;
    padding: 1.5px 6px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .badge.recommended {
    background: rgba(46, 160, 67, 0.2);
    color: #4cd964;
    border: 1px solid rgba(46, 160, 67, 0.4);
  }

  .badge.side-by-side {
    background: rgba(56, 139, 253, 0.18);
    color: #58a6ff;
    border: 1px solid rgba(56, 139, 253, 0.35);
  }

  .mode-desc {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground);
    padding-left: 22px;
  }

  /* Setting Row with Toggle / Stepper */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: var(--vscode-editor-background, rgba(0, 0, 0, 0.15));
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
    border-radius: 6px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .setting-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .setting-subtext {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.35;
  }

  /* Toggle Switch */
  .toggle-switch {
    width: 34px;
    height: 18px;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.4));
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .toggle-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vscode-foreground, #ccc);
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .toggle-switch.checked {
    background: var(--vscode-button-background, #007fd4);
    border-color: var(--vscode-button-background, #007fd4);
  }

  .toggle-switch.checked .toggle-slider {
    transform: translateX(16px);
    background: #ffffff;
  }

  /* Stepper */
  .stepper {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
    border-radius: 4px;
    background: var(--vscode-input-background, transparent);
    overflow: hidden;
  }

  .stepper-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .stepper-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  .stepper-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .stepper-value {
    min-width: 24px;
    text-align: center;
    font-size: 11.5px;
    font-weight: 600;
  }

  /* Backup Actions */
  .backup-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--vscode-button-foreground, #fff);
    background: var(--vscode-button-background, #007fd4);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action-btn:hover {
    background: var(--vscode-button-hoverBackground, #026ec1);
  }

  .action-btn.secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }

  .action-btn.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  /* Footer */
  .settings-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
  }

  .security-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.85;
    text-align: center;
  }

  .editor-settings-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    font-size: 11px;
    cursor: pointer;
    padding: 4px;
  }

  .editor-settings-link:hover {
    text-decoration: underline;
  }
</style>
