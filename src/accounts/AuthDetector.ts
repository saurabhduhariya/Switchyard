import { KEYS } from '../constants';
import { readKeys } from '../db/StateDb';
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
 * Reads the active Antigravity session from state.vscdb and resolves identity.
 */
export class AuthDetector {
  constructor(private dbPath: string) {}

  /**
   * Detects the currently active authentication state from state.vscdb.
   */
  async detectActive(): Promise<DetectionResult> {
    const targetKeys = [
      KEYS.oauth,
      KEYS.userStatus,
      KEYS.modelCredits,
      KEYS.profileUrl,
      KEYS.legacyInit,
    ];

    const values = await readKeys(this.dbPath, targetKeys);

    const hasAuthToken = Boolean(values[KEYS.oauth] || values[KEYS.legacyInit]);
    if (hasAuthToken) {
      // Full detection: auth tokens are in state.vscdb
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

    return {
      unsupported: true,
      reason: 'No auth tokens found in state.vscdb (user may be signed out).',
      missingKeys: [KEYS.oauth, KEYS.legacyInit],
    };
  }
}
