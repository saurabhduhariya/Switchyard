import { KEYS } from '../constants';
import { readKeys } from '../db/StateDb';
import { queryAgyLiveAuthStatus } from '../platform/agyDaemon';
import { decodeKeyringValue, readKeychainToken } from '../platform/keychain';
import { parseSnapshot } from './identity';
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

/**
 * Reads the active Antigravity session from OS Keychain, agy --hub daemon, or state.vscdb.
 */
export class AuthDetector {
  constructor(private dbPath?: string) {}

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

    const dbValues = this.dbPath ? await readKeys(this.dbPath, targetKeys) : {};
    const hasLegacyAuth = Boolean(
      dbValues[KEYS.oauth] || dbValues[KEYS.legacyInit] || dbValues[KEYS.userStatus]
    );
    const isCaptureDb = Boolean(this.dbPath && this.dbPath.includes('switchyard-capture'));

    // 1. Check OS Keychain + agy --hub daemon (v2.6.0+)
    const rawKeychain = readKeychainToken();
    const decodedKeyring = rawKeychain ? decodeKeyringValue(rawKeychain) : undefined;
    const hasKeychainToken = Boolean(
      decodedKeyring && (decodedKeyring.accessToken || decodedKeyring.refreshToken || decodedKeyring.raw)
    );

    if (hasKeychainToken && rawKeychain) {
      const liveStatus = await queryAgyLiveAuthStatus();
      const keychainValues: Record<string, string> = {
        [KEYS.keychainToken]: rawKeychain,
      };
      if (liveStatus && (liveStatus.email || liveStatus.plan || liveStatus.authenticated)) {
        keychainValues[KEYS.agyUserStatus] = JSON.stringify(liveStatus);
      }

      // If state.vscdb also has auth keys, merge them if they belong to the same account
      // (or if state.vscdb is the active IDE window and keychain was out of sync, prefer state.vscdb's identity)
      if (hasLegacyAuth) {
        const dbIdentity = parseSnapshot(dbValues);
        const kcIdentity = parseSnapshot(keychainValues);

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

      if (dbValues[KEYS.profileUrl]) {
        keychainValues[KEYS.profileUrl] = dbValues[KEYS.profileUrl];
      }

      const identity = parseSnapshot(keychainValues);
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

      const syncValues = await readKeys(this.dbPath, STATE_SYNC_SIGNAL_KEYS);
      const hasSyncKeys = Object.keys(syncValues).length > 0;
      if (hasSyncKeys) {
        return {
          partial: true,
          availableValues: { ...dbValues, ...syncValues },
        };
      }
    }

    return {
      unsupported: true,
      reason: 'No auth tokens found in state.vscdb (user may be signed out).',
      missingKeys: [KEYS.keychainToken, KEYS.oauth, KEYS.legacyInit],
    };
  }
}
