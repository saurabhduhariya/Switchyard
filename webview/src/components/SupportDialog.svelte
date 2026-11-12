<script lang="ts">
  import Icon from './Icon.svelte';
  import { SUPPORT_CONFIG, buildUpiPaymentUri, checkSupportConfig } from '../../../src/shared/support';
  import { buildQrSvg, type QrSvg } from '../lib/qr';
  import { closeDialog, copyText, isBackdropClick, openDialog } from '../lib/supportDialog';

  interface Props {
    open: boolean;
    onClose: () => void;
    /** Element to focus again after the dialog closes (usually the trigger). */
    returnFocusTo?: HTMLElement | null;
  }

  let { open, onClose, returnFocusTo = null }: Props = $props();

  const configCheck = checkSupportConfig(SUPPORT_CONFIG);

  // Built once, locally. Nothing here touches the network.
  function prepareQr(): { uri: string; qr: QrSvg } | undefined {
    if (!configCheck.ok) return undefined;
    try {
      const uri = buildUpiPaymentUri(SUPPORT_CONFIG);
      return { uri, qr: buildQrSvg(uri) };
    } catch {
      return undefined;
    }
  }
  const payment = prepareQr();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (open) {
      openDialog(dialogEl);
    } else {
      closeDialog(dialogEl);
    }
  });

  $effect(() => () => clearTimeout(copyTimer));

  function requestClose() {
    closeDialog(dialogEl);
  }

  // The native `close` event fires for every close path (close button, Escape,
  // backdrop click), so focus restoration and parent state live here.
  function handleNativeClose() {
    copyStatus = 'idle';
    clearTimeout(copyTimer);
    returnFocusTo?.focus();
    onClose();
  }

  function handleClick(e: MouseEvent) {
    if (isBackdropClick(e.target, dialogEl)) requestClose();
  }

  async function copyUpiId() {
    copyStatus = await copyText(SUPPORT_CONFIG.upiId.trim(), navigator.clipboard);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyStatus = 'idle'), copyStatus === 'copied' ? 2500 : 6000);
  }
</script>

<dialog
  bind:this={dialogEl}
  class="support-dialog"
  aria-labelledby="support-title"
  aria-describedby="support-desc"
  onclose={handleNativeClose}
  onclick={handleClick}
>
  <div class="dialog-body">
    <div class="dialog-head">
      <h2 id="support-title" class="title">Support Switchyard ❤️</h2>
      <button type="button" class="close-btn" onclick={requestClose} aria-label="Close" title="Close">
        <Icon name="close" size={13} />
      </button>
    </div>

    <p id="support-desc" class="tagline">Help keep Switchyard free and open source.</p>

    {#if payment}
      <div class="qr-frame">
        <svg
          class="qr"
          viewBox="0 0 {payment.qr.size} {payment.qr.size}"
          role="img"
          aria-label="UPI payment QR code for {SUPPORT_CONFIG.payeeName}"
          shape-rendering="crispEdges"
        >
          <rect width={payment.qr.size} height={payment.qr.size} fill="#ffffff" />
          <path d={payment.qr.path} fill="#000000" />
        </svg>
      </div>

      <p class="hint">Scan via any UPI app.</p>

      <dl class="details">
        <div class="detail-row">
          <dt>UPI ID</dt>
          <dd class="selectable">{SUPPORT_CONFIG.upiId}</dd>
        </div>
        <div class="detail-row">
          <dt>Payee</dt>
          <dd class="selectable">{SUPPORT_CONFIG.payeeName}</dd>
        </div>
      </dl>

      <button type="button" class="copy-btn" onclick={copyUpiId}>
        <Icon name={copyStatus === 'copied' ? 'check' : 'copy'} size={13} />
        <span>{copyStatus === 'copied' ? 'Copied' : 'Copy UPI ID'}</span>
      </button>
      <p class="copy-status {copyStatus}" role="status" aria-live="polite">
        {#if copyStatus === 'copied'}
          UPI ID copied to clipboard.
        {:else if copyStatus === 'failed'}
          Couldn't copy automatically. Select the UPI ID above and copy it manually.
        {/if}
      </p>

      <p class="amount">Any amount is welcome.</p>
      <p class="thanks">Thank you for supporting independent open-source development!</p>
    {:else}
      <div class="not-configured" role="note">
        <Icon name="alert" size={13} />
        <div>
          <div class="nc-title">UPI support isn't set up in this build yet.</div>
          <div class="nc-text">
            Developers: set <code>upiId</code> and <code>payeeName</code> in <code>src/shared/support.ts</code>.
          </div>
        </div>
      </div>
    {/if}
  </div>
</dialog>

<style>
  .support-dialog {
    width: calc(100% - 24px);
    max-width: 320px;
    max-height: calc(100vh - 24px);
    padding: 0;
    overflow-y: auto;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    border-radius: 8px;
    background: var(--vscode-sideBar-background, #1e1e1e);
    color: var(--vscode-foreground, #cccccc);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    font-family: inherit;
  }

  .support-dialog[open] {
    animation: dialogIn 0.15s ease-out;
  }

  .support-dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  @keyframes dialogIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dialog-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 16px;
    text-align: center;
  }

  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
    color: var(--vscode-foreground, #ccc);
  }

  .tagline {
    margin: 0;
    width: 100%;
    font-size: 11.5px;
    font-weight: 500;
    text-align: left;
  }

  /* Always dark-on-white so phones can scan it in any theme. */
  .qr-frame {
    width: min(200px, 100%);
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
  }

  .qr {
    display: block;
    width: 100%;
    height: 100%;
  }

  .hint {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground, #888);
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin: 4px 0 0;
    padding: 8px 10px;
    background: var(--vscode-editor-background, rgba(0, 0, 0, 0.15));
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
    border-radius: 6px;
  }

  .detail-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 11.5px;
  }

  dt {
    color: var(--vscode-descriptionForeground, #888);
    flex-shrink: 0;
  }

  dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
    word-break: break-all;
  }

  .selectable {
    user-select: text;
    cursor: text;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .copy-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .copy-status {
    margin: 0;
    min-height: 14px;
    font-size: 10.5px;
    line-height: 1.35;
  }

  .copy-status.copied {
    color: var(--vscode-testing-iconPassed, #4ec9b0);
  }

  .copy-status.failed {
    color: var(--vscode-errorForeground, #f48771);
  }

  .amount {
    margin: 0;
    font-size: 11.5px;
    font-weight: 600;
  }

  .thanks {
    margin: 0;
    font-size: 11px;
    font-style: italic;
    color: var(--vscode-descriptionForeground, #888);
  }

  .not-configured {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 10px;
    text-align: left;
    border-radius: 6px;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    background: var(--vscode-editor-background, rgba(0, 0, 0, 0.15));
    color: var(--vscode-descriptionForeground, #888);
  }

  .nc-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
    margin-bottom: 2px;
  }

  .nc-text {
    font-size: 10.5px;
    line-height: 1.4;
  }

  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
  }

  @media (prefers-reduced-motion: reduce) {
    .support-dialog[open] {
      animation: none;
    }
    .copy-btn {
      transition: none;
    }
  }
</style>
