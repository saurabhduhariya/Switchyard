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
    // 1. v2.6.0+ Primary Detection: OS Keychain + agy --hub daemon
    const rawKeychain = readKeychainToken();
    const decodedKeyring = rawKeychain ? decodeKeyringValue(rawKeychain) : undefined;
    const hasKeychainToken = Boolean(
      decodedKeyring && (decodedKeyring.accessToken || decodedKeyring.refreshToken || decodedKeyring.raw)
    );

    if (hasKeychainToken && rawKeychain) {
      const liveStatus = await queryAgyLiveAuthStatus();
      // If agy --hub explicitly says unauthenticated and has no email while keychain is stale, wait or use keychain
      const values: Record<string, string> = {
        [KEYS.keychainToken]: rawKeychain,
      };

      if (liveStatus && (liveStatus.email || liveStatus.plan || liveStatus.authenticated)) {
        values[KEYS.agyUserStatus] = JSON.stringify(liveStatus);
      }

      if (this.dbPath) {
        const extra = await readKeys(this.dbPath, [KEYS.profileUrl]);
        if (extra && extra[KEYS.profileUrl]) {
          values[KEYS.profileUrl] = extra[KEYS.profileUrl];
        }
      }

      const identity = parseSnapshot(values);
      return {
        identity,
        snapshot: {
          values,
          capturedAt: Date.now(),
        },
      };
    }

    // 2. v2.5.5 Legacy Detection: state.vscdb
    if (this.dbPath) {
      const targetKeys = [
        KEYS.oauth,
        KEYS.userStatus,
        KEYS.modelCredits,
        KEYS.profileUrl,
        KEYS.legacyInit,
      ];

      const values = await readKeys(this.dbPath, targetKeys);
      const hasLegacyAuth = Boolean(values[KEYS.oauth] || values[KEYS.legacyInit] || values[KEYS.userStatus]);

      if (hasLegacyAuth) {
        const identity = parseSnapshot(values);
        return {
          identity,
          snapshot: {
            values,
            capturedAt: Date.now(),
          },
        };
      }

      // No auth tokens in state.vscdb — check if the user is signed in
      // via the OS secret store (profileUrl or state sync keys present).
      const hasProfileUrl = Boolean(values[KEYS.profileUrl]);

      if (hasProfileUrl) {
        return {
          partial: true,
          profileUrl: values[KEYS.profileUrl],
          availableValues: values,
        };
      }

      // Last resort: check for active state sync preference keys
      const syncValues = await readKeys(this.dbPath, STATE_SYNC_SIGNAL_KEYS);
      const hasSyncKeys = Object.keys(syncValues).length > 0;

      if (hasSyncKeys) {
        return {
          partial: true,
          availableValues: { ...values, ...syncValues },
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
