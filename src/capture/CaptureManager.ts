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
  CAPTURE_FLUSH_WAIT_MS,
  CAPTURE_DETECTED_TTL_MS,
  CAPTURE_DONE_LINGER_MS,
  CAPTURE_STALE_SWEEP_MS,
} from '../constants';
import { findExecutable, getSharedExtensionsDir } from '../platform/ide';
import { ProcessSpawner, spawnIsolatedWindow } from '../platform/launch';
import { getCaptureDir, getCaptureRoot, getProfilesDir } from '../platform/paths';
import { Logger } from '../util/logger';
import { sanitizeCaptureLaunchArgs } from './launchArgs';
import { CaptureWatcher, CaptureWatchStatus } from './CaptureWatcher';
import { findCaptureMainPids, forceKill, requestGracefulClose } from './processes';

export type CaptureState =
  | 'launching'
  | 'waitingForSignIn'
  | 'detected'
  | 'finishing'
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
  /** Human-readable hint about why sign-in has not been detected yet. */
  diagnostic?: string;
  error?: string;
  /** Profile mode: keep the sign-in window's data as this account's profile. */
  promoteToProfile?: boolean;
  /** When the account was detected (epoch ms); drives the unsaved-account expiry. */
  detectedAt?: number;
  savedAccountId?: string;
  savedEmail?: string;
  updated?: boolean;
  promoted?: boolean;
  /** Window (extension host) that owns this session; other windows must not touch it. */
  ownerId?: string;
  /** Last time the owner proved it is alive (epoch ms). */
  heartbeatAt?: number;
  /** Whether the detected account is new, already saved, or the currently active one. */
  detectedKind?: 'new' | 'saved' | 'active';
}

export interface StartCaptureOptions {
  promoteToProfile?: boolean;
}

export interface CaptureManagerOptions {
  store: AccountStore;
  logger: Logger;
  globalStorageUri: vscode.Uri;
  extensionUri?: vscode.Uri;
  memento: MementoLike;
  spawner?: ProcessSpawner;
  executableFinder?: (customPath?: string) => string;
  /** Test seam: finds the real window process ids for a capture dir. */
  processFinder?: (dir: string) => Promise<number[]>;
  /** Test seam: how long a detected-but-unsaved account is kept. */
  detectedTtlMs?: number;
  /** Identifies this window; defaults to a random id per activation. */
  windowId?: string;
  /** A session whose owner has not sent a heartbeat for this long is considered abandoned. */
  ownerStaleMs?: number;
  /** How often to look for the side-window process while closing it (ms). */
  processPollMs?: number;
  /** How long to wait for the side window to exit before giving up (ms). */
  closeWaitMs?: number;
  /** Test seam / override for extra side-window launch flags. */
  launchArgsProvider?: () => string[];
}

const ACTIVE_STATES = ['launching', 'waitingForSignIn', 'detected', 'finishing', 'saving'];
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_OWNER_STALE_MS = 20000;

type Ownership = 'mine' | 'foreign-live' | 'foreign-stale';

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
  private processFinder: (dir: string) => Promise<number[]>;
  private detectedTtlMs: number;
  private windowId: string;
  private ownerStaleMs: number;
  private launchArgsProvider: () => string[];
  private processPollMs: number;
  private closeWaitMs: number;
  private heartbeatTimer?: NodeJS.Timeout;
  private recheckTimer?: NodeJS.Timeout;
  private detectedTimer?: NodeJS.Timeout;
  private doneTimer?: NodeJS.Timeout;

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
    this.processFinder = options.processFinder ?? findCaptureMainPids;
    this.detectedTtlMs = options.detectedTtlMs ?? CAPTURE_DETECTED_TTL_MS;
    // On Windows every process lookup starts PowerShell (~0.5s), so poll less often and wait longer.
    const isWindows = process.platform === 'win32';
    this.processPollMs = options.processPollMs ?? (isWindows ? 1000 : 400);
    this.closeWaitMs = options.closeWaitMs ?? (isWindows ? 8000 : CAPTURE_CLOSE_WAIT_MS);
    this.windowId = options.windowId ?? crypto.randomUUID();
    this.ownerStaleMs = options.ownerStaleMs ?? DEFAULT_OWNER_STALE_MS;
    this.launchArgsProvider = options.launchArgsProvider ?? (() => this.readLaunchArgsFromSettings());
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
  /** The session stored for the whole app (any window), or undefined. */
  private rawSession(): CaptureSessionData | undefined {
    return this.memento.get<CaptureSessionData>(CAPTURE_SESSION_STATE_KEY);
  }

  private ownership(session: CaptureSessionData): Ownership {
    // Sessions written before ownership existed belong to whoever reads them first.
    if (!session.ownerId || session.ownerId === this.windowId) {
      return 'mine';
    }
    const lastSeen = session.heartbeatAt ?? session.startedAt;
    const alive = ACTIVE_STATES.includes(session.state) && Date.now() - lastSeen < this.ownerStaleMs;
    return alive ? 'foreign-live' : 'foreign-stale';
  }

  /**
   * The session THIS window owns. Sessions owned by another Switchyard window are invisible
   * here, so two windows can never save, cancel or clean up each other's sign-in.
   */
  getCurrentSession(): CaptureSessionData | undefined {
    const session = this.rawSession();
    return session && this.ownership(session) === 'mine' ? session : undefined;
  }

  private readLaunchArgsFromSettings(): string[] {
    const config = vscode.workspace.getConfiguration('switchyard');
    const { args, rejected } = sanitizeCaptureLaunchArgs(
      config.get('captureWindowArgs'),
      config.get('captureWindowDisabledExtensions')
    );
    if (rejected.length > 0) {
      this.logger.warn(`Ignoring unsupported side-window launch settings: ${rejected.join(', ')}`);
    }
    return args;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const session = this.getCurrentSession();
      if (!session || !ACTIVE_STATES.includes(session.state)) {
        this.stopHeartbeat();
        return;
      }
      session.heartbeatAt = Date.now();
      void this.memento.update(CAPTURE_SESSION_STATE_KEY, session);
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Starts a new capture session by launching an isolated window.
   */
  async startCapture(options?: StartCaptureOptions): Promise<{ ok: boolean; error?: string }> {
    // Check for existing session
    const existing = this.rawSession();
    if (existing) {
      const owner = this.ownership(existing);
      if (ACTIVE_STATES.includes(existing.state) && owner !== 'foreign-stale') {
        this.logger.warn(`Capture session already in progress (${owner})`);
        return {
          ok: false,
          error:
            owner === 'foreign-live'
              ? 'A sign-in window is already open from another Switchyard window. Finish or close it first.'
              : 'A capture session is already in progress.',
        };
      }
      if (owner === 'foreign-stale' && existing.dir && fs.existsSync(existing.dir)) {
        this.logger.info(`Cleaning up abandoned capture session ${existing.sessionId}`);
        await this.cleanup(existing.dir);
      }
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
      promoteToProfile: options?.promoteToProfile === true,
    };

    await this.persistSession(session);
    this.startHeartbeat();
    this.notifyStateChange(session);

    // Spawn isolated window (no folders, opens on sign-in page)
    try {
      const child = spawnIsolatedWindow({
        exe,
        userDataDir: captureDir,
        extensionsDir,
        extraArgs: this.launchArgsProvider(),
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

  /** Moves a session to 'detected', remembers the snapshot and starts the unsaved-account expiry. */
  private async markDetected(
    session: CaptureSessionData,
    identity: { email?: string; fingerprint?: string },
    values?: Record<string, string>
  ): Promise<void> {
    if (values) {
      this.lastDetectedSnapshots.set(session.sessionId, values);
    }
    session.detectedKind = await this.classifyDetected(identity.email);
    session.state = 'detected';
    session.detectedEmail = identity.email;
    session.detectedFingerprint = identity.fingerprint;
    session.detectedAt = Date.now();
    await this.persistSession(session);
    this.notifyStateChange(session);
    this.armDetectedExpiry(session.sessionId, this.detectedTtlMs);
  }

  /** Tells the user whether the detected account is new, already saved, or already active. */
  private async classifyDetected(email?: string): Promise<'new' | 'saved' | 'active'> {
    if (!email) {
      return 'new';
    }
    try {
      const match = (await this.store.list()).find((acc) => acc.email === email);
      if (!match) {
        return 'new';
      }
      return (await this.store.activeId()) === match.id ? 'active' : 'saved';
    } catch {
      return 'new';
    }
  }

  private armDetectedExpiry(sessionId: string, delayMs: number): void {
    this.clearDetectedExpiry();
    this.detectedTimer = setTimeout(() => {
      void this.expireDetected(sessionId);
    }, Math.max(0, delayMs));
  }

  private clearDetectedExpiry(): void {
    if (this.detectedTimer) {
      clearTimeout(this.detectedTimer);
      this.detectedTimer = undefined;
    }
  }

  /** Discards a detected account that was never saved: its tokens must not linger on disk. */
  private async expireDetected(sessionId: string): Promise<void> {
    const session = this.getCurrentSession();
    if (!session || session.sessionId !== sessionId || session.state !== 'detected') {
      return;
    }
    this.logger.warn(`Detected account not saved within the time limit; discarding ${sessionId}`);
    this.detectedTimer = undefined;
    session.state = 'timedOut';
    session.error = 'The detected account was not saved in time and was discarded for security. Add it again to retry.';
    await this.persistSession(session);
    await this.cleanup(session.dir);
    this.notifyStateChange(session);
  }

  /** Clears a finished (done / failed / timed out / cancelled) session so its card disappears. */
  async dismiss(): Promise<void> {
    const session = this.getCurrentSession();
    if (!session || !['done', 'cancelled', 'timedOut', 'failed'].includes(session.state)) {
      return;
    }
    if (this.doneTimer) {
      clearTimeout(this.doneTimer);
      this.doneTimer = undefined;
    }
    await this.memento.update(CAPTURE_SESSION_STATE_KEY, undefined);
    this.notifyStateChange(session);
  }

  /**
   * Profile mode: instead of deleting the sign-in window's data, turn it into the account's
   * isolated profile so the first Switch opens already signed in. Returns false when it
   * could not (existing signed-in profile, window still open, rename blocked); the caller
   * then falls back to normal cleanup and the user signs in on first switch.
   */
  private async promoteToProfile(dir: string, accountId: string): Promise<boolean> {
    const profilesRoot = getProfilesDir(path.dirname(this.globalStorageUri.fsPath));
    const target = path.join(profilesRoot, accountId);
    try {
      if (fs.existsSync(path.join(target, 'User', 'globalStorage', 'state.vscdb'))) {
        this.logger.info(`Profile for ${accountId} already exists; keeping it`);
        return false;
      }
      if ((await this.processFinder(dir)).length > 0) {
        this.logger.warn('Capture window still open; cannot promote to profile');
        return false;
      }
      // Marker files would make the profile window think it is a capture window.
      fs.rmSync(path.join(dir, CAPTURE_MARKER_FILE), { force: true });
      fs.rmSync(path.join(dir, CAPTURE_CLOSE_REQUEST_FILE), { force: true });
      fs.mkdirSync(profilesRoot, { recursive: true });
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true }); // empty shell from an earlier attempt
      }
      for (let i = 0; i < 4; i++) {
        try {
          fs.renameSync(dir, target);
          this.logger.info(`Capture window data promoted to profile: ${target}`);
          return true;
        } catch (err) {
          if (i === 3) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 500)); // Windows file locks
        }
      }
    } catch (err) {
      this.logger.warn(`Could not promote capture data to a profile: ${err}`);
    }
    return false;
  }

  /**
   * Starts the watcher to poll for sign-in completion.
   */
  private async startWatching(session: CaptureSessionData): Promise<void> {
    const dbPath = path.join(session.dir, 'User', 'globalStorage', 'state.vscdb');

    // Start watcher
    this.watcher = new CaptureWatcher(dbPath, this.logger);
    this.watcher.onSignedInUnflushed(() => {
      const current = this.getCurrentSession();
      if (current && current.sessionId === session.sessionId && current.state === 'waitingForSignIn') {
        void this.finishSignIn();
      }
    });
    this.watcher.onStatus((status) => {
      const current = this.getCurrentSession();
      if (!current || current.sessionId !== session.sessionId || current.state !== 'waitingForSignIn') {
        return;
      }
      current.diagnostic = this.describeStatus(status);
      void this.persistSession(current).then(() => this.notifyStateChange(current));
    });
    this.watcher.onDetection(async (identity, detectedSnapshot) => {
      const current = this.getCurrentSession();
      if (!current || current.sessionId !== session.sessionId) {
        return; // Stale session
      }

      this.logger.info(`Detected sign-in: ${identity.email || identity.fingerprint}`);

      await this.markDetected(current, identity, detectedSnapshot?.values);

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

  private describeStatus(status: CaptureWatchStatus): string | undefined {
    switch (status) {
      case 'walPending':
        return 'Sign-in may still be buffered by the other window. Click "I\'ve signed in" to finish.';
      case 'partial':
        return 'Sign-in detected in the other window. Closing it to read your login...';
      case 'error':
        return 'Could not read the sign-in window data yet. Click "I\'ve signed in" once login is complete.';
      default:
        return undefined;
    }
  }

  /**
   * Manual "I've signed in" path. Closes the side window (which makes the IDE flush
   * its state), then reads the capture DB one final time. Works even when the live
   * DB cannot be read while the other window is still running.
   */
  async finishSignIn(): Promise<{ ok: boolean; error?: string }> {
    const session = this.getCurrentSession();
    if (!session || session.state !== 'waitingForSignIn') {
      return { ok: false, error: 'No capture session is waiting for sign-in.' };
    }

    this.watcher?.stop();
    this.watcher = undefined;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    session.state = 'finishing';
    session.diagnostic = undefined;
    await this.persistSession(session);
    this.notifyStateChange(session);

    try {
      await this.closeWindowAndWaitForFlush(session);

      const dbPath = path.join(session.dir, 'User', 'globalStorage', 'state.vscdb');
      const result = await new CaptureWatcher(dbPath, this.logger).readOnce();

      if (result && !('unsupported' in result) && !('partial' in result)) {
        await this.markDetected(session, result.identity, result.snapshot.values);
        return { ok: true };
      }

      const reason =
        result && 'partial' in result
          ? 'You are signed in in the side window, but the credentials are stored in the OS secret store and cannot be copied. Use the "signOutRestart" add-account method (setting: switchyard.addAccountMethod) on this system.'
          : 'No sign-in was found in the side window. Make sure login finished (you should see your account in that window), then try Add Account again.';
      this.logger.warn(`finishSignIn: ${reason}`);
      session.state = 'failed';
      session.error = reason;
      await this.persistSession(session);
      this.notifyStateChange(session);
      await this.cleanup(session.dir, session.pid);
      return { ok: false, error: reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`finishSignIn failed: ${msg}`);
      session.state = 'failed';
      session.error = msg;
      await this.persistSession(session);
      this.notifyStateChange(session);
      await this.cleanup(session.dir, session.pid);
      return { ok: false, error: msg };
    }
  }

  /**
   * Asks the side window to quit, then waits until the process is gone AND the
   * SQLite WAL has been checkpointed (or timeout). The launcher PID can be a short-lived
   * wrapper, so process exit alone is not proof the real window has flushed.
   */
  private async closeWindowAndWaitForFlush(session: CaptureSessionData): Promise<boolean> {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    fs.writeFileSync(path.join(session.dir, CAPTURE_CLOSE_REQUEST_FILE), '');

    // 1. Wait for the REAL window process (not the launcher wrapper) to exit.
    const started = Date.now();
    let askedOs = false;
    let closed = false;
    while (Date.now() - started < this.closeWaitMs) {
      const pids = await this.processFinder(session.dir);
      if (pids.length === 0) {
        closed = true;
        break;
      }
      // The companion extension should have quit the window by now; if not, ask the OS.
      if (!askedOs && Date.now() - started > 2500) {
        askedOs = true;
        this.logger.warn(`Capture window still open after 2.5s, requesting close (pids ${pids.join(',')})`);
        pids.forEach(requestGracefulClose);
      }
      await sleep(this.processPollMs);
    }
    this.logger.info(`Capture window closed=${closed} after ${Date.now() - started}ms`);

    // 2. Wait for the SQLite WAL to be checkpointed.
    const walPath = path.join(session.dir, 'User', 'globalStorage', 'state.vscdb-wal');
    const deadline = Date.now() + CAPTURE_FLUSH_WAIT_MS;
    while (Date.now() < deadline) {
      let walSize = 0;
      try {
        walSize = fs.statSync(walPath).size;
      } catch {
        walSize = 0;
      }
      if (walSize === 0) {
        break;
      }
      await sleep(250);
    }
    await sleep(300); // let the OS release file handles
    return closed;
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

    this.clearDetectedExpiry();
    session.state = 'saving';
    await this.persistSession(session);
    this.notifyStateChange(session);

    try {
      // Request window 2 to close cooperatively and wait for its DB to flush
      await this.closeWindowAndWaitForFlush(session);

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

      const hasToken = (v: Record<string, string>) => Boolean(v[KEYS.oauth] || v[KEYS.legacyInit]);

      const fromDb: Record<string, string> = fs.existsSync(dbPath)
        ? await readKeys(dbPath, targetKeys)
        : {};
      const cached = this.lastDetectedSnapshots.get(session.sessionId) ?? {};

      // Never save a snapshot without a login token: it would create an "unknown" account
      // that cannot be switched to. Prefer the final read (latest rotated token), else the
      // snapshot taken when the sign-in was detected.
      let snapshot: Record<string, string>;
      if (hasToken(fromDb)) {
        snapshot = fromDb;
      } else if (hasToken(cached)) {
        this.logger.warn('Final read had no token; using snapshot from detection time');
        snapshot = cached;
      } else {
        throw new Error(
          'The sign-in window did not provide a login token, so nothing was saved. ' +
            'Add the account again and wait for the side window to close on its own.'
        );
      }

      const identity = parseSnapshot(snapshot);
      this.logger.info(`Final capture read: token=${hasToken(snapshot)} email=${identity.email ?? 'none'}`);

      // Check if the account is already saved
      const existingAccounts = await this.store.list();
      const duplicate = identity.email
        ? existingAccounts.find((acc) => acc.email === identity.email)
        : undefined;

      let savedId: string;
      let savedEmail: string | undefined = identity.email;
      let updated = false;

      if (duplicate) {
        this.logger.info(`Account ${identity.email} already exists, refreshing snapshot`);
        await this.store.saveSnapshot(duplicate.id, {
          values: snapshot,
          capturedAt: Date.now(),
        });
        if (label || duplicate.label) {
          await this.store.updateMeta(duplicate.id, { label: label || duplicate.label });
        }
        savedId = duplicate.id;
        updated = true;
      } else {
        // Save new account (do NOT set as active)
        const meta = await this.store.upsertFromSnapshot(
          { values: snapshot, capturedAt: Date.now() },
          label
        );
        savedId = meta.id;
        savedEmail = meta.email;
        this.logger.info(`Saved new account: ${identity.email || identity.fingerprint}`);
      }

      // Profile mode: keep the window's data as the account's profile; otherwise delete it
      let promoted = false;
      if (session.promoteToProfile) {
        promoted = await this.promoteToProfile(session.dir, savedId);
      }
      if (!promoted) {
        await this.cleanup(session.dir);
      }
      this.lastDetectedSnapshots.delete(session.sessionId);

      session.state = 'done';
      session.savedAccountId = savedId;
      session.savedEmail = savedEmail;
      session.updated = updated;
      session.promoted = promoted;
      await this.persistSession(session);
      this.notifyStateChange(session);

      // Keep the card long enough for "Switch to this account", then dismiss it
      if (this.doneTimer) {
        clearTimeout(this.doneTimer);
      }
      this.doneTimer = setTimeout(() => {
        this.doneTimer = undefined;
        const cur = this.getCurrentSession();
        if (cur && cur.sessionId === session.sessionId && cur.state === 'done') {
          void this.dismiss();
        }
      }, CAPTURE_DONE_LINGER_MS);

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save account: ${msg}`);
      session.state = 'failed';
      session.error = msg;
      await this.persistSession(session);
      await this.cleanup(session.dir); // the folder holds live tokens; never leave it behind
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
    this.clearDetectedExpiry();

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    session.state = 'cancelled';
    await this.persistSession(session);
    await this.cleanup(session.dir, session.pid);

    // Clear the session so the card dismisses (a 'cancelled' card has no actions)
    await this.memento.update(CAPTURE_SESSION_STATE_KEY, undefined);
    this.notifyStateChange(session);
  }

  /**
   * Called on activation. Restores or clears a session left over from a reload/crash,
   * otherwise the card would stay stuck with no watcher running.
   */
  async resume(): Promise<void> {
    const raw = this.rawSession();
    if (!raw) {
      return;
    }

    if (this.ownership(raw) === 'foreign-live') {
      // Another Switchyard window is actively handling it. If that window is the one that
      // just reloaded, its heartbeat will go stale shortly, so look again then.
      const staleIn = (raw.heartbeatAt ?? raw.startedAt) + this.ownerStaleMs - Date.now();
      if (this.recheckTimer) {
        clearTimeout(this.recheckTimer);
      }
      this.recheckTimer = setTimeout(() => {
        this.recheckTimer = undefined;
        void this.resume();
      }, Math.max(500, staleIn + 500));
      this.recheckTimer.unref?.();
      this.logger.info('Capture session belongs to another window; leaving it alone');
      return;
    }

    // Mine, or abandoned by a window that is gone: take it over.
    const session = raw;
    if (session.ownerId !== this.windowId) {
      this.logger.info(`Adopting abandoned capture session ${session.sessionId}`);
      session.ownerId = this.windowId;
      await this.persistSession(session);
    }
    if (ACTIVE_STATES.includes(session.state)) {
      this.startHeartbeat();
    }

    const terminal = ['done', 'cancelled', 'timedOut', 'failed'];
    const dirExists = fs.existsSync(session.dir);

    if (session.state === 'waitingForSignIn' && dirExists) {
      this.logger.info(`Resuming capture session ${session.sessionId}`);
      await this.startWatching(session);
      return;
    }
    if (session.state === 'detected' && dirExists) {
      // user can still Save (final read comes from the capture DB); keep the expiry running
      const remaining = (session.detectedAt ?? Date.now()) + this.detectedTtlMs - Date.now();
      this.armDetectedExpiry(session.sessionId, remaining);
      return;
    }

    this.logger.info(`Clearing stale capture session ${session.sessionId} (${session.state})`);
    if (!terminal.includes(session.state) && dirExists) {
      await this.cleanup(session.dir, session.pid);
    }
    await this.memento.update(CAPTURE_SESSION_STATE_KEY, undefined);
    this.notifyStateChange(session);
  }

  /**
   * Reopens the capture window if the user closed it manually.
   */
  async reopenWindow(): Promise<{ ok: boolean; error?: string }> {
    const session = this.getCurrentSession();
    if (!session || session.state !== 'waitingForSignIn') {
      return { ok: false, error: 'No active capture session waiting for sign-in.' };
    }

    // Check if the real window is still alive (the spawn PID may be a launcher wrapper)
    const alive = await this.processFinder(session.dir);
    if (alive.length > 0) {
      return { ok: false, error: 'Window is still open.' };
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
        extraArgs: this.launchArgsProvider(),
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

    const staleThreshold = Date.now() - CAPTURE_STALE_SWEEP_MS;
    const raw = this.rawSession();
    const currentSession =
      raw && this.ownership(raw) !== 'foreign-stale' ? raw : undefined;

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
   * Closes any leftover capture window, deletes the capture directory and drops cached tokens.
   */
  private async cleanup(dir: string, _legacyPid?: number): Promise<void> {
    // NOTE: a persisted PID is never signalled. After an IDE restart or reboot the OS may
    // have reused it for an unrelated program. The real window is found by --user-data-dir.
    this.lastDetectedSnapshots.delete(path.basename(dir)); // do not keep tokens in memory

    // Make sure the real window is gone (the PID above may only be a launcher wrapper),
    // otherwise it would keep running with its profile deleted underneath it.
    try {
      const pids = await this.processFinder(dir);
      if (pids.length > 0) {
        this.logger.warn(`Force-closing leftover capture window (pids ${pids.join(',')})`);
        pids.forEach(forceKill);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    } catch {
      // best effort
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
    session.ownerId = session.ownerId ?? this.windowId;
    session.heartbeatAt = Date.now();
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
    this.stopHeartbeat();
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = undefined;
    }
    // Releasing the lease lets a reloaded window take the session over right away.
    const mine = this.getCurrentSession();
    if (mine && ACTIVE_STATES.includes(mine.state)) {
      mine.heartbeatAt = 0;
      void this.memento.update(CAPTURE_SESSION_STATE_KEY, mine);
    }
    this.clearDetectedExpiry();
    if (this.doneTimer) {
      clearTimeout(this.doneTimer);
      this.doneTimer = undefined;
    }
    this.watcher?.stop();
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
  }
}
