<script lang="ts">
  import Icon from './Icon.svelte';
  import SupportDialog from './SupportDialog.svelte';
  import {
    getMode,
    getAddAccountMethod,
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
  let addAccountMethod = $derived(getAddAccountMethod());
  let maskEmails = $derived(getMaskEmails());
  let confirmBeforeSwitch = $derived(getConfirmBeforeSwitch());
  let backupRetention = $derived(getBackupRetention());

  let supportOpen = $state(false);
  let supportTrigger: HTMLButtonElement | undefined = $state();

  const modeOptions = [
    { value: 'tokenSwap', label: 'Token swap', hint: 'Same window, quick restart.' },
    { value: 'profile', label: 'Profiles', hint: 'A separate window per account.' },
  ] as const;

  const addOptions = [
    { value: 'sideWindow', label: 'Side window', hint: 'Sign in elsewhere; this window stays open.' },
    { value: 'signOutRestart', label: 'Sign out', hint: 'Signs out and restarts this window.' },
  ] as const;

  let modeHint = $derived(modeOptions.find((o) => o.value === mode)?.hint ?? '');
  let addHint = $derived(addOptions.find((o) => o.value === addAccountMethod)?.hint ?? '');

  function setMode(newMode: 'tokenSwap' | 'profile') {
    if (newMode === mode) return;
    postToHost({ type: 'updateSetting', key: 'mode', value: newMode });
  }

  function setAddAccountMethod(newMethod: 'sideWindow' | 'signOutRestart') {
    if (newMethod === addAccountMethod) return;
    postToHost({ type: 'updateSetting', key: 'addAccountMethod', value: newMethod });
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

  // Arrow keys move between options, as in a native radio group.
  function segmentKeydown(
    e: KeyboardEvent,
    options: readonly { value: string }[],
    current: string,
    select: (v: never) => void
  ) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === current);
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = options[(i + step + options.length) % options.length]!;
    select(next.value as never);
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    requestAnimationFrame(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
</script>

<div class="settings-view">
  <header class="nav-bar">
    <button class="back-btn" onclick={onBack} aria-label="Back to accounts" title="Back to accounts">
      <Icon name="arrow-left" size={13} />
    </button>
    <h1 class="nav-title">Settings</h1>
    <button
      class="icon-btn"
      onclick={openEditorSettings}
      title="Open all settings in the editor"
      aria-label="Open all settings in the editor"
    >
      <Icon name="external" size={13} />
    </button>
  </header>

  <div class="settings-scroll-area">
    <section class="group" aria-labelledby="g-switching">
      <h2 id="g-switching" class="group-title">Switching</h2>
      <div class="rows">
        <div class="row stacked">
          <span class="label" id="lbl-mode">Mode</span>
          <div class="segmented" role="radiogroup" aria-labelledby="lbl-mode">
            {#each modeOptions as opt (opt.value)}
              <button
                type="button"
                role="radio"
                class="segment"
                aria-checked={mode === opt.value}
                tabindex={mode === opt.value ? 0 : -1}
                onclick={() => setMode(opt.value)}
                onkeydown={(e) => segmentKeydown(e, modeOptions, mode, setMode)}
              >
                <span class="segment-inner">
                  {#if mode === opt.value}<Icon name="check" size={11} class="segment-check" />{/if}
                  <span class="segment-text">{opt.label}</span>
                </span>
              </button>
            {/each}
          </div>
          <span class="hint">{modeHint}</span>
        </div>

        <div class="row stacked">
          <span class="label" id="lbl-add">Add accounts with</span>
          <div class="segmented" role="radiogroup" aria-labelledby="lbl-add">
            {#each addOptions as opt (opt.value)}
              <button
                type="button"
                role="radio"
                class="segment"
                aria-checked={addAccountMethod === opt.value}
                tabindex={addAccountMethod === opt.value ? 0 : -1}
                onclick={() => setAddAccountMethod(opt.value)}
                onkeydown={(e) => segmentKeydown(e, addOptions, addAccountMethod, setAddAccountMethod)}
              >
                <span class="segment-inner">
                  {#if addAccountMethod === opt.value}<Icon name="check" size={11} class="segment-check" />{/if}
                  <span class="segment-text">{opt.label}</span>
                </span>
              </button>
            {/each}
          </div>
          <span class="hint">{addHint}</span>
        </div>

        <div class="row">
          <span class="label" id="lbl-confirm">Confirm before switching</span>
          <button
            type="button"
            class="toggle {confirmBeforeSwitch ? 'on' : ''}"
            onclick={toggleConfirm}
            role="switch"
            aria-checked={confirmBeforeSwitch}
            aria-labelledby="lbl-confirm"
          >
            <span class="knob"></span>
          </button>
        </div>
      </div>
    </section>

    <section class="group" aria-labelledby="g-privacy">
      <h2 id="g-privacy" class="group-title">Privacy</h2>
      <div class="rows">
        <div class="row">
          <span class="label-block">
            <span class="label" id="lbl-mask">Hide email addresses</span>
            <span class="hint">Removes them from cards and the status bar</span>
          </span>
          <button
            type="button"
            class="toggle {maskEmails ? 'on' : ''}"
            onclick={toggleMaskEmails}
            role="switch"
            aria-checked={maskEmails}
            aria-labelledby="lbl-mask"
          >
            <span class="knob"></span>
          </button>
        </div>
      </div>
    </section>

    <section class="group" aria-labelledby="g-backups">
      <h2 id="g-backups" class="group-title">Backups</h2>
      <div class="rows">
        <div class="row">
          <span class="label" id="lbl-keep">Backups to keep</span>
          <div class="stepper" role="group" aria-labelledby="lbl-keep">
            <button
              class="stepper-btn"
              onclick={() => changeRetention(-1)}
              disabled={backupRetention <= 1}
              aria-label="Keep fewer backups"
            >
              −
            </button>
            <span class="stepper-value" aria-live="polite">{backupRetention}</span>
            <button
              class="stepper-btn"
              onclick={() => changeRetention(1)}
              disabled={backupRetention >= 20}
              aria-label="Keep more backups"
            >
              +
            </button>
          </div>
        </div>
        <div class="row actions">
          <button class="text-btn" onclick={openBackupsFolder}>
            <Icon name="folder" size={12} />
            <span>Open folder</span>
          </button>
          <button class="text-btn" onclick={restoreBackup}>
            <Icon name="restore" size={12} />
            <span>Restore…</span>
          </button>
        </div>
      </div>
    </section>

    <footer class="settings-footer">
      <span class="local-note">
        <Icon name="lock" size={11} />
        <span>Runs locally. No telemetry.</span>
      </span>
      <button
        bind:this={supportTrigger}
        type="button"
        class="support-link"
        onclick={() => (supportOpen = true)}
        aria-haspopup="dialog"
      >
        Support Switchyard ❤️
      </button>
    </footer>
  </div>
</div>

<SupportDialog open={supportOpen} onClose={() => (supportOpen = false)} returnFocusTo={supportTrigger} />

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

  /* ── Top bar ── */
  .nav-bar {
    display: grid;
    grid-template-columns: 28px 1fr 28px;
    align-items: center;
    padding: 6px 4px 8px;
    background: var(--vscode-sideBar-background);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .nav-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
  }

  .back-btn,
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .back-btn:hover,
  .icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
    color: var(--vscode-foreground);
  }

  .settings-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 6px 2px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* ── Groups: a quiet heading over one container of rows ── */
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .group-title {
    margin: 0;
    padding-left: 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }

  .rows {
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.18));
    border-radius: 6px;
    background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e), transparent 40%);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 38px;
    padding: 8px 10px;
  }

  .row + .row {
    border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.14));
  }

  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .row.actions {
    justify-content: flex-start;
    gap: 4px;
    padding: 4px 6px;
    min-height: 0;
  }

  .label-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .label {
    font-size: 12px;
    color: var(--vscode-foreground);
  }

  .hint {
    font-size: 11px;
    line-height: 1.35;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Segmented control ── */
  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 2px;
    border-radius: 5px;
    background: var(--vscode-input-background, rgba(128, 128, 128, 0.12));
    border: 1px solid var(--vscode-input-border, transparent);
  }

  .segment {
    padding: 4px 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    font-family: inherit;
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .segment:hover:not([aria-checked='true']) {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  /*
   * Selected state uses the theme's focus colour (a tinted fill plus a solid
   * outline) rather than button-background, which some themes make nearly
   * transparent. The check icon keeps it readable without relying on colour.
   */
  .segment[aria-checked='true'] {
    background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4), transparent 78%);
    box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, #007fd4);
    color: var(--vscode-foreground);
    font-weight: 600;
  }

  .segment-inner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    max-width: 100%;
  }

  .segment-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .segment :global(.segment-check) {
    flex-shrink: 0;
    color: var(--vscode-foreground);
  }

  /* ── Toggle ── */
  .toggle {
    width: 30px;
    height: 16px;
    flex-shrink: 0;
    padding: 0;
    position: relative;
    border-radius: 8px;
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.4));
    background: var(--vscode-input-background, #3c3c3c);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground, #999);
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .toggle.on {
    background: var(--vscode-button-background, #0e639c);
    border-color: var(--vscode-button-background, #0e639c);
  }

  .toggle.on .knob {
    transform: translateX(14px);
    background: var(--vscode-button-foreground, #fff);
  }

  /* ── Stepper ── */
  .stepper {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
    border-radius: 4px;
    overflow: hidden;
  }

  .stepper-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .stepper-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  .stepper-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .stepper-value {
    min-width: 22px;
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Text buttons ── */
  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }

  .text-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  /* ── Footer ── */
  /*
   * Centred so it looks deliberate both on one line and when the two items
   * wrap onto separate lines in a narrow sidebar or with a wide font.
   */
  .settings-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 2px 12px;
    margin-top: auto;
    padding: 10px 2px 0;
    border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.14));
  }

  .local-note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 0;
    font-size: 10.5px;
    white-space: nowrap;
    color: var(--vscode-descriptionForeground);
  }

  .support-link {
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    font-family: inherit;
    font-size: 10.5px;
    cursor: pointer;
    padding: 3px 6px;
    white-space: nowrap;
    transition: color 0.12s ease, background 0.12s ease;
  }

  .support-link:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-view {
      animation: none;
    }
    .toggle,
    .knob,
    .segment {
      transition: none;
    }
  }
</style>
