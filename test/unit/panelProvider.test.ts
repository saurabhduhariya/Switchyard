import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showInputBox: vi.fn(),
      createStatusBarItem: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        text: '',
        tooltip: '',
      })),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultVal: any) => defaultVal),
      })),
    },
    commands: {
      executeCommand: vi.fn(),
    },
    Uri: {
      joinPath: vi.fn((...parts: any[]) => ({ fsPath: parts.map((p) => p?.fsPath || p).join('/') })),
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
  };
});

import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { AuthDetector } from '../../src/accounts/AuthDetector';
import { SECRET_PREFIX } from '../../src/constants';
import type { ToWebview } from '../../src/shared/messages';
import { PanelProvider } from '../../src/ui/PanelProvider';
import { StatusBar } from '../../src/ui/StatusBar';
import { Logger, OutputChannelLike } from '../../src/util/logger';
import { makeSyntheticSessionEntries, writeSyntheticDb } from '../fixtures/makeDb';

class MockSecretStorage implements SecretStorageLike {
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
  has(key: string): boolean {
    return this.data.has(key);
  }
}

class MockMemento implements MementoLike {
  private data = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T {
    return this.data.has(key) ? this.data.get(key) : (defaultValue as T);
  }
  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
  }
}

class MockOutputChannel implements OutputChannelLike {
  public lines: string[] = [];
  appendLine(val: string): void {
    this.lines.push(val);
  }
}

describe('ui/PanelProvider end-to-end (Phase 4)', () => {
  let tempDir: string;
  let dbPath: string;
  let secrets: MockSecretStorage;
  let state: MockMemento;
  let store: AccountStore;
  let channel: MockOutputChannel;
  let logger: Logger;
  let statusBar: StatusBar;
  let postedMessages: ToWebview[];
  let fakeWebviewView: any;
  let fakeContext: any;
  let panelProvider: PanelProvider;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-panel-test-'));
    dbPath = path.join(tempDir, 'state.vscdb');

    secrets = new MockSecretStorage();
    state = new MockMemento();
    store = new AccountStore({ secrets, state });
    channel = new MockOutputChannel();
    logger = new Logger(channel);
    statusBar = new StatusBar();

    postedMessages = [];
    fakeWebviewView = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-webview-test:',
        asWebviewUri: vi.fn((uri: any) => uri),
        postMessage: vi.fn(async (msg: ToWebview) => {
          postedMessages.push(msg);
          return true;
        }),
        onDidReceiveMessage: vi.fn(),
      },
    };

    fakeContext = {
      extensionUri: { fsPath: '/test/ext' },
    };

    const detector = new AuthDetector(dbPath);
    panelProvider = new PanelProvider(fakeContext, store, detector, logger, statusBar);
    panelProvider.resolveWebviewView(fakeWebviewView);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('Step 4.2 First-run capture: detects unsaved account and offers toast', async () => {
    const sessionA = makeSyntheticSessionEntries({
      email: 'user-a@domain.com',
      plan: 'AI Pro',
    });
    await writeSyntheticDb(dbPath, sessionA);

    await panelProvider.detectAndRefresh();

    const toastMsg = postedMessages.find((m) => m.type === 'toast');
    expect(toastMsg).toBeDefined();
    if (toastMsg && toastMsg.type === 'toast') {
      expect(toastMsg.message).toContain('user-a@domain.com');
    }

    // Now user accepts save (handleSaveDetected)
    await panelProvider.handleSaveDetected();

    const accounts = await store.list();
    expect(accounts.length).toBe(1);
    expect(accounts[0].email).toBe('user-a@domain.com');

    const activeId = await store.activeId();
    expect(activeId).toBe(accounts[0].id);
  });

  it('Exit criterion 1: Email + ACTIVE marker follows logins across A and B', async () => {
    // 1. Save Account A
    const sessionA = makeSyntheticSessionEntries({
      email: 'alpha@domain.com',
      plan: 'AI Pro',
    });
    await writeSyntheticDb(dbPath, sessionA);
    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    let accounts = await store.list();
    const idA = accounts.find((a) => a.email === 'alpha@domain.com')?.id;
    expect(await store.activeId()).toBe(idA);

    // 2. Simulate user switching login in Antigravity to Account B
    const sessionB = makeSyntheticSessionEntries({
      email: 'beta@domain.com',
      plan: 'Pro',
    });
    await writeSyntheticDb(dbPath, sessionB);
    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    accounts = await store.list();
    expect(accounts.length).toBe(2);

    const idB = accounts.find((a) => a.email === 'beta@domain.com')?.id;
    expect(idB).toBeDefined();

    // Active marker is now Account B
    expect(await store.activeId()).toBe(idB);

    // 3. Simulate swapping back to Account A
    await writeSyntheticDb(dbPath, sessionA);
    await panelProvider.detectAndRefresh();

    // Active marker moves back to Account A automatically
    expect(await store.activeId()).toBe(idA);
  });

  it('Exit criterion 4: Remove deletes secret and removes account', async () => {
    const session = makeSyntheticSessionEntries({ email: 'to-remove@domain.com' });
    await writeSyntheticDb(dbPath, session);
    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    const accounts = await store.list();
    const id = accounts[0].id;
    const secretKey = `${SECRET_PREFIX}${id}`;

    // Verify secret is present
    expect(await secrets.get(secretKey)).toBeDefined();

    // Call store.remove
    await store.remove(id);

    // Verify secret is deleted (returns undefined)
    expect(await secrets.get(secretKey)).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('Exit criterion 3: Output channel contains no secrets and no oauthToken values', async () => {
    const session = makeSyntheticSessionEntries({ email: 'secret-audit@domain.com' });
    await writeSyntheticDb(dbPath, session);

    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    const fullLog = channel.lines.join('\n');
    expect(fullLog).not.toContain('ya29.');
    expect(fullLog).not.toContain('synthetic-access-token');
    expect(fullLog).not.toContain('ChV1c2VyU3RhdHVz');
  });

  it('prevents infinite detection loop when database content hash is unchanged', async () => {
    const session = makeSyntheticSessionEntries({ email: 'loop-test@domain.com' });
    await writeSyntheticDb(dbPath, session);

    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    const saveSpy = vi.spyOn(store, 'saveSnapshot');

    // Run detectAndRefresh again with identical content
    await panelProvider.detectAndRefresh();
    await panelProvider.detectAndRefresh();

    // saveSnapshot should not be called in a loop because contentHash is unchanged
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('delegates handleSwitch and handleRevealProfile to SwitchEngine', async () => {
    const session = makeSyntheticSessionEntries({ email: 'switch-test@domain.com' });
    await writeSyntheticDb(dbPath, session);
    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    const accounts = await store.list();
    const id = accounts[0].id;

    const mockSwitchEngine = {
      mode: 'profile' as const,
      switchTo: vi.fn(async () => ({ ok: true, mode: 'profile' as const })),
      revealProfile: vi.fn(async () => {}),
      copySettingsToProfile: vi.fn(async () => ({ ok: true, count: 2 })),
    };

    panelProvider.setSwitchEngine(mockSwitchEngine);

    await panelProvider.handleSwitch(id);
    expect(mockSwitchEngine.switchTo).toHaveBeenCalledWith(id);

    await panelProvider.handleRevealProfile(id);
    expect(mockSwitchEngine.revealProfile).toHaveBeenCalledWith(id);
  });
});

