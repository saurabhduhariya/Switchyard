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
  /** UI-only: this value was estimated because its reset time passed (not read from Antigravity). */
  estimated?: boolean;
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

/** Why quota could not be read. */
export type QuotaErrorKind = 'no-language-server' | 'request-failed' | 'no-data';

export interface QuotaReadError {
  kind: QuotaErrorKind;
  /** Plain-language explanation for the user (never contains tokens or raw error text). */
  message: string;
}

/** A quota read error that applies to one account, as shown in the panel. */
export interface QuotaErrorState extends QuotaReadError {
  accountId: string;
  /** epoch ms of the most recent failed attempt */
  at: number;
}

/** A tiny recent-usage summary for one model group's weekly quota. */
export interface QuotaTrendSeries {
  /** Remaining % over time, oldest first, evenly spaced (at most 24 points). */
  points: number[];
  /** How much of the weekly quota was used during the last 24 hours, in percentage points. */
  usedPercent?: number;
  /** How many hours that "used" figure actually covers (less than 24 when history is short). */
  spanHours?: number;
}

export interface QuotaTrend {
  gemini?: QuotaTrendSeries;
  claudeGpt?: QuotaTrendSeries;
}

/** A "switch to a better account" hint shown above the active card. */
export interface SwitchSuggestion {
  /** Stable id for this exact situation; used to remember a dismissal. */
  key: string;
  /** Account to switch to. */
  accountId: string;
  /** What is low on the active account, e.g. "Gemini weekly 8%". */
  lowText: string;
  /** What the suggested account has, e.g. "Gemini weekly ~100%". */
  betterText: string;
  /** true when the suggested account's numbers are estimates (its reset time passed). */
  estimated: boolean;
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

export type CaptureState =
  | 'launching'
  | 'waitingForSignIn'
  | 'detected'
  | 'finishing'
  | 'saving'
  | 'done'
  | 'cancelled'
  | 'timedOut'
  | 'failed';

export interface CaptureSessionState {
  state: CaptureState;
  detectedEmail?: string;
  diagnostic?: string;
  error?: string;
  /** Set when state === 'done' */
  savedAccountId?: string;
  savedEmail?: string;
  /** true when an already-saved account's session was refreshed instead of added */
  updated?: boolean;
  /** true when the sign-in window became this account's profile (profile mode) */
  promoted?: boolean;
  /** epoch ms when an unsaved detected account is discarded */
  expiresAt?: number;
  /** Whether the detected account is new, already saved, or the currently active one */
  detectedKind?: 'new' | 'saved' | 'active';
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
      captureSession?: CaptureSessionState;
      suggestion?: SwitchSuggestion;
      /** Recent usage per account id, for the sparklines. */
      trends?: Record<string, QuotaTrend>;
      /** Set when the signed-in account's quota could not be read. */
      quotaError?: QuotaErrorState;
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
  | { type: 'refreshQuota'; accountId?: string }
  | { type: 'saveCaptured'; label?: string }
  | { type: 'cancelCapture' }
  | { type: 'finishCapture' }
  | { type: 'dismissCapture' }
  | { type: 'dismissSuggestion'; key: string }
  | { type: 'useLegacyAdd' }
  | { type: 'reopenCaptureWindow' };

