import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    });

    await manager.startCapture();
    const session = manager.getCurrentSession()!;
    session.state = 'detected';
    session.detectedEmail = 'captured@example.com';

    // Mock DB in capture folder
    const dbDir = path.join(session.dir, 'User', 'globalStorage');
    fs.mkdirSync(dbDir, { recursive: true });

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
});
