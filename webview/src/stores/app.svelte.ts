/**
 * Central reactive store for the Switchyard webview.
 * Receives state from the extension host via postMessage.
 */

import type { AccountMeta, ToWebview } from '../../../src/shared/messages';

// ── Reactive State (Svelte 5 runes) ──

let accounts = $state<AccountMeta[]>([]);
let activeId = $state<string | undefined>(undefined);
let busy = $state(false);
let busyMessage = $state('');
let error = $state('');
let maskEmails = $state(false);
let toast = $state('');
let toastAccountId = $state<string | undefined>(undefined);
let loading = $state(true);

// ── Getters ──

export function getAccounts(): AccountMeta[] {
  return accounts;
}

export function getActiveId(): string | undefined {
  return activeId;
}

export function getActiveAccount(): AccountMeta | undefined {
  return accounts.find((a) => a.id === activeId);
}

export function getOtherAccounts(): AccountMeta[] {
  return accounts.filter((a) => a.id !== activeId);
}

export function isBusy(): boolean {
  return busy;
}

export function getBusyMessage(): string {
  return busyMessage;
}

export function getError(): string {
  return error;
}

export function getMaskEmails(): boolean {
  return maskEmails;
}

export function getToast(): string {
  return toast;
}

export function getToastAccountId(): string | undefined {
  return toastAccountId;
}

export function isLoading(): boolean {
  return loading;
}

// ── Message Handler ──

export function handleMessage(data: ToWebview): void {
  switch (data.type) {
    case 'state':
      accounts = data.accounts;
      activeId = data.activeId;
      maskEmails = data.maskEmails ?? false;
      busy = false;
      busyMessage = '';
      loading = false;
      break;

    case 'busy':
      busy = true;
      busyMessage = data.message;
      error = '';
      break;

    case 'error':
      error = data.message;
      busy = false;
      busyMessage = '';
      break;

    case 'toast':
      toast = data.message;
      toastAccountId = data.accountId;
      break;
  }
}

export function clearError(): void {
  error = '';
}

export function clearToast(): void {
  toast = '';
  toastAccountId = undefined;
}
