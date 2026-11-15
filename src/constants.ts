export const KEYS = {
  // v2.6.0+ OS Keychain & agy daemon keys stored inside Switchyard snapshots
  keychainToken: 'agy.keychainToken',
  agyUserStatus: 'agy.userStatusJson',
  // v2.5.5 legacy state.vscdb keys
  oauth: 'antigravityUnifiedStateSync.oauthToken',
  userStatus: 'antigravityUnifiedStateSync.userStatus',
  modelCredits: 'antigravityUnifiedStateSync.modelCredits',
  profileUrl: 'antigravity.profileUrl',
  legacyInit: 'jetskiStateSync.agentManagerInitState',
} as const;

export const KEYCHAIN_SERVICE = 'gemini';
export const KEYCHAIN_ACCOUNT = 'antigravity';

export const SECRET_PREFIX = 'switchyard.snapshot.';
export const ACCOUNTS_STATE_KEY = 'switchyard.accounts';
export const ACTIVE_ACCOUNT_STATE_KEY = 'switchyard.activeId';
export const OUTPUT_CHANNEL_NAME = 'Switchyard';

export const CAPTURE_MARKER_FILE = 'capture.json';
export const CAPTURE_CLOSE_REQUEST_FILE = 'close-request';
export const CAPTURE_SESSION_STATE_KEY = 'switchyard.captureSession';
export const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;
export const CAPTURE_POLL_INTERVAL_MS = 1500;
export const CAPTURE_CLOSE_WAIT_MS = 5000;
export const CAPTURE_DETECTED_TTL_MS = 10 * 60 * 1000;
export const CAPTURE_DONE_LINGER_MS = 20 * 1000;
export const CAPTURE_STALE_SWEEP_MS = 60 * 60 * 1000;
export const CAPTURE_FLUSH_WAIT_MS = 6000;
