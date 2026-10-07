/**
 * Central reactive store for the Switchyard webview.
 * Receives state from the extension host via postMessage.
 */

import type { AccountMeta, AddAccountGuideState, CaptureSessionState, ToWebview } from '../../../src/shared/messages';

// ── Reactive State (Svelte 5 runes) ──

let accounts = $state<AccountMeta[]>([]);
let activeId = $state<string | undefined>(undefined);
let busy = $state(false);
let busyMessage = $state('');
let error = $state('');
let maskEmails = $state(false);
let mode = $state<'profile' | 'tokenSwap'>('profile');
let confirmBeforeSwitch = $state(true);
let backupRetention = $state(5);
let currentView = $state<'accounts' | 'settings'>('accounts');
let toast = $state('');
let toastAccountId = $state<string | undefined>(undefined);
let loading = $state(true);
let addAccountGuide = $state<AddAccountGuideState | undefined>(undefined);
let unsupported = $state<{ reason: string; version?: string } | undefined>(undefined);
let captureSession = $state<CaptureSessionState | undefined>(undefined);

// ── Getters & Setters ──

export function getView(): 'accounts' | 'settings' {
  return currentView;
}

export function setView(view: 'accounts' | 'settings'): void {
  currentView = view;
}


export function getConfirmBeforeSwitch(): boolean {
  return confirmBeforeSwitch;
}

export function getBackupRetention(): number {
  return backupRetention;
}

export function getMode(): 'profile' | 'tokenSwap' {
  return mode;
}

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
  const others = accounts.filter((a) => a.id !== activeId);
  return others.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });
}

export function getAddAccountGuide(): AddAccountGuideState | undefined {
  return addAccountGuide;
}

export function getUnsupported(): { reason: string; version?: string } | undefined {
  return unsupported;
}

export function isUnsupported(): boolean {
  return Boolean(unsupported);
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

export function getCaptureSession(): CaptureSessionState | undefined {
  return captureSession;
}

// ── Message Handler ──

export function handleMessage(data: ToWebview): void {
  switch (data.type) {
    case 'state':
      accounts = data.accounts;
      activeId = data.activeId;
      maskEmails = data.maskEmails ?? false;
      mode = data.mode ?? 'profile';
      confirmBeforeSwitch = data.confirmBeforeSwitch ?? true;
      backupRetention = data.backupRetention ?? 5;
      addAccountGuide = data.addAccountGuide;
      unsupported = data.unsupported;
      captureSession = data.captureSession;
      busy = false;
      busyMessage = '';
      loading = false;
      break;

    case 'openSettings':
      currentView = 'settings';
      break;


    case 'busy':
      busy = true;
      busyMessage = data.message;
      error = '';
      loading = false;
      break;

    case 'error':
      error = data.message;
      busy = false;
      busyMessage = '';
      loading = false;
      break;

    case 'toast':
      toast = data.message;
      toastAccountId = data.accountId;
      loading = false;
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
