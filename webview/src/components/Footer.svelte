<script lang="ts">
  import { postToHost } from '../lib/vscode';
  import { getAccounts } from '../stores/app.svelte';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

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
    <span class="plus" aria-hidden="true">+</span>
    {getAccounts().length > 0 ? 'Add Another Account' : 'Add Account'}
  </button>

  <button class="import-btn" onclick={handleImport} aria-label="Import account from file or backup">
    Import from Backup / File
  </button>
</footer>

<style>
  .footer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
  }

  .import-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 5px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-descriptionForeground, #999);
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    transition: color 0.12s;
  }

  .import-btn:hover {
    color: var(--vscode-foreground, #ccc);
    text-decoration: underline;
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

  .add-btn:hover {
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff), transparent 90%);
    border-color: var(--vscode-textLink-foreground, #3794ff);
  }

  .add-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }

  .plus {
    font-size: 16px;
    font-weight: 400;
    line-height: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .add-btn {
      transition: none;
    }
  }
</style>
