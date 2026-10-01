/**
 * Shared message contract between extension host and webview.
 * This is the single source of truth — the webview build copies
 * this file via a Vite alias or manual mirror.
 *
 * Rule: tokens NEVER cross into the webview. Only AccountMeta.
 */

export type AccountMeta = {
  id: string; // stable id (hash of email)
  email: string;
  label?: string; // "Work", "Client A"
  plan?: string; // optional, from userStatus
  addedAt: number;
  lastUsedAt?: number;
  fingerprint?: string;
};

export type ToWebview =
  | {
      type: 'state';
      accounts: AccountMeta[];
      activeId?: string;
      maskEmails?: boolean;
      mode?: 'profile' | 'tokenSwap';
    }
  | { type: 'busy'; message: string }
  | { type: 'error'; message: string }
  | { type: 'toast'; message: string; accountId?: string };

export type ToHost =
  | { type: 'ready' }
  | { type: 'switch'; id: string }
  | { type: 'add' }
  | { type: 'rename'; id: string; label: string }
  | { type: 'remove'; id: string }
  | { type: 'dismissToast' }
  | { type: 'saveDetected'; id: string }
  | { type: 'openSettings' }
  | { type: 'revealProfile'; id: string }
  | { type: 'copySettings'; id: string }
  | { type: 'import' };
