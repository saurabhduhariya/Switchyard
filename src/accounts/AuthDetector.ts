import { KEYS } from '../constants';
import { readKeys } from '../db/StateDb';
import { parseSnapshot } from './identity';
import { AccountIdentity, Snapshot } from './types';

export interface DetectedAuth {
  identity: AccountIdentity;
  snapshot: Snapshot;
}

export interface DetectionFailure {
  unsupported: true;
  reason: string;
}

export type DetectionResult = DetectedAuth | DetectionFailure;

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
    if (!hasAuthToken) {
      return {
        unsupported: true,
        reason: 'No auth tokens found in state.vscdb (user may be signed out).',
      };
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
}
