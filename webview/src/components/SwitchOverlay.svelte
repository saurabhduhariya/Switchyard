<script lang="ts">
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div class="overlay" role="alertdialog" aria-label="Switching account">
  <div class="overlay-content">
    <div class="spinner" aria-hidden="true">
      <div class="dot dot1"></div>
      <div class="dot dot2"></div>
      <div class="dot dot3"></div>
    </div>
    <p class="switch-message">{message}</p>
    <p class="switch-notice">IDE will restart shortly</p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--vscode-sideBar-background, #1e1e1e), transparent 8%);
    backdrop-filter: blur(4px);
  }

  .overlay-content {
    text-align: center;
    padding: 24px;
    animation: fadeIn 0.2s ease-out;
  }

  .spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-bottom: 16px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-textLink-foreground, #3794ff);
    animation: bounce 1.2s ease-in-out infinite;
  }

  .dot2 {
    animation-delay: 0.15s;
  }

  .dot3 {
    animation-delay: 0.3s;
  }

  .switch-message {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground, #ccc);
  }

  .switch-notice {
    margin: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
  }

  @keyframes bounce {
    0%, 60%, 100% {
      transform: translateY(0);
      opacity: 1;
    }
    30% {
      transform: translateY(-10px);
      opacity: 0.6;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
    .overlay-content {
      animation: none;
    }
  }
</style>
