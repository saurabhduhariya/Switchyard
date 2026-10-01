/**
 * Central constants for Switchyard.
 * Keys inspected from Antigravity IDE state.vscdb and extension storage.
 */

export const KEYS = {
  oauth: 'antigravityUnifiedStateSync.oauthToken',
  userStatus: 'antigravityUnifiedStateSync.userStatus',
  modelCredits: 'antigravityUnifiedStateSync.modelCredits',
  profileUrl: 'antigravity.profileUrl',
  legacyInit: 'jetskiStateSync.agentManagerInitState',
} as const;

export const SECRET_PREFIX = 'switchyard.snapshot.';
export const ACCOUNTS_STATE_KEY = 'switchyard.accounts';
export const ACTIVE_ACCOUNT_STATE_KEY = 'switchyard.activeId';
export const DEFAULT_BACKUP_RETENTION = 5;
export const OUTPUT_CHANNEL_NAME = 'Switchyard';
