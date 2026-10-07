import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuthDetector, DetectedAuth, DetectionResult } from '../accounts/AuthDetector';
import { AccountIdentity, Snapshot } from '../accounts/types';
import { CAPTURE_POLL_INTERVAL_MS } from '../constants';
import { Logger } from '../util/logger';

/**
 * Watches a capture window's state.vscdb for sign-in completion.
 * Implements double-read debounce to ensure stable detection.
 */
export type CaptureWatchStatus =
  | 'noDb' // capture DB not created yet (window still starting / not signed in)
  | 'signedOut' // DB exists but holds no auth keys yet
  | 'walPending' // DB exists, no auth yet, but a non-empty -wal is buffering writes
  | 'partial' // user looks signed in but tokens are not in state.vscdb (OS secret store)
  | 'full' // tokens + identity readable
  | 'error';

export class CaptureWatcher {
  private dbPath: string;
  private polling = false;
  private partialSignedInCount = 0;
  private signedInFired = false;
  private onSignedInUnflushedCallback?: () => void;
  private lastStatus?: CaptureWatchStatus;
  private onStatusCallback?: (status: CaptureWatchStatus, detail: string) => void;
  private logger: Logger;
  private pollTimer?: NodeJS.Timeout;
  private fsWatcher?: fs.FSWatcher;
  private onDetectionCallback?: (identity: AccountIdentity, snapshot?: Snapshot) => void;
  private lastDetection?: AccountIdentity;
  private consecutiveMatchCount = 0;

  constructor(dbPath: string, logger: Logger) {
    this.dbPath = dbPath;
    this.logger = logger;
  }

  /**
   * Registers callback for when a stable detection is confirmed.
   */
  onDetection(callback: (identity: AccountIdentity, snapshot?: Snapshot) => void): void {
    this.onDetectionCallback = callback;
  }

  /**
   * Registers callback fired whenever the observed status changes.
   * Used for diagnostics so the UI/logs can say WHY nothing was detected.
   */
  onStatus(callback: (status: CaptureWatchStatus, detail: string) => void): void {
    this.onStatusCallback = callback;
  }

  /**
   * Fired once when the side window is clearly signed in (profile URL present) but its
   * tokens are not yet in state.vscdb. Antigravity only writes them when the window
   * closes, so the caller should close the window and read the DB afterwards.
   */
  onSignedInUnflushed(callback: () => void): void {
    this.onSignedInUnflushedCallback = callback;
  }

  private setStatus(status: CaptureWatchStatus, detail: string): void {
    if (status === this.lastStatus) {
      return;
    }
    this.lastStatus = status;
    this.logger.info(`Capture watcher status: ${status} (${detail})`);
    this.onStatusCallback?.(status, detail);
  }

  private walBytes(): number {
    try {
      return fs.statSync(`${this.dbPath}-wal`).size;
    } catch {
      return 0;
    }
  }

  /**
   * Starts polling the capture DB for sign-in.
   */
  start(): void {
    this.logger.debug(`Starting capture watcher for: ${this.dbPath}`);

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, CAPTURE_POLL_INTERVAL_MS);

    this.attachFsWatcher();

    // Initial poll
    void this.poll();
  }

  /** Attaches fs.watch once the capture globalStorage folder exists. */
  private attachFsWatcher(): void {
    if (this.fsWatcher) {
      return;
    }
    try {
      const dbDir = path.dirname(this.dbPath);
      if (fs.existsSync(dbDir)) {
        this.fsWatcher = fs.watch(dbDir, (_eventType, filename) => {
          if (
            filename &&
            (filename === 'state.vscdb' ||
              filename.startsWith('state.vscdb-') ||
              filename.endsWith('.vscdb'))
          ) {
            // Debounce: poll sooner but still require double-read
            void this.poll();
          }
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to setup fs.watch on capture DB: ${err}`);
    }
  }

  /**
   * Stops watching.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = undefined;
    }

    this.logger.debug('Stopped capture watcher');
  }

  /**
   * Reads the capture DB once without touching debounce state.
   * Used for the manual "I've signed in" path after the window has closed.
   */
  async readOnce(): Promise<DetectionResult | undefined> {
    if (!fs.existsSync(this.dbPath)) {
      return undefined;
    }
    return new AuthDetector(this.dbPath).detectActive();
  }

  /**
   * Polls the DB once and checks for sign-in.
   */
  private async poll(): Promise<void> {
    // fs.watch bursts + the interval timer must not overlap, otherwise a single
    // state can be counted as "two consecutive reads".
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      this.attachFsWatcher();

      if (!fs.existsSync(this.dbPath)) {
        this.setStatus('noDb', 'state.vscdb not created yet');
        this.resetDebounce();
        return;
      }

      const result: DetectionResult = await new AuthDetector(this.dbPath).detectActive();

      if ('partial' in result) {
        this.setStatus(
          'partial',
          'signed in, but tokens are not in state.vscdb (likely OS secret store)'
        );
        this.resetDebounce();
        // Only a profile URL proves a real login (state-sync keys alone may exist in a fresh
        // profile). Require two consecutive reads before acting.
        if (result.profileUrl) {
          this.partialSignedInCount++;
          if (this.partialSignedInCount >= 2 && !this.signedInFired) {
            this.signedInFired = true;
            this.logger.info('Side window is signed in but tokens are unflushed; finishing automatically');
            this.onSignedInUnflushedCallback?.();
          }
        } else {
          this.partialSignedInCount = 0;
        }
      } else if ('unsupported' in result) {
        this.partialSignedInCount = 0;
        const wal = this.walBytes();
        if (wal > 0) {
          this.setStatus(
            'walPending',
            `no auth keys visible yet, but state.vscdb-wal has ${wal} bytes buffered`
          );
        } else {
          this.setStatus('signedOut', result.reason);
        }
        this.resetDebounce();
      } else {
        this.partialSignedInCount = 0;
        this.setStatus('full', 'auth tokens found');
        await this.handleDetection(result);
      }
    } catch (err) {
      // DB might be locked or malformed during write
      this.setStatus('error', String(err));
      this.resetDebounce();
    } finally {
      this.polling = false;
    }
  }

  /**
   * Handles a detection and implements double-read debounce.
   */
  private async handleDetection(result: DetectedAuth): Promise<void> {
    if (!result.identity) {
      return;
    }

    const { email, fingerprint } = result.identity;

    // Check if this matches the last detection
    if (this.lastDetection) {
      const emailMatches = email === this.lastDetection.email;
      const fingerprintMatches = fingerprint === this.lastDetection.fingerprint;

      if (emailMatches && fingerprintMatches) {
        this.consecutiveMatchCount++;

        // Require two consecutive identical reads
        if (this.consecutiveMatchCount >= 2) {
          this.logger.info(
            `Stable detection confirmed: ${email || fingerprint} (${this.consecutiveMatchCount} consecutive matches)`
          );

          // Notify callback
          if (this.onDetectionCallback) {
            this.onDetectionCallback(result.identity, result.snapshot);
          }

          // Stop watching after successful detection
          this.stop();
        }
      } else {
        // Different detection, reset counter
        this.logger.debug(`Detection changed, resetting debounce`);
        this.lastDetection = result.identity;
        this.consecutiveMatchCount = 1;
      }
    } else {
      // First detection
      this.logger.debug(`First detection: ${email || fingerprint}`);
      this.lastDetection = result.identity;
      this.consecutiveMatchCount = 1;
    }
  }

  /**
   * Resets debounce state.
   */
  private resetDebounce(): void {
    if (this.lastDetection || this.consecutiveMatchCount > 0) {
      this.lastDetection = undefined;
      this.consecutiveMatchCount = 0;
    }
  }
}
