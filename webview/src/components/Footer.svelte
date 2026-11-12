<script lang="ts">
  import { postToHost } from '../lib/vscode';
  import { getAccounts } from '../stores/app.svelte';
  import Icon from './Icon.svelte';
  import SupportDialog from './SupportDialog.svelte';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  let supportOpen = $state(false);
  let supportTrigger: HTMLButtonElement | undefined = $state();

  function handleAdd() {
    if (disabled) return;
    if (getAccounts().length > 0) {
      postToHost({ type: 'addNewAccount' });
    } else {
      postToHost({ type: 'add' });
    }
  }

  function handleImport() {
    postToHost({ type: 'import' });
  }
</script>

<footer class="footer">
  <button class="add-btn" onclick={handleAdd} {disabled} aria-label="Add account" title={disabled ? 'Adding accounts is disabled in unsupported environment' : undefined}>
    <Icon name="plus" size={13} />
    <span>{getAccounts().length > 0 ? 'Add Another Account' : 'Add Account'}</span>
  </button>

  <div class="footer-links">
    <button
      type="button"
      class="link-btn"
      onclick={handleImport}
      aria-label="Import account from file or backup"
      title="Import from Backup / File"
    >
      <Icon name="import" size={12} class="import-icon" />
      <span class="label-long">Import from Backup / File</span>
      <span class="label-short">Import</span>
    </button>
    <span class="divider" aria-hidden="true"></span>
    <button
      bind:this={supportTrigger}
      type="button"
      class="link-btn"
      onclick={() => (supportOpen = true)}
      aria-haspopup="dialog"
      aria-label="Support Switchyard"
      title="Support Switchyard"
    >
      <span class="heart" aria-hidden="true">❤️</span>
      <span class="label-long">Support Switchyard</span>
      <span class="label-short">Support</span>
    </button>
  </div>
</footer>

<SupportDialog open={supportOpen} onClose={() => (supportOpen = false)} returnFocusTo={supportTrigger} />

<style>
  .footer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
  }

  /*
   * Secondary actions: two equal halves split by a thin divider. They never
   * wrap; in narrow sidebars the labels switch to short forms instead.
   */
  .footer-links {
    container-type: inline-size;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 4px;
  }

  .divider {
    width: 1px;
    height: 14px;
    background: var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
  }

  .heart {
    font-size: 11px;
    line-height: 1;
  }

  .label-long,
  .label-short {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label-short {
    display: none;
  }

  @container (max-width: 420px) {
    .label-long {
      display: none;
    }
    .label-short {
      display: inline;
    }
  }

  .link-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    width: 100%;
    padding: 4px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-descriptionForeground, #999);
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    white-space: nowrap;
    transition: color 0.12s, background 0.12s;
  }

  .link-btn:hover {
    color: var(--vscode-foreground, #ccc);
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  .add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 7px 12px;
    border: 1px dashed var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
    border-radius: 6px;
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.12s, border-color 0.12s;
  }

  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 90%);
    border-color: var(--vscode-textLink-foreground, #3794ff);
  }

  .add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .add-btn {
      transition: none;
    }
  }
</style>
