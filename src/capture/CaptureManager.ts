import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import {
  CAPTURE_CLOSE_REQUEST_FILE,
  CAPTURE_MARKER_FILE,
  CAPTURE_SESSION_STATE_KEY,
  CAPTURE_TIMEOUT_MS,
  CAPTURE_CLOSE_WAIT_MS,
} from '../constants';
import { findExecutable, getSharedExtensionsDir } from '../platform/ide';
import { ProcessSpawner, spawnIsolatedWindow } from '../platform/launch';
import { getCaptureDir, getCaptureRoot } from '../platform/paths';
import { Logger } from '../util/logger';
import { CaptureWatcher } from './CaptureWatcher';

export type CaptureState =
  | 'launching'
  | 'waitingForSignIn'
  | 'detected'
  | 'saving'
  | 'done'
  | 'cancelled'
  | 'timedOut'
  | 'failed';

export interface CaptureSessionData {
  sessionId: string;
  dir: string;
  pid?: number;
  startedAt: number;
  state: CaptureState;
  detectedEmail?: string;
  detectedFingerprint?: string;
  error?: string;
}

export interface CaptureManagerOptions {
  store: AccountStore;
  logger: Logger;
  globalStorageUri: vscode.Uri;
  extensionUri?: vscode.Uri;
  memento: MementoLike;
  spawner?: ProcessSpawner;
  executableFinder?: (customPath?: string) => string;
}

/**
 * Manages the side-window capture flow for adding new accounts without quitting the main window.
 * Implements the state machine: launching -> waitingForSignIn -> detected -> saving -> done
 */
export class CaptureManager {
  private store: AccountStore;
  private logger: Logger;
  private globalStorageUri: vscode.Uri;
  private extensionUri?: vscode.Uri;
  private memento: MementoLike;
  private spawner: ProcessSpawner;
  private executableFinder: (customPath?: string) => string;

  private watcher?: CaptureWatcher;
  private timeoutTimer?: NodeJS.Timeout;
  private onStateChangeCallback?: (session: CaptureSessionData) => void;
  private lastDetectedSnapshots = new Map<string, Record<string, string>>();

  constructor(options: CaptureManagerOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.globalStorageUri = options.globalStorageUri;
    this.extensionUri = options.extensionUri;
    this.memento = options.memento;
    this.spawner = options.spawner ?? spawn;
    this.executableFinder = options.executableFinder ?? findExecutable;
  }

  /**
   * Registers a callback to be notified when capture state changes.
   */
  onStateChange(callback: (session: CaptureSessionData) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Returns the current capture session if one exists.
   */
  getCurrentSession(): CaptureSessionData | undefined {
    return this.memento.get<CaptureSessionData>(CAPTURE_SESSION_STATE_KEY);
  }

  /**
   * Starts a new capture session by launching an isolated window.
   */
  async startCapture(): Promise<{ ok: boolean; error?: string }> {
    // Check for existing session
    const existing = this.getCurrentSession();
    if (existing && !['done', 'cancelled', 'timedOut', 'failed'].includes(existing.state)) {
      this.logger.warn('Capture session already in progress');
      return { ok: false, error: 'A capture session is already in progress.' };
    }

    // Generate session ID
    const sessionId = `capture-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const globalStorageDir = path.dirname(this.globalStorageUri.fsPath);
    const captureDir = getCaptureDir(globalStorageDir, sessionId);

    // Create capture directory with restricted permissions
    try {
      fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create capture directory: ${msg}`);
      return { ok: false, error: `Failed to create capture directory: ${msg}` };
    }

    // Write marker file
    const markerPath = path.join(captureDir, CAPTURE_MARKER_FILE);
    try {
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ sessionId, createdAt: new Date().toISOString() }, null, 2)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to write marker file: ${msg}`);
      return { ok: false, error: `Failed to write marker file: ${msg}` };
    }

    // Resolve executable
    let exe: string;
    try {
      const config = vscode.workspace.getConfiguration('switchyard');
      const customPath = config.get<string>('executablePath');
      exe = this.executableFinder(customPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Executable resolution failed: ${msg}`);
      await this.cleanup(captureDir);
      return { ok: false, error: msg };
    }

    const extensionsDir = getSharedExtensionsDir(this.extensionUri);

    // Create initial session data
    const session: CaptureSessionData = {
      sessionId,
      dir: captureDir,
      startedAt: Date.now(),
      state: 'launching',
    };

    await this.persistSession(session);
    this.notifyStateChange(session);

    // Spawn isolated window (no folders, opens on sign-in page)
    try {
      const child = spawnIsolatedWindow({
        exe,
        userDataDir: captureDir,
        extensionsDir,
        folders: [], // Empty folders array opens sign-in page
        newWindow: true,
        spawner: this.spawner,
      });

      if (child.pid) {
        session.pid = child.pid;
        await this.persistSession(session);
      }

      this.logger.info(`Launched capture window [sessionId=${sessionId}, pid=${child.pid}]`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn capture window: ${msg}`);
      session.state = 'failed';
      session.error = msg;
      await this.persistSession(session);
      this.notifyStateChange(session);
      await this.cleanup(captureDir);
      return { ok: false, error: msg };
    }

    // Transition to waitingForSignIn and start watching
    session.state = 'waitingForSignIn';
    await this.persistSession(session);
    this.notifyStateChange(session);

    await this.startWatching(session);

    return { ok: true };
  }

  /**
   * Starts the watcher to poll for sign-in completion.
   */
  private async startWatching(session: CaptureSessionData): Promise<void> {
    const dbPath = path.join(session.dir, 'User', 'globalStorage', 'state.vscdb');

    // Start watcher
    this.watcher = new CaptureWatcher(dbPath, this.logger);
    this.watcher.onDetection(async (identity, detectedSnapshot) => {
      const current = this.getCurrentSession();
      if (!current || current.sessionId !== session.sessionId) {
        return; // Stale session
      }

      this.logger.info(`Detected sign-in: ${identity.email || identity.fingerprint}`);

      if (detectedSnapshot) {
        this.lastDetectedSnapshots.set(session.sessionId, detectedSnapshot.values);
      }

      current.state = 'detected';
      current.detectedEmail = identity.email;
      current.detectedFingerprint = identity.fingerprint;
      await this.persistSession(current);
      this.notifyStateChange(current);

      // Stop watching
      this.watcher?.stop();
      this.watcher = undefined;

      // Clear timeout
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = undefined;
      }
    });

    this.watcher.start();

    // Set timeout
    this.timeoutTimer = setTimeout(async () => {
      await this.handleTimeout(session.sessionId);
    }, CAPTURE_TIMEOUT_MS);
  }

  /**
   * Handles timeout of waitingForSignIn state.
   */
  private async handleTimeout(sessionId: string): Promise<void> {
    const session = this.getCurrentSession();
    if (!session || session.sessionId !== sessionId) {
      return;
    }

    if (session.state === 'waitingForSignIn') {
      this.logger.warn(`Capture session timed out: ${sessionId}`);
      session.state = 'timedOut';
      await this.persistSession(session);
      this.notifyStateChange(session);

      this.watcher?.stop();
      this.watcher = undefined;

      await this.cleanup(session.dir, session.pid);
    }
  }

  /**
   * Saves the detected account with optional label.
   */
  async saveAccount(label?: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.getCurrentSession();
    if (!session) {
      return { ok: false, error: 'No active capture session.' };
    }

    if (session.state !== 'detected') {
      return { ok: false, error: 'No account detected yet.' };
    }

    session.state = 'saving';
    await this.persistSession(session);
    this.notifyStateChange(session);

    try {
      // Request window 2 to close cooperatively
      const closeRequestPath = path.join(session.dir, CAPTURE_CLOSE_REQUEST_FILE);
      fs.writeFileSync(closeRequestPath, '');

      // Wait for cooperative close
      await this.waitForWindowClose(session.pid, CAPTURE_CLOSE_WAIT_MS);

      // Final read of capture DB (picks up latest tokens after flush)
      const dbPath = path.join(session.dir, 'User', 'globalStorage', 'state.vscdb');
      const { readKeys } = await import('../db/StateDb');
      const { KEYS } = await import('../constants');
      const { parseSnapshot } = await import('../accounts/identity');

      const targetKeys = [
        KEYS.oauth,
        KEYS.userStatus,
        KEYS.modelCredits,
        KEYS.profileUrl,
        KEYS.legacyInit,
      ];

      let snapshot: Record<string, string> = {};
      if (fs.existsSync(dbPath)) {
        snapshot = await readKeys(dbPath, targetKeys);
      }
      if (Object.keys(snapshot).length === 0) {
        const cached = this.lastDetectedSnapshots.get(session.sessionId);
        if (cached) {
          snapshot = cached;
        }
      }

      const identity = parseSnapshot(snapshot);

      // Check if email already exists
      const existingAccounts = await this.store.list();
      const duplicate = existingAccounts.find((acc) => acc.email === identity.email);

      if (duplicate) {
        // Offer to refresh
        this.logger.info(`Account ${identity.email} already exists, refreshing snapshot`);
        await this.store.saveSnapshot(duplicate.id, {
          values: snapshot,
          capturedAt: Date.now(),
        });
        if (label || duplicate.label) {
          await this.store.updateMeta(duplicate.id, { label: label || duplicate.label });
        }
      } else {
        // Save new account (do NOT set as active)
        await this.store.upsertFromSnapshot(
          {
            values: snapshot,
            capturedAt: Date.now(),
          },
          label
        );
        this.logger.info(`Saved new account: ${identity.email || identity.fingerprint}`);
      }

      // Cleanup and mark done
      await this.cleanup(session.dir, session.pid);
      this.lastDetectedSnapshots.delete(session.sessionId);

      session.state = 'done';
      await this.persistSession(session);
      this.notifyStateChange(session);

      // Auto-clear done session after 4s so card dismisses gracefully
      setTimeout(async () => {
        const cur = this.getCurrentSession();
        if (cur && cur.sessionId === session.sessionId && cur.state === 'done') {
          await this.memento.update(CAPTURE_SESSION_STATE_KEY, undefined);
          this.notifyStateChange({ ...session, state: 'done' });
        }
      }, 4000);

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save account: ${msg}`);
      session.state = 'failed';
      session.error = msg;
      await this.persistSession(session);
      this.notifyStateChange(session);
      return { ok: false, error: msg };
    }
  }

  /**
   * Cancels the current capture session.
   */
  async cancel(): Promise<void> {
    const session = this.getCurrentSession();
    if (!session) {
      return;
    }

    this.logger.info(`Cancelling capture session: ${session.sessionId}`);

    this.watcher?.stop();
    this.watcher = undefined;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    session.state = 'cancelled';
    await this.persistSession(session);
    this.notifyStateChange(session);

    await this.cleanup(session.dir, session.pid);
  }

  /**
   * Reopens the capture window if the user closed it manually.
   */
  async reopenWindow(): Promise<{ ok: boolean; error?: string }> {
    const session = this.getCurrentSession();
    if (!session || session.state !== 'waitingForSignIn') {
      return { ok: false, error: 'No active capture session waiting for sign-in.' };
    }

    // Check if window is still alive
    if (session.pid) {
      try {
        process.kill(session.pid, 0); // Check if process exists
        return { ok: false, error: 'Window is still open.' };
      } catch {
        // Process doesn't exist, proceed to reopen
      }
    }

    // Relaunch window
    try {
      const config = vscode.workspace.getConfiguration('switchyard');
      const customPath = config.get<string>('executablePath');
      const exe = this.executableFinder(customPath);
      const extensionsDir = getSharedExtensionsDir(this.extensionUri);

      const child = spawnIsolatedWindow({
        exe,
        userDataDir: session.dir,
        extensionsDir,
        folders: [],
        newWindow: true,
        spawner: this.spawner,
      });

      if (child.pid) {
        session.pid = child.pid;
        await this.persistSession(session);
      }

      this.logger.info(`Reopened capture window [pid=${child.pid}]`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to reopen capture window: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Cleanup old capture directories on startup (sweeper).
   */
  async sweepStaleSessions(): Promise<void> {
    const globalStorageDir = path.dirname(this.globalStorageUri.fsPath);
    const captureRoot = getCaptureRoot(globalStorageDir);

    if (!fs.existsSync(captureRoot)) {
      return;
    }

    const staleThreshold = Date.now() - 3 * 60 * 60 * 1000; // 3 hours
    const currentSession = this.getCurrentSession();

    try {
      const entries = fs.readdirSync(captureRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const sessionDir = path.join(captureRoot, entry.name);

        // Skip current session
        if (currentSession && sessionDir === currentSession.dir) {
          continue;
        }

        // Check marker file
        const markerPath = path.join(sessionDir, CAPTURE_MARKER_FILE);
        if (!fs.existsSync(markerPath)) {
          continue;
        }

        try {
          const markerContent = fs.readFileSync(markerPath, 'utf8');
          const marker = JSON.parse(markerContent);
          const createdAt = new Date(marker.createdAt).getTime();

          if (createdAt < staleThreshold) {
            this.logger.info(`Sweeping stale capture session: ${entry.name}`);
            await this.cleanup(sessionDir);
          }
        } catch {
          // Invalid marker, skip
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to sweep stale sessions: ${err}`);
    }
  }

  /**
   * Waits for the window process to exit.
   */
  private async waitForWindowClose(pid: number | undefined, timeoutMs: number): Promise<void> {
    if (!pid) {
      return;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        process.kill(pid, 0); // Check if process exists
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch {
        // Process has exited
        return;
      }
    }

    // Timeout reached, force kill
    try {
      process.kill(pid, 'SIGTERM');
      this.logger.info(`Force killed capture window PID ${pid}`);
    } catch {
      // Already dead
    }
  }

  /**
   * Cleans up capture directory and optionally kills process.
   */
  private async cleanup(dir: string, pid?: number): Promise<void> {
    // Kill process if alive
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already dead
      }
    }

    // Delete directory with retries (Windows may lock files)
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        this.logger.debug(`Cleaned up capture directory: ${dir}`);
        return;
      } catch {
        if (i === maxRetries - 1) {
          this.logger.warn(`Failed to delete capture directory after ${maxRetries} attempts: ${dir}`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  }

  /**
   * Persists session data to memento.
   */
  private async persistSession(session: CaptureSessionData): Promise<void> {
    await this.memento.update(CAPTURE_SESSION_STATE_KEY, session);
  }

  /**
   * Notifies state change callback.
   */
  private notifyStateChange(session: CaptureSessionData): void {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(session);
    }
  }

  /**
   * Disposes resources.
   */
  dispose(): void {
    this.watcher?.stop();
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
  }
}
