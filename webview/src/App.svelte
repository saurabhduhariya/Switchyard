<script lang="ts">
  import Header from './components/Header.svelte';
  import Footer from './components/Footer.svelte';
  import ActiveCard from './components/ActiveCard.svelte';
  import AccountCard from './components/AccountCard.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import SwitchOverlay from './components/SwitchOverlay.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Toast from './components/Toast.svelte';
  import AddAccountGuide from './components/AddAccountGuide.svelte';
  import {
    getAccounts,
    getActiveAccount,
    getOtherAccounts,
    getActiveId,
    isBusy,
    getBusyMessage,
    getError,
    getMaskEmails,
    getToast,
    getToastAccountId,
    isLoading,
    getAddAccountGuide,
    handleMessage,
  } from './stores/app.svelte';
  import { postToHost } from './lib/vscode';

  // Wire up message listener
  window.addEventListener('message', (e) => {
    if (e.data?.type) {
      handleMessage(e.data);
    }
  });

  // Tell the host we're ready
  postToHost({ type: 'ready' });
</script>

<main class="container">
  <Header />

  {#if isBusy()}
    <SwitchOverlay message={getBusyMessage()} />
  {/if}

  {#if getError()}
    <ErrorBanner message={getError()} />
  {/if}

  {#if getToast()}
    <Toast message={getToast()} accountId={getToastAccountId()} />
  {/if}

  {#if getAddAccountGuide()?.active}
    <AddAccountGuide guide={getAddAccountGuide()!} />
  {/if}

  <div class="content">
    {#if isLoading()}
      <div class="loading" aria-label="Loading accounts">
        <div class="loading-shimmer"></div>
        <div class="loading-shimmer short"></div>
      </div>
    {:else if getAccounts().length === 0 && !getAddAccountGuide()?.active}
      <EmptyState />
    {:else}

      <ul class="account-list" aria-label="Accounts">
        {#if getActiveAccount()}
          <li>
            <ActiveCard account={getActiveAccount()!} masked={getMaskEmails()} />
          </li>
        {/if}

        {#if getOtherAccounts().length > 0}
          <li class="section-label">Other Accounts</li>
          {#each getOtherAccounts() as account (account.id)}
            <li>
              <AccountCard {account} masked={getMaskEmails()} />
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>

  {#if !isLoading() && getAccounts().length > 0}
    <Footer />
  {/if}
</main>

<style>
  :root {
    --gap: 8px;
    --radius: 6px;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-sideBar-background, #1e1e1e);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(:focus-visible) {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
  }

  .container {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100vh;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .account-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--vscode-descriptionForeground, #888);
    padding: 8px 0 2px;
  }

  /* Loading shimmer */
  .loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 0;
  }

  .loading-shimmer {
    height: 52px;
    border-radius: var(--radius);
    background: linear-gradient(
      90deg,
      var(--vscode-editor-background, #252526) 25%,
      color-mix(in srgb, var(--vscode-editor-background, #252526), var(--vscode-foreground, #ccc) 8%) 50%,
      var(--vscode-editor-background, #252526) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .loading-shimmer.short {
    height: 44px;
    width: 85%;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* Scrollbar theming */
  .content::-webkit-scrollbar {
    width: 6px;
  }

  .content::-webkit-scrollbar-track {
    background: transparent;
  }

  .content::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background, rgba(255, 255, 255, 0.15));
    border-radius: 3px;
  }

  .content::-webkit-scrollbar-thumb:hover {
    background: var(--vscode-scrollbarSlider-hoverBackground, rgba(255, 255, 255, 0.25));
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-shimmer {
      animation: none;
    }
  }
</style>
