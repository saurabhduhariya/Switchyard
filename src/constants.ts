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

// Capture session constants
export const CAPTURE_ROOT_DIR = 'switchyard-capture';
export const CAPTURE_MARKER_FILE = 'capture.json';
export const CAPTURE_CLOSE_REQUEST_FILE = 'close-request';
export const CAPTURE_SESSION_STATE_KEY = 'switchyard.captureSession';
export const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const CAPTURE_POLL_INTERVAL_MS = 1500; // 1.5 seconds
export const CAPTURE_CLOSE_WAIT_MS = 5000; // 5 seconds to wait for cooperative close
export const CAPTURE_DETECTED_TTL_MS = 10 * 60 * 1000; // unsaved detected account is discarded after 10 min
export const CAPTURE_DONE_LINGER_MS = 20 * 1000; // how long the "saved" card stays so the user can switch
export const CAPTURE_STALE_SWEEP_MS = 60 * 60 * 1000; // startup sweep removes capture dirs older than 1 hour
export const CAPTURE_FLUSH_WAIT_MS = 6000; // extra wait for SQLite WAL checkpoint after close
