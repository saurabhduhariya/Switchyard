<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    reason?: string;
    version?: string;
  }

  let { reason, version }: Props = $props();
</script>

<div class="unsupported-banner" role="alert" aria-live="polite">
  <div class="banner-header">
    <span class="warning-badge">
      <span class="badge-dot"></span>
      Unsupported Version
    </span>
    {#if version}
      <span class="version-tag">v{version}</span>
    {/if}
  </div>

  <h3 class="banner-title">This Antigravity version isn't supported yet</h3>

  <p class="banner-desc">
    {reason || 'Switchyard cannot safely parse authentication tokens in this Antigravity version. Account switching and adding are disabled to protect your credentials.'}
  </p>

  <div class="banner-note">
    <span class="note-icon" aria-hidden="true">
      <Icon name="lock" size={13} />
    </span>
    <span>Read-only features (viewing, renaming, backups) remain safe and available.</span>
  </div>
</div>

<style>
  .unsupported-banner {
    margin: 8px 12px;
    padding: 12px 14px;
    background: rgba(234, 154, 42, 0.08);
    border: 1px solid rgba(234, 154, 42, 0.28);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  .banner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .warning-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #f3a83b;
  }

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #f3a83b;
    box-shadow: 0 0 6px rgba(243, 168, 59, 0.6);
  }

  .version-tag {
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground, #999);
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .banner-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #eee);
    line-height: 1.3;
  }

  .banner-desc {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--vscode-descriptionForeground, #aaa);
  }

  .banner-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: 10.5px;
    color: #e0a352;
    background: rgba(234, 154, 42, 0.06);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .note-icon {
    font-size: 11px;
  }
</style>
