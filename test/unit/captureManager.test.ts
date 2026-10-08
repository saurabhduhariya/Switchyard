import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultVal: any) => defaultVal),
      })),
      workspaceFolders: [],
    },
    Uri: {
      file: vi.fn((f: string) => ({ fsPath: f })),
    },
  };
});

import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { CaptureManager } from '../../src/capture/CaptureManager';
import { AuthDetector } from '../../src/accounts/AuthDetector';
import { CaptureWatcher } from '../../src/capture/CaptureWatcher';
import { CAPTURE_MARKER_FILE } from '../../src/constants';
import { getCaptureRoot } from '../../src/platform/paths';
import { Logger } from '../../src/util/logger';

class MemoryMemento implements MementoLike {
  private data = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }
    return defaultValue as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }
}

class MemorySecretStorage implements SecretStorageLike {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

describe('capture/CaptureManager', () => {
  let tmpDir: string;
  let globalStorageUri: any;
  let memento: MemoryMemento;
  let store: AccountStore;
  let logger: Logger;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-capmgr-test-'));
    globalStorageUri = { fsPath: path.join(tmpDir, 'User', 'globalStorage', 'saurabhduhariya.ag-switchyard') };
    fs.mkdirSync(globalStorageUri.fsPath, { recursive: true });

    memento = new MemoryMemento();
    store = new AccountStore({
      secrets: new MemorySecretStorage(),
      state: memento,
    });
    // Set an existing active account in window 1
    await memento.update('switchyard.accounts', [
      { id: 'acc-main', email: 'main@example.com', addedAt: Date.now() },
    ]);
    await store.setActive('acc-main');

    logger = new Logger({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as any);
  });

  it('starts capture session and writes marker file', async () => {
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() });

    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity',
    });

    const result = await manager.startCapture();
    expect(result.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalled();

    const session = manager.getCurrentSession();
    expect(session).toBeDefined();
    expect(session?.state).toBe('waitingForSignIn');
    expect(fs.existsSync(path.join(session!.dir, CAPTURE_MARKER_FILE))).toBe(true);

    manager.dispose();
  });

  it('enforces single-session lock', async () => {
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() });

    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity',
    });

    const res1 = await manager.startCapture();
    expect(res1.ok).toBe(true);

    const res2 = await manager.startCapture();
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/already in progress/);

    manager.dispose();
  });

  it('cancel() transitions session state and cleans up capture dir', async () => {
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() });

    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity',
    });

    await manager.startCapture();
    const session = manager.getCurrentSession()!;
    const dir = session.dir;

    const seen: string[] = [];
    manager.onStateChange((sess) => seen.push(sess.state));

    await manager.cancel();
    // Session is cleared so the UI card dismisses instead of sticking on "Cancelled"
    expect(manager.getCurrentSession()).toBeUndefined();
    expect(seen).toContain('cancelled');
    expect(fs.existsSync(dir)).toBe(false);

    manager.dispose();
  });

  it('INVARIANT: window 1 activeId is untouched after saving a captured account', async () => {
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() });

    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity',
      processFinder: async () => [],
    });

    await manager.startCapture();
    vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
      identity: { email: 'captured@example.com', fingerprint: 'fp-cap' },
      snapshot: {
        values: { 'antigravityUnifiedStateSync.oauthToken': 'dG9rZW4=' },
        capturedAt: Date.now(),
      },
    } as any);
    await manager.finishSignIn();

    // Save account
    await manager.saveAccount('My Work Account');

    // Check saved accounts
    const list = await store.list();
    const added = list.find((a) => a.label === 'My Work Account' || a.email === 'captured@example.com');
    expect(added).toBeDefined();

    // Verify Invariant: window 1's active account remained acc-main
    const active = await store.activeId();
    expect(active).toBe('acc-main');

    manager.dispose();
  });

  it('sweepStaleSessions removes abandoned capture directories', async () => {
    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
    });

    // Create an old capture directory
    const captureRoot = getCaptureRoot(path.dirname(globalStorageUri.fsPath));
    const oldDir = path.join(captureRoot, 'stale-session-1');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldMarker = path.join(oldDir, CAPTURE_MARKER_FILE);
    fs.writeFileSync(oldMarker, JSON.stringify({
      sessionId: 'stale-session-1',
      createdAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), // 10 hours ago
    }));

    await manager.sweepStaleSessions();
    expect(fs.existsSync(oldDir)).toBe(false);

    manager.dispose();
  });

  describe('finishSignIn()', () => {
    const makeManager = () =>
      new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
      });

    it('moves to detected when the final read finds a full login', async () => {
      const manager = makeManager();
      await manager.startCapture();
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
        identity: { email: 'new@example.com', fingerprint: 'fp-new' },
        snapshot: { values: { k: 'v' }, capturedAt: Date.now() },
      } as any);

      const result = await manager.finishSignIn();
      expect(result.ok).toBe(true);
      const session = manager.getCurrentSession()!;
      expect(session.state).toBe('detected');
      expect(session.detectedEmail).toBe('new@example.com');
      // the active account of window 1 is untouched
      expect(await store.activeId()).toBe('acc-main');
      manager.dispose();
    });

    it('fails with a clear message and cleans up when tokens are in the OS secret store', async () => {
      const manager = makeManager();
      await manager.startCapture();
      const dir = manager.getCurrentSession()!.dir;
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
        partial: true,
        availableValues: {},
      } as any);

      const result = await manager.finishSignIn();
      expect(result.ok).toBe(false);
      expect(manager.getCurrentSession()?.state).toBe('failed');
      expect(manager.getCurrentSession()?.error).toContain('secret store');
      expect(fs.existsSync(dir)).toBe(false);
      manager.dispose();
    });

    it('fails when nothing was signed in', async () => {
      const manager = makeManager();
      await manager.startCapture();
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue(undefined);

      const result = await manager.finishSignIn();
      expect(result.ok).toBe(false);
      expect(manager.getCurrentSession()?.error).toContain('No sign-in was found');
      manager.dispose();
    });

    it('rejects when no session is waiting', async () => {
      const manager = makeManager();
      const result = await manager.finishSignIn();
      expect(result.ok).toBe(false);
    });
  });

  it('resume() clears a stale session whose directory is gone', async () => {
    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: vi.fn() as any,
      executableFinder: () => '/mock/antigravity',
    });
    await memento.update('switchyard.captureSession', {
      sessionId: 's1',
      dir: path.join(tmpDir, 'missing'),
      startedAt: Date.now(),
      state: 'waitingForSignIn',
    });
    await manager.resume();
    expect(manager.getCurrentSession()).toBeUndefined();
  });

  describe('saveAccount() safety', () => {
    const mk = () =>
      new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 99999, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
        processFinder: async () => [],
      });

    const detect = async (manager: CaptureManager, values: Record<string, string>) => {
      await manager.startCapture();
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
        identity: { email: 'new@example.com', fingerprint: 'fp-new' },
        snapshot: { values, capturedAt: Date.now() },
      } as any);
      await manager.finishSignIn();
    };

    it('refuses to save an account when no login token is available (no junk "unknown" account)', async () => {
      const manager = mk();
      // detection snapshot has NO token and the capture DB does not exist
      await detect(manager, { 'antigravity.profileUrl': 'https://x/y.png' });
      const before = (await store.list()).length;

      const result = await manager.saveAccount();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('did not provide a login token');
      expect((await store.list()).length).toBe(before);
      manager.dispose();
    });

    it('falls back to the detection-time snapshot when the final read has no token', async () => {
      const manager = mk();
      await detect(manager, { 'antigravityUnifiedStateSync.oauthToken': 'dG9rZW4=' });

      const result = await manager.saveAccount('Work');
      expect(result.ok).toBe(true);
      expect((await store.activeId())).toBe('acc-main');
      manager.dispose();
    });
  });

  it('cleanup never signals a persisted (possibly recycled) PID', async () => {
    const killSpy = vi.spyOn(process, 'kill');
    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: vi.fn().mockReturnValue({ pid: 424242, unref: vi.fn() }) as any,
      executableFinder: () => '/mock/antigravity',
      processFinder: async () => [],
    });
    await manager.startCapture();
    await manager.cancel();
    expect(killSpy).not.toHaveBeenCalledWith(424242, expect.anything());
    killSpy.mockRestore();
    manager.dispose();
  });

  it('reopenWindow refuses while the real window process is alive', async () => {
    const manager = new CaptureManager({
      store,
      logger,
      globalStorageUri,
      memento,
      spawner: vi.fn().mockReturnValue({ pid: 1, unref: vi.fn() }) as any,
      executableFinder: () => '/mock/antigravity',
      processFinder: async () => [777],
    });
    await manager.startCapture();
    const res = await manager.reopenWindow();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('still open');
    manager.dispose();
  });

  describe('profile promotion, done card and expiry', () => {
    const STATUS = Buffer.from('xx promoted.user@example.com yy').toString('base64');
    const values = {
      'antigravityUnifiedStateSync.oauthToken': 'dG9rZW4=',
      'antigravityUnifiedStateSync.userStatus': STATUS,
    };

    const mk = (extra: Record<string, unknown> = {}) =>
      new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 4242, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
        processFinder: async () => [],
        ...extra,
      });

    const detect = async (manager: CaptureManager, opts?: { promoteToProfile?: boolean }) => {
      await manager.startCapture(opts);
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
        identity: { email: 'promoted.user@example.com', fingerprint: 'fp-p' },
        snapshot: { values, capturedAt: Date.now() },
      } as any);
      await manager.finishSignIn();
    };

    it('profile mode: capture folder becomes the account profile (no markers left)', async () => {
      const manager = mk();
      await detect(manager, { promoteToProfile: true });
      const dir = manager.getCurrentSession()!.dir;
      fs.mkdirSync(path.join(dir, 'User', 'globalStorage'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'User', 'globalStorage', 'sentinel.txt'), 'signed-in-data');

      const res = await manager.saveAccount('Work');
      expect(res.ok).toBe(true);

      const session = manager.getCurrentSession()!;
      expect(session.state).toBe('done');
      expect(session.promoted).toBe(true);
      expect(session.savedEmail).toBe('promoted.user@example.com');

      const profileDir = path.join(
        path.dirname(globalStorageUri.fsPath),
        'profiles',
        session.savedAccountId!
      );
      expect(fs.readFileSync(path.join(profileDir, 'User', 'globalStorage', 'sentinel.txt'), 'utf8')).toBe(
        'signed-in-data'
      );
      expect(fs.existsSync(path.join(profileDir, CAPTURE_MARKER_FILE))).toBe(false);
      expect(fs.existsSync(dir)).toBe(false);
      manager.dispose();
    });

    it('profile mode: keeps an existing signed-in profile and just deletes the capture folder', async () => {
      const manager = mk();
      await detect(manager, { promoteToProfile: true });
      const dir = manager.getCurrentSession()!.dir;

      // pre-create a signed-in profile for the same account id
      const { createAccountId } = await import('../../src/accounts/types');
      const id = createAccountId('promoted.user@example.com');
      const existing = path.join(path.dirname(globalStorageUri.fsPath), 'profiles', id, 'User', 'globalStorage');
      fs.mkdirSync(existing, { recursive: true });
      fs.writeFileSync(path.join(existing, 'state.vscdb'), 'old');

      await manager.saveAccount();
      const session = manager.getCurrentSession()!;
      expect(session.promoted).toBe(false);
      expect(fs.readFileSync(path.join(existing, 'state.vscdb'), 'utf8')).toBe('old');
      expect(fs.existsSync(dir)).toBe(false);
      manager.dispose();
    });

    it('token-swap mode never promotes', async () => {
      const manager = mk();
      await detect(manager);
      await manager.saveAccount();
      expect(manager.getCurrentSession()?.promoted).toBe(false);
      manager.dispose();
    });

    it('done state exposes the saved account id so the UI can offer "Switch"; dismiss() clears it', async () => {
      const manager = mk();
      await detect(manager);
      await manager.saveAccount();
      const session = manager.getCurrentSession()!;
      expect(session.state).toBe('done');
      expect(session.savedAccountId).toBeTruthy();
      expect(session.updated).toBe(false);

      await manager.dismiss();
      expect(manager.getCurrentSession()).toBeUndefined();
      manager.dispose();
    });

    it('marks an already-saved account as updated instead of adding a duplicate', async () => {
      const manager = mk();
      await detect(manager);
      await manager.saveAccount();
      const count = (await store.list()).length;
      await manager.dismiss();

      await detect(manager);
      await manager.saveAccount();
      expect((await store.list()).length).toBe(count);
      expect(manager.getCurrentSession()?.updated).toBe(true);
      manager.dispose();
    });

    it('discards a detected-but-unsaved account after the TTL and deletes its tokens from disk', async () => {
      const manager = mk({ detectedTtlMs: 60 });
      await detect(manager);
      const dir = manager.getCurrentSession()!.dir;
      expect(manager.getCurrentSession()?.state).toBe('detected');
      expect(fs.existsSync(dir)).toBe(true);

      await new Promise((r) => setTimeout(r, 400));
      const session = manager.getCurrentSession()!;
      expect(session.state).toBe('timedOut');
      expect(session.error).toContain('not saved in time');
      expect(fs.existsSync(dir)).toBe(false);
      manager.dispose();
    });

    it('saving cancels the expiry timer', async () => {
      const manager = mk({ detectedTtlMs: 150 });
      await detect(manager);
      await manager.saveAccount();
      await new Promise((r) => setTimeout(r, 400));
      expect(manager.getCurrentSession()?.state).toBe('done');
      manager.dispose();
    });

    it('resume() re-arms the expiry for a detected session after a reload', async () => {
      const manager = mk({ detectedTtlMs: 60 });
      await detect(manager);
      manager.dispose(); // simulate window reload: timers die, session stays in memento

      const manager2 = mk({ detectedTtlMs: 60 });
      await manager2.resume();
      await new Promise((r) => setTimeout(r, 400));
      expect(manager2.getCurrentSession()?.state).toBe('timedOut');
      manager2.dispose();
    });
  });

  describe('multi-window ownership, classification and launch args', () => {
    const mkWin = (windowId: string, extra: Record<string, unknown> = {}) =>
      new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 5, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
        processFinder: async () => [],
        windowId,
        ...extra,
      });

    it('another window cannot see, start over, or cancel a live session', async () => {
      const a = mkWin('win-A');
      const b = mkWin('win-B');
      expect((await a.startCapture()).ok).toBe(true);

      expect(a.getCurrentSession()).toBeDefined();
      expect(b.getCurrentSession()).toBeUndefined();

      const second = await b.startCapture();
      expect(second.ok).toBe(false);
      expect(second.error).toContain('another Switchyard window');

      await b.cancel(); // must be a no-op for a session it does not own
      expect(a.getCurrentSession()?.state).toBe('waitingForSignIn');
      a.dispose();
      b.dispose();
    });

    it('the sign-in folder of a live session in another window survives the startup sweep', async () => {
      const a = mkWin('win-A');
      const b = mkWin('win-B');
      await a.startCapture();
      const dir = a.getCurrentSession()!.dir;
      await b.sweepStaleSessions();
      expect(fs.existsSync(dir)).toBe(true);
      a.dispose();
      b.dispose();
    });

    it('a session abandoned by a dead window can be taken over by resume()', async () => {
      const a = mkWin('win-A');
      await a.startCapture();
      const sessionId = a.getCurrentSession()!.sessionId;
      a.dispose(); // reload/close: releases the lease

      const b = mkWin('win-B');
      await b.resume();
      expect(b.getCurrentSession()?.sessionId).toBe(sessionId);
      b.dispose();
    });

    it('a stale foreign session no longer blocks a new capture and its folder is cleaned', async () => {
      const a = mkWin('win-A');
      await a.startCapture();
      const oldDir = a.getCurrentSession()!.dir;
      // simulate a crashed window: heartbeat is long gone
      const raw = memento.get<any>('switchyard.captureSession');
      await memento.update('switchyard.captureSession', { ...raw, heartbeatAt: Date.now() - 60_000 });

      const b = mkWin('win-B');
      const res = await b.startCapture();
      expect(res.ok).toBe(true);
      expect(fs.existsSync(oldDir)).toBe(false);
      a.dispose();
      b.dispose();
    });

    it('classifies a detected account as new, saved or active', async () => {
      const STATUS = Buffer.from('xx kind.user@example.com yy').toString('base64');
      const values = {
        'antigravityUnifiedStateSync.oauthToken': 'dG9rZW4=',
        'antigravityUnifiedStateSync.userStatus': STATUS,
      };
      const run = async () => {
        const m = mkWin('win-K');
        await m.startCapture();
        vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue({
          identity: { email: 'kind.user@example.com', fingerprint: 'fp-k' },
          snapshot: { values, capturedAt: Date.now() },
        } as any);
        await m.finishSignIn();
        const kind = m.getCurrentSession()?.detectedKind;
        return { m, kind };
      };

      const first = await run();
      expect(first.kind).toBe('new');
      await first.m.saveAccount();
      await first.m.dismiss();
      first.m.dispose();

      const second = await run();
      expect(second.kind).toBe('saved');
      await second.m.saveAccount();
      await second.m.dismiss();
      second.m.dispose();

      const id = (await store.list()).find((a) => a.email === 'kind.user@example.com')!.id;
      await store.setActive(id);
      const third = await run();
      expect(third.kind).toBe('active');
      third.m.dispose();
    });

    it('passes the configured side-window flags to the launcher', async () => {
      const spawner = vi.fn().mockReturnValue({ pid: 9, unref: vi.fn() });
      const m = new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: spawner as any,
        executableFinder: () => '/mock/antigravity',
        processFinder: async () => [],
        launchArgsProvider: () => ['--skip-welcome', '--disable-extension', 'eamodio.gitlens'],
      });
      await m.startCapture();
      const args: string[] = spawner.mock.calls[0][1];
      expect(args).toContain('--skip-welcome');
      expect(args).toContain('eamodio.gitlens');
      expect(args).toContain('--user-data-dir');
      m.dispose();
    });
  });

  describe('end to end: sign-in is finished automatically', () => {
    // Earlier tests spy on prototypes without restoring; start this scenario from a clean slate.
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('watcher sees "signed in but unflushed" twice, closes the window, then detects the account', async () => {
      const STATUS = Buffer.from('xx auto.user@example.com yy').toString('base64');
      const full = {
        identity: { email: 'auto.user@example.com', fingerprint: 'fp-auto' },
        snapshot: {
          values: {
            'antigravityUnifiedStateSync.oauthToken': 'dG9rZW4=',
            'antigravityUnifiedStateSync.userStatus': STATUS,
          },
          capturedAt: Date.now(),
        },
      };
      // While the window is open only the profile is visible (tokens are written on close)
      let windowClosed = false;
      const closeRequests: string[] = [];
      vi.spyOn(AuthDetector.prototype, 'detectActive').mockImplementation(async () =>
        windowClosed ? (full as any) : ({ partial: true, profileUrl: 'https://x/a.png', availableValues: {} } as any)
      );

      const manager = new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 77, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
        // the "window" exits as soon as it is asked to close
        processFinder: async (dir: string) => {
          if (fs.existsSync(path.join(dir, 'close-request'))) {
            closeRequests.push(dir);
            windowClosed = true;
            return [];
          }
          return [1234];
        },
      });

      await manager.startCapture();
      const dir = manager.getCurrentSession()!.dir;
      // the side window creates its database
      fs.mkdirSync(path.join(dir, 'User', 'globalStorage'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'User', 'globalStorage', 'state.vscdb'), 'x');

      const deadline = Date.now() + 9000;
      while (Date.now() < deadline && manager.getCurrentSession()?.state !== 'detected') {
        await new Promise((r) => setTimeout(r, 100));
      }

      const session = manager.getCurrentSession()!;
      expect(closeRequests.length).toBeGreaterThan(0);
      expect(session.state).toBe('detected');
      expect(session.detectedEmail).toBe('auto.user@example.com');
      expect(session.detectedKind).toBe('new');
      // saving it works and leaves the active account alone
      expect((await manager.saveAccount()).ok).toBe(true);
      expect(await store.activeId()).toBe('acc-main');
      manager.dispose();
    }, 15000);

    it('uses the configured poll interval and wait budget when closing the window', async () => {
      const calls: number[] = [];
      const manager = new CaptureManager({
        store,
        logger,
        globalStorageUri,
        memento,
        spawner: vi.fn().mockReturnValue({ pid: 1, unref: vi.fn() }) as any,
        executableFinder: () => '/mock/antigravity',
        processFinder: async () => {
          calls.push(Date.now());
          return [999]; // never exits
        },
        processPollMs: 20,
        closeWaitMs: 200,
      });
      await manager.startCapture();
      vi.spyOn(CaptureWatcher.prototype, 'readOnce').mockResolvedValue(undefined);
      await manager.finishSignIn();
      // roughly closeWait / poll lookups (plus cleanup), but far fewer than a busy loop
      expect(calls.length).toBeGreaterThanOrEqual(5);
      expect(calls.length).toBeLessThan(40);
      manager.dispose();
    }, 15000);
  });
});
