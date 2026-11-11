import { KEYS } from '../constants';
import { readKeys } from '../db/StateDb';
import { queryAgyLiveAuthStatus } from '../platform/agyDaemon';
import { decodeKeyringValue, readKeychainToken } from '../platform/keychain';
import { isWsl } from '../platform/wsl';
import {
  b64decode,
  extractEmailFromBuffer,
  hasRecognizableOAuthCredential,
  hasSignedOutSentinel,
  parseSnapshot,
} from './identity';
import { AccountIdentity, Snapshot } from './types';

export interface DetectedAuth {
  identity: AccountIdentity;
  snapshot: Snapshot;
}

/**
 * Partial detection: auth tokens are in the OS secret store, not in state.vscdb,
 * but we know the user IS signed in (profileUrl or state sync keys exist).
 * The identity may only have profileUrl, so PanelProvider must match by profileUrl
 * or fall through to saved account matching.
 */
export interface PartialDetection {
  partial: true;
  profileUrl?: string;
  availableValues: Record<string, string>;
}

export interface DetectionFailure {
  unsupported: true;
  reason: string;
  version?: string;
  missingKeys?: string[];
}

export type DetectionResult = DetectedAuth | DetectionFailure | PartialDetection;

/** Keys that indicate an active state sync session even if oauthToken is absent. */
const STATE_SYNC_SIGNAL_KEYS = [
  'antigravityUnifiedStateSync.agentPreferences',
  'antigravityUnifiedStateSync.modelPreferences',
  'antigravityUnifiedStateSync.browserPreferences',
];

function stripEmptyAndSignedOutDbValues(rawValues: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if ((k === KEYS.oauth || k === KEYS.userStatus || k === KEYS.legacyInit) && hasSignedOutSentinel(trimmed)) {
      continue;
    }
    cleaned[k] = trimmed;
  }
  return cleaned;
}

function hasAuthenticatedDbValues(dbValues: Record<string, string>): boolean {
  const oauth = dbValues[KEYS.oauth];
  if (
    oauth &&
    !hasSignedOutSentinel(oauth) &&
    (hasRecognizableOAuthCredential(oauth) ||
      Boolean(extractEmailFromBuffer(b64decode(oauth))) ||
      Boolean(extractEmailFromBuffer(Buffer.from(oauth, 'utf8'))))
  ) {
    return true;
  }

  const userStatus = dbValues[KEYS.userStatus];
  if (
    userStatus &&
    !hasSignedOutSentinel(userStatus) &&
    (Boolean(extractEmailFromBuffer(b64decode(userStatus))) ||
      Boolean(extractEmailFromBuffer(Buffer.from(userStatus, 'utf8'))) ||
      hasRecognizableOAuthCredential(userStatus))
  ) {
    return true;
  }

  const legacyInit = dbValues[KEYS.legacyInit];
  if (
    legacyInit &&
    !hasSignedOutSentinel(legacyInit) &&
    (hasRecognizableOAuthCredential(legacyInit) ||
      Boolean(extractEmailFromBuffer(b64decode(legacyInit))) ||
      Boolean(extractEmailFromBuffer(Buffer.from(legacyInit, 'utf8'))))
  ) {
    return true;
  }

  return false;
}

export interface AuthDetectorOptions {
  /** True when the active Antigravity window targets a WSL remote environment. */
  isWslRemote?: boolean;
  /** Target WSL distribution name (e.g. "Ubuntu-24.04"). */
  wslDistro?: string;
}

/**
 * Reads the active Antigravity session from OS Keychain, agy --hub daemon, or state.vscdb.
 */
export class AuthDetector {
  constructor(
    private dbPath?: string,
    private options?: AuthDetectorOptions
  ) {}

  public get databasePath(): string | undefined {
    return this.dbPath;
  }

  /**
   * Detects the currently active authentication state.
   * v2.6.0+: Reads from OS Keychain (service: gemini, username: antigravity) + agy --hub ConnectRPC.
   * v2.5.5 fallback: Reads from state.vscdb.
   */
  async detectActive(): Promise<DetectionResult> {
    const targetKeys = [
      KEYS.oauth,
      KEYS.userStatus,
      KEYS.modelCredits,
      KEYS.profileUrl,
      KEYS.legacyInit,
    ];

    const rawDbValues = this.dbPath ? await readKeys(this.dbPath, targetKeys) : {};
    const dbValues = stripEmptyAndSignedOutDbValues(rawDbValues);
    const hasLegacyAuth = hasAuthenticatedDbValues(dbValues);
    const isCaptureDb = Boolean(this.dbPath && this.dbPath.includes('switchyard-capture'));
    const wslOptions =
      !isCaptureDb && (this.options?.isWslRemote || isWsl())
        ? {
            includeWsl: true,
            preferWsl: true,
            wslDistro: this.options?.wslDistro,
            wslRunningOnly: true,
          }
        : undefined;

    // 1. Check OS Keychain + agy --hub daemon (v2.6.0+)
    const rawKeychain = readKeychainToken(wslOptions);
    const decodedKeyring = rawKeychain ? decodeKeyringValue(rawKeychain) : undefined;
    const hasStructuredKeychainToken = Boolean(
      decodedKeyring &&
        (decodedKeyring.accessToken || decodedKeyring.refreshToken || decodedKeyring.idToken)
    );
    const hasKeychainToken = Boolean(
      decodedKeyring && (hasStructuredKeychainToken || decodedKeyring.raw)
    );

    if (hasKeychainToken && rawKeychain) {
      const liveStatus = await queryAgyLiveAuthStatus(wslOptions);
      const keychainValues: Record<string, string> = {
        [KEYS.keychainToken]: rawKeychain,
      };
      if (liveStatus && (liveStatus.email || liveStatus.plan || liveStatus.authenticated)) {
        keychainValues[KEYS.agyUserStatus] = JSON.stringify(liveStatus);
      }

      const kcIdentity = parseSnapshot(keychainValues);

      // Guard against stale/non-structured keychain entries when agy daemon explicitly says signed out
      if (
        !hasStructuredKeychainToken &&
        !kcIdentity.email &&
        !hasLegacyAuth &&
        liveStatus &&
        !liveStatus.authenticated
      ) {
        return {
          unsupported: true,
          reason: 'No auth tokens found in state.vscdb (user may be signed out).',
          missingKeys: [KEYS.keychainToken, KEYS.oauth, KEYS.legacyInit],
        };
      }

      // If state.vscdb also has auth keys, merge them if they belong to the same account
      // (or if state.vscdb is the active IDE window and keychain was out of sync, prefer state.vscdb's identity)
      if (hasLegacyAuth) {
        const dbIdentity = parseSnapshot(dbValues);

        const emailsConflict =
          Boolean(dbIdentity.email && kcIdentity.email) &&
          dbIdentity.email!.toLowerCase().trim() !== kcIdentity.email!.toLowerCase().trim();

        if (emailsConflict && !isCaptureDb) {
          // The IDE window (Antigravity Settings) is signed into dbValues; do not mix with a conflicting keychain token
          return {
            identity: dbIdentity,
            snapshot: {
              values: dbValues,
              capturedAt: Date.now(),
            },
          };
        }

        const mergedValues: Record<string, string> = {
          ...dbValues,
          ...keychainValues,
        };
        const identity = parseSnapshot(mergedValues);
        return {
          identity,
          snapshot: {
            values: mergedValues,
            capturedAt: Date.now(),
          },
        };
      }

      const profileUrl = dbValues[KEYS.profileUrl];
      if (profileUrl) {
        keychainValues[KEYS.profileUrl] = profileUrl;
      }

      const identity = kcIdentity;
      return {
        identity,
        snapshot: {
          values: keychainValues,
          capturedAt: Date.now(),
        },
      };
    }

    // 2. state.vscdb Detection
    if (this.dbPath) {
      if (hasLegacyAuth) {
        const identity = parseSnapshot(dbValues);
        return {
          identity,
          snapshot: {
            values: dbValues,
            capturedAt: Date.now(),
          },
        };
      }

      const hasProfileUrl = Boolean(dbValues[KEYS.profileUrl]);
      if (hasProfileUrl) {
        return {
          partial: true,
          profileUrl: dbValues[KEYS.profileUrl],
          availableValues: dbValues,
        };
      }

      if (!isCaptureDb) {
        const rawSyncValues = await readKeys(this.dbPath, STATE_SYNC_SIGNAL_KEYS);
        const syncValues: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawSyncValues)) {
          if (typeof v === 'string' && v.trim()) {
            syncValues[k] = v;
          }
        }
        const hasSyncKeys = Object.keys(syncValues).length > 0;
        if (hasSyncKeys) {
          return {
            partial: true,
            availableValues: { ...dbValues, ...syncValues },
          };
        }
      }
    }

    return {
      unsupported: true,
      reason: 'No auth tokens found in state.vscdb (user may be signed out).',
      missingKeys: [KEYS.keychainToken, KEYS.oauth, KEYS.legacyInit],
    };
  }
}
