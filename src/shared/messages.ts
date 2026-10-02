/**
 * Shared message contract between extension host and webview.
 * This is the single source of truth — the webview build copies
 * this file via a Vite alias or manual mirror.
 *
 * Rule: tokens NEVER cross into the webview. Only AccountMeta.
 */

export interface QuotaBucket {
  remainingFraction?: number; // 0.0 - 1.0 (e.g. 0.645962)
  remainingPercent?: number; // 0 - 100 (e.g. 64.60)
  resetTime?: string; // ISO date string
  disabled?: boolean;
}

export interface ModelQuotaGroup {
  name: string; // "Gemini" | "Claude + GPT"
  weekly?: QuotaBucket;
  fiveHour?: QuotaBucket;
  weeklyRemaining?: number; // percentage (e.g. 76.42)
  weeklyResetTime?: string; // ISO string e.g. "2026-10-02T14:36:41Z"
  rolling5hRemaining?: number;
  rolling5hResetTime?: string;
}

export interface AccountQuotaSummary {
  tierName: string; // e.g. "Google AI Pro Quota"
  gemini: ModelQuotaGroup;
  claudeGpt: ModelQuotaGroup;
  updatedAt: number; // epoch ms
  source: 'live' | 'cache' | 'vscdb';
}

export type AccountMeta = {
  id: string; // stable id (hash of email)
  email: string;
  label?: string; // "Work", "Client A"
  plan?: string; // optional, from userStatus
  addedAt: number;
  lastUsedAt?: number;
  fingerprint?: string;
  pinned?: boolean;
  quota?: AccountQuotaSummary;
};

export interface AddAccountGuideState {
  active: boolean;
  previousEmail?: string;
  previousId?: string;
  expectedEmail?: string;
}

export type ToWebview =
  | {
      type: 'state';
      accounts: AccountMeta[];
      activeId?: string;
      maskEmails?: boolean;
      mode?: 'profile' | 'tokenSwap';
      confirmBeforeSwitch?: boolean;
      backupRetention?: number;
      addAccountGuide?: AddAccountGuideState;
      unsupported?: {
        reason: string;
        version?: string;
      };
    }
  | { type: 'busy'; message: string }
  | { type: 'error'; message: string }
  | { type: 'toast'; message: string; accountId?: string }
  | { type: 'openSettings' };

export type ToHost =
  | { type: 'ready' }
  | { type: 'switch'; id: string }
  | { type: 'add' }
  | { type: 'addNewAccount' }
  | { type: 'cancelAddAccount' }
  | { type: 'signIn' }
  | { type: 'reauth'; id: string }
  | { type: 'togglePin'; id: string }
  | { type: 'rename'; id: string; label: string }
  | { type: 'remove'; id: string }
  | { type: 'dismissToast' }
  | { type: 'saveDetected'; id: string }
  | { type: 'openSettings' }
  | { type: 'openSettingsEditor' }
  | { type: 'updateSetting'; key: string; value: unknown }
  | { type: 'openBackupsFolder' }
  | { type: 'restoreBackup' }
  | { type: 'revealProfile'; id: string }
  | { type: 'copySettings'; id: string }
  | { type: 'import' }
  | { type: 'refreshQuota'; accountId?: string };

