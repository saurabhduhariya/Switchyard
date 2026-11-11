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
    env: { remoteName: undefined, appRoot: '/mock/app/root' },
    extensions: {
      getExtension: vi.fn(),
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
import { clearKeychainToken } from '../../src/platform/keychain';
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
    clearKeychainToken();
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

    await memento.update('switchyard.captureSession', { sessionId: 'stale-cap', state: 'waitingForSignIn' });

    const result = await engine.signOutAndRestart({
      previousId: 'acc-prev',
      previousEmail: 'prev@example.com',
      expectedEmail: 'new@example.com',
    });

    expect(result.ok).toBe(true);
    expect(memento.get('switchyard.captureSession')).toBeUndefined();
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

    await memento.update('switchyard.captureSession', { sessionId: 'stale-cap', state: 'waitingForSignIn' });

    const result = await engine.signOutAndRestart({
      previousId: 'acc-prev',
      previousEmail: 'prev@example.com',
      expectedEmail: 'new@example.com',
    });

    expect(result.ok).toBe(true);
    expect(memento.get('switchyard.captureSession')).toBeUndefined();
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

  it('prompts user and aborts switch if target account has a legacy <= 2.5.5 snapshot on 2.6.0+', async () => {
    vi.mocked(vscode.extensions.getExtension).mockReturnValueOnce({} as any);

    await memento.update('switchyard.accounts', [
      { id: 'acc-legacy', email: 'legacy@example.com', addedAt: Date.now(), fingerprint: '5555' },
    ]);

    await store.saveSnapshot('acc-legacy', {
      values: { [KEYS.oauth]: 'legacy-token' }, // No KEYS.keychainToken
      capturedAt: Date.now(),
    });

    vi.mocked(vscode.window.showWarningMessage)
      .mockResolvedValueOnce('Switch and Restart' as any)
      .mockResolvedValueOnce('Update Account in Side Window' as any);

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
    });

    const result = await engine.switchTo('acc-legacy');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/requires re-authentication/);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('switchyard.addNewAccount');
  });

  it('skips active session re-capture when detected email conflicts with active account', async () => {
    // Setup active account A
    const accountA = await store.upsertFromSnapshot({
      values: { [KEYS.keychainToken]: 'token-a' },
      capturedAt: Date.now(),
    });
    accountA.email = 'account-a@example.com';
    await memento.update('switchyard.accounts', [accountA]);
    await store.setActive(accountA.id);

    // Save initial snapshot for account A
    await store.saveSnapshot(accountA.id, {
      values: { [KEYS.keychainToken]: 'token-a-original' },
      capturedAt: Date.now(),
    });

    // Target account B
    const accountB = await store.upsertFromSnapshot({
      values: { [KEYS.keychainToken]: 'token-b' },
      capturedAt: Date.now(),
    });
    accountB.email = 'account-b@example.com';
    await memento.update('switchyard.accounts', [accountA, accountB]);
    await store.saveSnapshot(accountB.id, {
      values: { [KEYS.keychainToken]: 'token-b' },
      capturedAt: Date.now(),
    });

    // Mock detector detecting Account X (different email)
    const mockDetector = {
      detectActive: vi.fn().mockResolvedValue({
        identity: { email: 'different-account@example.com', fingerprint: 'fp-diff' },
        snapshot: {
          values: { [KEYS.keychainToken]: 'polluted-token' },
          capturedAt: Date.now(),
        },
      }),
    } as any;

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Switch and Restart' as any);

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      detector: mockDetector,
      spawner: vi.fn().mockReturnValue({ unref: vi.fn(), pid: 1234 } as any),
      executableFinder: () => '/mock/exe',
    });

    await engine.switchTo(accountB.id);

    // Account A's snapshot should NOT have been overwritten with polluted-token
    const snapA = await store.loadSnapshot(accountA.id);
    expect(snapA?.values[KEYS.keychainToken]).toBe('token-a-original');
  });

  it('writes job, result, and log paths under switchyard-jobs beside state.vscdb and aborts if target snapshot email mismatches', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-ok', email: 'ok@example.com', addedAt: Date.now(), fingerprint: '1111' },
      { id: 'acc-bad', email: 'wanted@example.com', addedAt: Date.now(), fingerprint: '2222' },
    ]);

    const pollutedPayload = JSON.stringify({
      id_token_email: 'other@example.com',
      token: { access_token: 'a', refresh_token: 'r-other' },
    });
    await store.saveSnapshot('acc-bad', {
      values: { [KEYS.keychainToken]: pollutedPayload },
      capturedAt: Date.now(),
    });

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Switch and Restart' as any);
    const fakeSpawner = vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() });

    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/exe',
    });

    const mismatchRes = await engine.switchTo('acc-bad');
    expect(mismatchRes.ok).toBe(false);
    expect(mismatchRes.error).toMatch(/other@example\.com/);
    expect(fakeSpawner).not.toHaveBeenCalled();

    // Valid snapshot with matching email should place job/result/log next to dbPath
    const cleanPayload = JSON.stringify({
      id_token_email: 'ok@example.com',
      token: { access_token: 'a2', refresh_token: 'r-ok' },
    });
    await store.saveSnapshot('acc-ok', {
      values: { [KEYS.keychainToken]: cleanPayload },
      capturedAt: Date.now(),
    });
    const okRes = await engine.switchTo('acc-ok');
    expect(okRes.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalledOnce();
    const spawnedJobPath = fakeSpawner.mock.calls[0][1][1] as string;
    expect(spawnedJobPath.startsWith(path.join(tmpDir, 'switchyard-jobs'))).toBe(true);
    const jobJson = JSON.parse(fs.readFileSync(spawnedJobPath, 'utf8'));
    expect(jobJson.logFile).toBe(path.join(tmpDir, 'switchyard-jobs', 'switch-helper.log'));
    expect(jobJson.resultFile.startsWith(path.join(tmpDir, 'switchyard-jobs'))).toBe(true);
  });

  it('catches keychainToken email mismatch even when antigravityUserStatus reports expected email', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-mixed', email: 'wanted@example.com', addedAt: Date.now(), fingerprint: 'fp-mixed' },
    ]);

    const wrongKeychainPayload = JSON.stringify({
      id_token_email: 'other@example.com',
      token: { access_token: 'a', refresh_token: 'r-other' },
    });
    await store.saveSnapshot('acc-mixed', {
      values: {
        [KEYS.agyUserStatus]: JSON.stringify({ email: 'wanted@example.com' }),
        [KEYS.keychainToken]: wrongKeychainPayload,
      },
      capturedAt: Date.now(),
    });

    const fakeSpawner = vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() });
    const engine = new TokenSwapEngine({
      store,
      logger,
      globalStorageUri: { fsPath: tmpDir } as any,
      memento,
      dbPath,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/exe',
    });

    const res = await engine.switchTo('acc-mixed');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/other@example\.com/);
    expect(fakeSpawner).not.toHaveBeenCalled();
  });

  it('propagates wslDistro and includeWsl to SwitchJob and helper env when in WSL remote workspace', async () => {
    await memento.update('switchyard.accounts', [
      { id: 'acc-wsl', email: 'wsl@example.com', addedAt: Date.now(), fingerprint: 'fp-wsl' },
    ]);
    await store.saveSnapshot('acc-wsl', {
      values: {
        [KEYS.keychainToken]: JSON.stringify({
          id_token_email: 'wsl@example.com',
          token: { access_token: 'a-wsl', refresh_token: 'r-wsl' },
        }),
      },
      capturedAt: Date.now(),
    });

    const origRemoteName = vscode.env.remoteName;
    const origFolders = vscode.workspace.workspaceFolders;
    (vscode.env as any).remoteName = 'wsl';
    (vscode.workspace as any).workspaceFolders = [
      { uri: { scheme: 'vscode-remote', authority: 'wsl+Ubuntu-24.04', fsPath: '/home/ubuntu/proj' } },
    ];

    try {
      const fakeSpawner = vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() });
      const engine = new TokenSwapEngine({
        store,
        logger,
        globalStorageUri: { fsPath: tmpDir } as any,
        memento,
        dbPath,
        spawner: fakeSpawner as any,
        executableFinder: () => '/mock/exe',
      });

      const res = await engine.switchTo('acc-wsl');
      expect(res.ok).toBe(true);
      expect(fakeSpawner).toHaveBeenCalledOnce();

      const spawnedJobPath = fakeSpawner.mock.calls[0][1][1] as string;
      const spawnedOptions = fakeSpawner.mock.calls[0][2] as { env?: Record<string, string> };
      const jobJson = JSON.parse(fs.readFileSync(spawnedJobPath, 'utf8'));
      expect(jobJson.includeWsl).toBe(true);
      expect(jobJson.wslDistro).toBe('Ubuntu-24.04');
      expect(spawnedOptions.env?.SWITCHYARD_WSL_DISTRO).toBe('Ubuntu-24.04');
    } finally {
      (vscode.env as any).remoteName = origRemoteName;
      (vscode.workspace as any).workspaceFolders = origFolders;
    }
  });
});

