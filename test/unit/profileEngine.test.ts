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
      joinPath: vi.fn((...parts: any[]) => ({ fsPath: parts.map((p) => p?.fsPath || p).join('/') })),
    },
  };
});

import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { ProfileEngine } from '../../src/switch/ProfileEngine';
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

describe('switch/ProfileEngine', () => {
  let tmpDir: string;
  let globalStorageDir: string;
  let userDir: string;
  let store: AccountStore;
  let memento: MemoryMemento;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `test-profile-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    userDir = path.join(tmpDir, 'User');
    globalStorageDir = path.join(userDir, 'globalStorage', 'saurabh.ag-switchyard');
    fs.mkdirSync(globalStorageDir, { recursive: true });

    memento = new MemoryMemento();
    store = new AccountStore({
      secrets: new MemorySecretStorage(),
      state: memento,
    });

    const fakeChannel = {
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      name: 'Test',
      replace: vi.fn(),
    };
    logger = new Logger(fakeChannel as any);
  });

  it('computes correct profile directory', () => {
    const engine = new ProfileEngine({
      store,
      logger,
      globalStorageUri: { fsPath: globalStorageDir } as any,
      memento,
    });

    const profileDir = engine.getProfileDir('acc-123');
    expect(profileDir).toBe(path.join(tmpDir, 'User', 'globalStorage', 'profiles', 'acc-123'));
  });

  it('returns error when account is not found in store', async () => {
    const engine = new ProfileEngine({
      store,
      logger,
      globalStorageUri: { fsPath: globalStorageDir } as any,
      memento,
    });

    const result = await engine.switchTo('non-existent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('detects already open window and skips spawn', async () => {
    // Seed an account
    await memento.update('switchyard.accounts', [
      {
        id: 'acc-1',
        email: 'user1@example.com',
        addedAt: Date.now(),
        fingerprint: '111111',
      },
    ]);

    // Track current process PID as running
    await memento.update('switchyard.profilePids', {
      'acc-1': process.pid,
    });

    const fakeSpawner = vi.fn();
    const engine = new ProfileEngine({
      store,
      logger,
      globalStorageUri: { fsPath: globalStorageDir } as any,
      memento,
      spawner: fakeSpawner as any,
    });

    const result = await engine.switchTo('acc-1');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Already open');
    expect(fakeSpawner).not.toHaveBeenCalled();
  });

  it('launches isolated profile with correct launch arguments', async () => {
    // Seed an account
    await memento.update('switchyard.accounts', [
      {
        id: 'acc-work',
        email: 'work@company.com',
        addedAt: Date.now() - 1000,
        fingerprint: '222222',
      },
    ]);

    let capturedCommand = '';
    let capturedArgs: string[] = [];

    const fakeChild = {
      pid: 42424,
      unref: vi.fn(),
    } as unknown as ChildProcess;

    const fakeSpawner = vi.fn((cmd: string, args: string[]) => {
      capturedCommand = cmd;
      capturedArgs = args;
      return fakeChild;
    });

    const engine = new ProfileEngine({
      store,
      logger,
      globalStorageUri: { fsPath: globalStorageDir } as any,
      memento,
      spawner: fakeSpawner as any,
      executableFinder: () => '/mock/bin/antigravity-ide',
    });

    const result = await engine.switchTo('acc-work', { folders: ['/my/project'] });
    expect(result.ok).toBe(true);
    expect(fakeSpawner).toHaveBeenCalledOnce();
    expect(capturedCommand).toBe('/mock/bin/antigravity-ide');

    const profileDir = engine.getProfileDir('acc-work');
    expect(capturedArgs).toContain('--user-data-dir');
    expect(capturedArgs).toContain(profileDir);
    expect(capturedArgs).toContain('--new-window');
    expect(capturedArgs).toContain('/my/project');
    expect(fakeChild.unref).toHaveBeenCalled();

    // Verify tracked PID
    const pids = memento.get<Record<string, number>>('switchyard.profilePids');
    expect(pids['acc-work']).toBe(42424);

    // Verify lastUsedAt was touched
    const acc = await store.get('acc-work');
    expect(acc?.lastUsedAt).toBeDefined();
    expect(acc!.lastUsedAt!).toBeGreaterThan(0);
  });

  it('copies user settings into profile directory', async () => {
    // Seed an account
    await memento.update('switchyard.accounts', [
      {
        id: 'acc-settings',
        email: 'settings@example.com',
        addedAt: Date.now(),
        fingerprint: '333333',
      },
    ]);

    // Create source configuration files in User directory
    fs.writeFileSync(path.join(userDir, 'settings.json'), '{"editor.fontSize": 14}');
    fs.writeFileSync(path.join(userDir, 'keybindings.json'), '[{"key": "ctrl+k"}]');
    const snippetsDir = path.join(userDir, 'snippets');
    fs.mkdirSync(snippetsDir, { recursive: true });
    fs.writeFileSync(path.join(snippetsDir, 'ts.json'), '{"prefix": "cl"}');

    const engine = new ProfileEngine({
      store,
      logger,
      globalStorageUri: { fsPath: globalStorageDir } as any,
      memento,
    });

    const result = await engine.copySettingsToProfile('acc-settings');
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3); // settings.json + keybindings.json + snippets/ts.json

    const profileDir = engine.getProfileDir('acc-settings');
    const targetSettings = path.join(profileDir, 'User', 'settings.json');
    const targetKeybindings = path.join(profileDir, 'User', 'keybindings.json');
    const targetSnippet = path.join(profileDir, 'User', 'snippets', 'ts.json');

    expect(fs.existsSync(targetSettings)).toBe(true);
    expect(fs.readFileSync(targetSettings, 'utf8')).toBe('{"editor.fontSize": 14}');
    expect(fs.existsSync(targetKeybindings)).toBe(true);
    expect(fs.readFileSync(targetKeybindings, 'utf8')).toBe('[{"key": "ctrl+k"}]');
    expect(fs.existsSync(targetSnippet)).toBe(true);
    expect(fs.readFileSync(targetSnippet, 'utf8')).toBe('{"prefix": "cl"}');
  });

  it('Exit Criterion 4: ProfileEngine does NOT import anything from db/ or read tokens', () => {
    const profileEngineSource = fs.readFileSync(
      path.join(__dirname, '../../src/switch/ProfileEngine.ts'),
      'utf8'
    );

    // Assert no imports from db/
    expect(profileEngineSource).not.toMatch(/from\s+['"].*\/db/);
    expect(profileEngineSource).not.toMatch(/StateDb/);
    expect(profileEngineSource).not.toMatch(/sql\.js/);
    expect(profileEngineSource).not.toMatch(/oauthToken/);
  });
});
