/**
 * Central reactive store for the Switchyard webview.
 * Receives state from the extension host via postMessage.
 */

import type {
  AccountMeta,
  AddAccountGuideState,
  CaptureSessionState,
  QuotaErrorState,
  QuotaTrend,
  SwitchSuggestion,
  ToWebview,
} from '../../../src/shared/messages';
import { getVsCodeApi } from '../lib/vscode';

// ── Reactive State (Svelte 5 runes) ──

let accounts = $state<AccountMeta[]>([]);
let activeId = $state<string | undefined>(undefined);
let busy = $state(false);
let busyMessage = $state('');
let error = $state('');
let maskEmails = $state(false);
let mode = $state<'profile' | 'tokenSwap'>('profile');
let addAccountMethod = $state<'sideWindow' | 'signOutRestart'>('sideWindow');
let confirmBeforeSwitch = $state(true);
let backupRetention = $state(5);
let currentView = $state<'accounts' | 'settings'>('accounts');
let toast = $state('');
let toastAccountId = $state<string | undefined>(undefined);
let loading = $state(true);
let addAccountGuide = $state<AddAccountGuideState | undefined>(undefined);
let unsupported = $state<{ reason: string; version?: string } | undefined>(undefined);
let captureSession = $state<CaptureSessionState | undefined>(undefined);
let suggestion = $state<SwitchSuggestion | undefined>(undefined);
let trends = $state<Record<string, QuotaTrend>>({});
let quotaError = $state<QuotaErrorState | undefined>(undefined);

// Compact view is a per-user display preference, kept in the webview's own state.
// Defaults to compact (inactive accounts as one short row with two bars); a saved
// choice from the header toggle always wins.
function loadCompactView(): boolean {
  try {
    const saved = getVsCodeApi()?.getState() as { compactView?: boolean } | undefined;
    return saved?.compactView !== false;
  } catch {
    return true;
  }
}
let compactView = $state(loadCompactView());

// ── Getters & Setters ──

export function isCompactView(): boolean {
  return compactView;
}

export function setCompactView(value: boolean): void {
  compactView = value;
  try {
    const api = getVsCodeApi();
    const previous = (api?.getState() as Record<string, unknown> | undefined) ?? {};
    api?.setState({ ...previous, compactView: value });
  } catch {
    // state persistence is best effort
  }
}


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

export function getAddAccountMethod(): 'sideWindow' | 'signOutRestart' {
  return addAccountMethod;
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

export function getTrend(accountId: string): QuotaTrend | undefined {
  return trends[accountId];
}

export function getQuotaError(): QuotaErrorState | undefined {
  return quotaError;
}

export function getSuggestion(): SwitchSuggestion | undefined {
  return suggestion;
}

export function getCaptureSession(): CaptureSessionState | undefined {
  return captureSession;
}

// ── Refresh feedback ──
// The refresh icons spin from the click until the host sends fresh state.
let refreshing = $state(false);
let refreshStartedAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const MIN_SPIN_MS = 600;
const MAX_SPIN_MS = 15_000;

export function isRefreshing(): boolean {
  return refreshing;
}

export function startRefresh(): void {
  refreshing = true;
  refreshStartedAt = Date.now();
  clearTimeout(refreshTimer);
  // Never spin forever if the host does not answer.
  refreshTimer = setTimeout(() => (refreshing = false), MAX_SPIN_MS);
}

function finishRefresh(): void {
  if (!refreshing) return;
  clearTimeout(refreshTimer);
  // Keep spinning briefly so a fast refresh is still visible.
  const left = MIN_SPIN_MS - (Date.now() - refreshStartedAt);
  refreshTimer = setTimeout(() => (refreshing = false), Math.max(0, left));
}

// ── Message Handler ──

export function handleMessage(data: ToWebview): void {
  switch (data.type) {
    case 'state':
      accounts = data.accounts;
      activeId = data.activeId;
      maskEmails = data.maskEmails ?? false;
      mode = data.mode ?? 'profile';
      addAccountMethod = data.addAccountMethod ?? 'sideWindow';
      confirmBeforeSwitch = data.confirmBeforeSwitch ?? true;
      backupRetention = data.backupRetention ?? 5;
      addAccountGuide = data.addAccountGuide;
      unsupported = data.unsupported;
      captureSession = data.captureSession;
      suggestion = data.suggestion;
      trends = data.trends ?? {};
      quotaError = data.quotaError;
      finishRefresh();
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
      finishRefresh();
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
