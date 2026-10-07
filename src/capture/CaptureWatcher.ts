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
export class CaptureWatcher {
  private dbPath: string;
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
   * Starts polling the capture DB for sign-in.
   */
  start(): void {
    this.logger.debug(`Starting capture watcher for: ${this.dbPath}`);

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, CAPTURE_POLL_INTERVAL_MS);

    // Also watch filesystem for hints (not relied upon alone)
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

    // Initial poll
    void this.poll();
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
   * Polls the DB once and checks for sign-in.
   */
  private async poll(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      // DB doesn't exist yet, sign-in not started
      this.resetDebounce();
      return;
    }

    try {
      const detector = new AuthDetector(this.dbPath);
      const result: DetectionResult = await detector.detectActive();

      if (!('unsupported' in result) && !('partial' in result)) {
        // Full detection (DetectedAuth: identity and snapshot available)
        await this.handleDetection(result);
      } else if ('partial' in result) {
        // Partial detection - tokens might be in OS keychain (R2 risk)
        this.logger.warn('Partial detection in capture DB - tokens may be in OS keychain');
        this.resetDebounce();
      } else if ('unsupported' in result) {
        // DB exists but no tokens yet (e.g. user hasn't signed in yet)
        this.resetDebounce();
      } else {
        // No account yet
        this.resetDebounce();
      }
    } catch (err) {
      // DB might be locked or malformed during write
      this.logger.debug(`Poll error (will retry): ${err}`);
      this.resetDebounce();
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
