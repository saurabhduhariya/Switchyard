<script lang="ts">
  import { postToHost } from '../lib/vscode';

  function handleAdd() {
    postToHost({ type: 'add' });
  }
</script>

<div class="empty-state">
  <div class="empty-icon" aria-hidden="true">
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/>
      <circle cx="24" cy="19" r="7" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
      <path d="M12 38c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" opacity="0.5" stroke-linecap="round"/>
      <line x1="36" y1="30" x2="36" y2="38" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
      <line x1="32" y1="34" x2="40" y2="34" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    </svg>
  </div>
  <p class="empty-title">No saved accounts</p>
  <p class="empty-desc">Save your current login to quickly switch between accounts later.</p>
  <button class="btn primary" onclick={handleAdd}>
    Save Current Login
  </button>
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 16px;
    text-align: center;
  }

  .empty-icon {
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 4px;
  }

  .empty-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
  }

  .empty-desc {
    margin: 0;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground, #888);
    line-height: 1.5;
    max-width: 200px;
  }

  .btn.primary {
    margin-top: 6px;
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    transition: background 0.12s;
  }

  .btn.primary:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .btn.primary:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
</style>
