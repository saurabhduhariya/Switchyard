import { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultVal: any) => defaultVal),
      })),
      workspaceFolders: [],
    },
    commands: {
      executeCommand: vi.fn(),
    },
    Uri: {
      file: vi.fn((f: string) => ({ fsPath: f })),
    },
  };
});

import * as vscode from 'vscode';
import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { fingerprint } from '../../src/accounts/identity';
import { KEYS } from '../../src/constants';
import { TokenSwapEngine } from '../../src/switch/TokenSwapEngine';
import { Logger } from '../../src/util/logger';
import { writeSyntheticDb } from '../fixtures/makeDb';

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

describe('switch/TokenSwapEngine', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: AccountStore;
  let memento: MemoryMemento;
  let secrets: MemorySecretStorage;
  let logger: Logger;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-swap-test-'));
    dbPath = path.join(tmpDir, 'state.vscdb');
    await writeSyntheticDb(dbPath, {});

    memento = new MemoryMemento();
    secrets = new MemorySecretStorage();
    store = new AccountStore({ secrets, state: memento });
    logger = new Logger({ appendLine: vi.fn() } as any);
    vi.clearAllMocks();
  });

  it('fails when target account is not found in store', async () => {
    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
    });

    const result = await engine.switchTo('non-existent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('reports already active if requested account is already active', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-active', email: 'active@example.com', addedAt: Date.now(), fingerprint: '1111' },
    ]);
    await store.setActive('acc-active');

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
    });

    const result = await engine.switchTo('acc-active');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Already active');
  });

  it('aborts switch if user cancels confirmation dialog', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-2', email: 'user2@example.com', addedAt: Date.now(), fingerprint: '2222' },
    ]);

    // Mock confirmation dialog returning 'Cancel'
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Cancel' as any);

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
    });

    const result = await engine.switchTo('acc-2');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Cancelled by user');
  });

  it('errors if credentials snapshot is missing from secret storage', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-missing-creds', email: 'nocreds@example.com', addedAt: Date.now(), fingerprint: '3333' },
    ]);

    // User confirms
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Switch and Restart' as any);

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
    });

    const result = await engine.switchTo('acc-missing-creds');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Session credentials for nocreds@example.com not found/);
  });

  it('swaps tokens via process relaunch, marks pendingSwitch, and quits to restart', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-target', email: 'target@example.com', addedAt: Date.now(), fingerprint: '4444' },
    ]);

    // Seed target snapshot in secret storage
    await store.saveSnapshot('acc-target', {
      values: { [KEYS.oauth]: 'secret-token' },
      capturedAt: Date.now(),
    });

    // User confirms dialog
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Switch and Restart' as any);

    const fakeSpawner = vi.fn().mockReturnValue({ pid: 12345, unref: vi.fn() });

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity-ide',
    });

    const result = await engine.switchTo('acc-target');

    expect(result.ok).toBe(true);
    // Spawner SHOULD be called now that we always use process relaunch
    expect(fakeSpawner).toHaveBeenCalled();

    // Verify pendingSwitch was recorded in memento
    const pending = memento.get<any>('switchyard.pendingSwitch');
    expect(pending).toBeDefined();
    expect(pending.targetId).toBe('acc-target');
    expect(pending.targetEmail).toBe('target@example.com');

    // Verify quit was triggered (not reload)
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.quit');
  });

  it('signs out and restarts IDE via process relaunch', async () => {
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 12346, unref: vi.fn() });

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity-ide',
    });

    const result = await engine.signOutAndRestart({
      previousId: 'acc-prev',
      previousEmail: 'prev@example.com',
      expectedEmail: 'new@example.com',
    });

    expect(result.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalled();

    // Verify addingAccount was stored in memento
    const adding = memento.get<any>('switchyard.addingAccount');
    expect(adding).toBeDefined();
    expect(adding.previousId).toBe('acc-prev');
    expect(adding.previousEmail).toBe('prev@example.com');
    expect(adding.expectedEmail).toBe('new@example.com');

    // Verify quit was triggered (not reload)
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.quit');
  });

  it('successfully builds job, spawns helper, marks pendingSwitch, and triggers quit to restart', async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((_key: string, defaultVal: any) => defaultVal),
    } as any);

    await memento.update('switchyard.accounts', [
      { id: 'acc-target', email: 'target@example.com', addedAt: Date.now(), fingerprint: '4444' },
    ]);

    // Seed target snapshot in secret storage
    await store.saveSnapshot('acc-target', {
      values: { [KEYS.oauth]: 'secret-token' },
      capturedAt: Date.now(),
    });

    // User confirms dialog
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Switch and Restart' as any);

    let spawnedCmd = '';
    let spawnedArgs: string[] = [];
    let spawnedEnv: any = {};

    const fakeChild = {
      pid: 12345,
      unref: vi.fn(),
    } as unknown as ChildProcess;

    const fakeSpawner = vi.fn((cmd: string, args: string[], opts: any) => {
      spawnedCmd = cmd;
      spawnedArgs = args;
      spawnedEnv = opts.env;
      return fakeChild;
    });

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity-ide',
    });

    const result = await engine.switchTo('acc-target');

    expect(result.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalledOnce();
    expect(spawnedEnv.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(spawnedEnv.VSCODE_IPC_HOOK).toBeUndefined();

    // Verify pendingSwitch was recorded in memento
    const pending = memento.get<any>('switchyard.pendingSwitch');
    expect(pending).toBeDefined();
    expect(pending.targetId).toBe('acc-target');
    expect(pending.targetEmail).toBe('target@example.com');
    expect(pending.resultFile).toBeDefined();

    // Verify job file was written with targetFingerprint matching snapshot values
    const jobPath = spawnedArgs[1];
    expect(fs.existsSync(jobPath)).toBe(true);
    const jobContent = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    const expectedFp = fingerprint('secret-token');
    expect(jobContent.targetFingerprint).toBe(expectedFp);

    // Verify quit was triggered
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.quit');
  });

  it('signOutAndRestart builds a job with deleteKeys, stores addingAccount in memento, and quits IDE to restart', async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((_key: string, defaultVal: any) => defaultVal),
    } as any);

    let spawnedCmd = '';
    let spawnedArgs: string[] = [];
    let spawnedEnv: any = {};

    const fakeChild = {
      pid: 54321,
      unref: vi.fn(),
    } as unknown as ChildProcess;

    const fakeSpawner = vi.fn((cmd: string, args: string[], opts: any) => {
      spawnedCmd = cmd;
      spawnedArgs = args;
      spawnedEnv = opts.env;
      return fakeChild;
    });

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/antigravity-ide',
    });

    const result = await engine.signOutAndRestart({
      previousId: 'acc-prev',
      previousEmail: 'prev@example.com',
      expectedEmail: 'new@example.com',
    });

    expect(result.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalledOnce();
    expect(spawnedEnv.ELECTRON_RUN_AS_NODE).toBe('1');

    // Verify addingAccount was stored in memento
    const adding = memento.get<any>('switchyard.addingAccount');
    expect(adding).toBeDefined();
    expect(adding.previousId).toBe('acc-prev');
    expect(adding.previousEmail).toBe('prev@example.com');
    expect(adding.expectedEmail).toBe('new@example.com');
    expect(adding.resultFile).toBeDefined();

    // Verify job file content has deleteKeys and empty target values
    const jobPath = spawnedArgs[1];
    expect(fs.existsSync(jobPath)).toBe(true);
    const jobContent = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    expect(jobContent.deleteKeys).toContain(KEYS.oauth);
    expect(jobContent.deleteKeys).toContain(KEYS.legacyInit);
    expect(jobContent.targetFingerprint).toBe('');
    expect(jobContent.values).toEqual({});

    // Verify quit was triggered
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.quit');
  });
});

