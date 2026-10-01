<script lang="ts">
  import { postToHost } from '../lib/vscode';

  function handleAdd() {
    postToHost({ type: 'add' });
  }
</script>

<footer class="footer">
  <button class="add-btn" onclick={handleAdd} aria-label="Add account">
    <span class="plus" aria-hidden="true">+</span>
    Add Account
  </button>
</footer>

<style>
  .footer {
    padding-top: 8px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
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
