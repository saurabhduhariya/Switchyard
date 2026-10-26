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

import * as vscode from 'vscode';
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
      globalState: state,
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
  }, 15000);

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

  it('handleTogglePin toggles account in switchyard.pinned and updates webview state', async () => {
    const session = makeSyntheticSessionEntries({ email: 'pin-test@domain.com' });
    await writeSyntheticDb(dbPath, session);
    await panelProvider.detectAndRefresh();
    await panelProvider.handleSaveDetected();

    const accounts = await store.list();
    const id = accounts[0].id;

    // Toggle pin ON
    await panelProvider.handleTogglePin(id);
    const pinnedState = state.get<string[]>('switchyard.pinned', []);
    expect(pinnedState).toContain(id);

    const lastMsg = postedMessages[postedMessages.length - 1];
    expect(lastMsg.type).toBe('state');
    if (lastMsg.type === 'state') {
      const acc = lastMsg.accounts.find((a) => a.id === id);
      expect(acc?.pinned).toBe(true);
    }

    // Toggle pin OFF
    await panelProvider.handleTogglePin(id);
    const unpinnedState = state.get<string[]>('switchyard.pinned', []);
    expect(unpinnedState).not.toContain(id);
  });

  it('pushes addAccountGuide when switchyard.addingAccount is active and signed out', async () => {
    await state.update('switchyard.addingAccount', {
      previousId: 'prev-acc-1',
      previousEmail: 'prev@example.com',
      expectedEmail: 'new@example.com',
    });

    await panelProvider.push();

    const lastMsg = postedMessages[postedMessages.length - 1];
    expect(lastMsg.type).toBe('state');
    if (lastMsg.type === 'state') {
      expect(lastMsg.addAccountGuide).toBeDefined();
      expect(lastMsg.addAccountGuide?.active).toBe(true);
      expect(lastMsg.addAccountGuide?.previousEmail).toBe('prev@example.com');
      expect(lastMsg.addAccountGuide?.expectedEmail).toBe('new@example.com');
    }
  });

  it('handleAddNewAccount confirms and calls signOutAndRestart on tokenSwap switchEngine', async () => {
    const mockSwitchEngine = {
      mode: 'tokenSwap' as const,
      switchTo: vi.fn(async () => ({ ok: true, mode: 'tokenSwap' as const })),
      signOutAndRestart: vi.fn(async () => ({ ok: true, mode: 'tokenSwap' as const })),
    };
    panelProvider.setSwitchEngine(mockSwitchEngine);

    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Sign Out & Restart' as any);

    await panelProvider.handleAddNewAccount();
    expect(mockSwitchEngine.signOutAndRestart).toHaveBeenCalledOnce();
  });

  describe('add account routing', () => {
    const useConfig = (values: Record<string, unknown>) => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        () => ({ get: (key: string, def: unknown) => (key in values ? values[key] : def) }) as any
      );
    };
    const fakeCapture = () => ({
      startCapture: vi.fn(async () => ({ ok: true })),
      dismiss: vi.fn(async () => undefined),
      getCurrentSession: vi.fn(() => undefined),
    });
    const fakeEngine = (mode: 'tokenSwap' | 'profile') => ({
      mode,
      switchTo: vi.fn(async () => ({ ok: true, mode })),
      signOutAndRestart: vi.fn(async () => ({ ok: true, mode })),
    });

    afterEach(() => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        () => ({ get: vi.fn((_key: string, def: unknown) => def) }) as any
      );
      vi.mocked(vscode.window.showInputBox).mockReset();
    });

    it('token-swap + sideWindow starts a capture and does not sign out', async () => {
      useConfig({});
      const capture = fakeCapture();
      const engine = fakeEngine('tokenSwap');
      panelProvider.setSwitchEngine(engine as any);
      panelProvider.setCaptureManager(capture as any);

      await panelProvider.handleAddNewAccount();
      expect(capture.startCapture).toHaveBeenCalledOnce();
      expect(capture.startCapture).toHaveBeenCalledWith();
      expect(engine.signOutAndRestart).not.toHaveBeenCalled();
    });

    it('profile mode + sideWindow starts a capture that is promoted to the profile', async () => {
      useConfig({ mode: 'profile' });
      const capture = fakeCapture();
      panelProvider.setSwitchEngine(fakeEngine('profile') as any);
      panelProvider.setCaptureManager(capture as any);

      await panelProvider.handleAddNewAccount();
      expect(capture.startCapture).toHaveBeenCalledWith({ promoteToProfile: true });
      expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    });

    it('profile mode + signOutRestart keeps the manual label prompt', async () => {
      useConfig({ mode: 'profile', addAccountMethod: 'signOutRestart' });
      const capture = fakeCapture();
      panelProvider.setSwitchEngine(fakeEngine('profile') as any);
      panelProvider.setCaptureManager(capture as any);
      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined as any);

      await panelProvider.handleAddNewAccount();
      expect(vscode.window.showInputBox).toHaveBeenCalledOnce();
      expect(capture.startCapture).not.toHaveBeenCalled();
    });

    it('falls back to the sign-out flow when the side window cannot start', async () => {
      useConfig({});
      const capture = fakeCapture();
      capture.startCapture.mockResolvedValueOnce({ ok: false, error: 'no executable' } as any);
      const engine = fakeEngine('tokenSwap');
      panelProvider.setSwitchEngine(engine as any);
      panelProvider.setCaptureManager(capture as any);
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Sign Out & Restart' as any);

      await panelProvider.handleAddNewAccount();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(engine.signOutAndRestart).toHaveBeenCalledOnce();
    });

    it('"Use sign-out method" dismisses the failed card and runs the legacy flow', async () => {
      useConfig({});
      const capture = fakeCapture();
      const engine = fakeEngine('tokenSwap');
      panelProvider.setSwitchEngine(engine as any);
      panelProvider.setCaptureManager(capture as any);
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Sign Out & Restart' as any);

      await panelProvider.handleUseLegacyAdd();
      expect(capture.dismiss).toHaveBeenCalledOnce();
      expect(capture.startCapture).not.toHaveBeenCalled();
      expect(engine.signOutAndRestart).toHaveBeenCalledOnce();
    });
  });

  describe('quota freshness', () => {
    const quotaFor = (tier: string) =>
      ({
        tierName: tier,
        updatedAt: Date.now(),
        source: 'live',
        gemini: { name: 'Gemini', weekly: { remainingPercent: 42, resetTime: new Date(Date.now() + 86400000).toISOString() } },
        claudeGpt: { name: 'Claude + GPT' },
      }) as any;

    const twoAccounts = async () => {
      const a = await store.upsertFromSnapshot(
        { values: { 'antigravityUnifiedStateSync.oauthToken': 'QUFB' }, capturedAt: 1 },
        'A'
      );
      const b = await store.upsertFromSnapshot(
        { values: { 'antigravityUnifiedStateSync.oauthToken': 'QkJC' }, capturedAt: 2 },
        'B'
      );
      await store.setActive(a.id);
      return { a, b };
    };

    it('never saves the signed-in account\'s quota under a different account', async () => {
      const { a, b } = await twoAccounts();
      const collector = (panelProvider as any).quotaCollector;
      collector.getQuotaResult = vi.fn(async () => ({ quota: quotaFor('Google AI Pro Quota') }));
      const updateSpy = vi.spyOn(store, 'updateQuota');

      await (panelProvider as any).handleRefreshQuota(b.id); // B is not the signed-in account
      expect(collector.getQuotaResult).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect((await store.get(b.id))?.quota).toBeUndefined();

      await (panelProvider as any).handleRefreshQuota(a.id); // A is
      expect(updateSpy).toHaveBeenCalledWith(a.id, expect.anything());
    });

    it('token swap: captures the leaving account\'s quota just before switching', async () => {
      const { a, b } = await twoAccounts();
      const order: string[] = [];
      const collector = (panelProvider as any).quotaCollector;
      collector.getQuotaResult = vi.fn(async () => {
        order.push('quota');
        return { quota: quotaFor('Google AI Pro Quota') };
      });
      panelProvider.setSwitchEngine({
        mode: 'tokenSwap' as const,
        switchTo: vi.fn(async () => {
          order.push('switch');
          return { ok: true, mode: 'tokenSwap' as const };
        }),
      } as any);

      await panelProvider.handleSwitch(b.id);
      expect(order).toEqual(['quota', 'switch']);
      expect((await store.get(a.id))?.quota?.tierName).toBe('Google AI Pro Quota'); // the account being left
      expect((await store.get(b.id))?.quota).toBeUndefined();
    });

    it('profile mode does not read quota before opening another profile', async () => {
      const { b } = await twoAccounts();
      const collector = (panelProvider as any).quotaCollector;
      collector.getQuotaResult = vi.fn(async () => ({ quota: quotaFor('x') }));
      panelProvider.setSwitchEngine({
        mode: 'profile' as const,
        switchTo: vi.fn(async () => ({ ok: true, mode: 'profile' as const })),
      } as any);

      await panelProvider.handleSwitch(b.id);
      expect(collector.getQuotaResult).not.toHaveBeenCalled();
    });

    it('a slow quota read can never hold up the switch', async () => {
      await twoAccounts();
      const collector = (panelProvider as any).quotaCollector;
      collector.getQuotaResult = vi.fn(() => new Promise(() => undefined)); // never answers

      const started = Date.now();
      await (panelProvider as any).refreshQuotaBeforeLeaving(40);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('a failing quota read does not block the switch either', async () => {
      const { b } = await twoAccounts();
      const collector = (panelProvider as any).quotaCollector;
      collector.getQuotaResult = vi.fn(async () => {
        throw new Error('language server not running');
      });
      const switchTo = vi.fn(async () => ({ ok: true, mode: 'tokenSwap' as const }));
      panelProvider.setSwitchEngine({ mode: 'tokenSwap' as const, switchTo } as any);

      await panelProvider.handleSwitch(b.id);
      expect(switchTo).toHaveBeenCalledWith(b.id);
    });
  });

  describe('best-account suggestion', () => {
    const useConfig = (values: Record<string, unknown>) => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        () => ({ get: (key: string, def: unknown) => (key in values ? values[key] : def) }) as any
      );
    };
    afterEach(() => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        () => ({ get: vi.fn((_key: string, def: unknown) => def) }) as any
      );
    });

    const q = (gWeekly: number) =>
      ({
        tierName: 'Google AI Pro Quota',
        updatedAt: Date.now(),
        source: 'live',
        gemini: { name: 'Gemini', weekly: { remainingPercent: gWeekly, resetTime: new Date(Date.now() + 3 * 86400000).toISOString() } },
        claudeGpt: { name: 'Claude + GPT', weekly: { remainingPercent: 80, resetTime: new Date(Date.now() + 3 * 86400000).toISOString() } },
      }) as any;

    const setup = async () => {
      const a = await store.upsertFromSnapshot({ values: { 'antigravityUnifiedStateSync.oauthToken': 'QUFB' }, capturedAt: 1 }, 'A');
      const b = await store.upsertFromSnapshot({ values: { 'antigravityUnifiedStateSync.oauthToken': 'QkJC' }, capturedAt: 2 }, 'B');
      await store.setActive(a.id);
      await store.updateQuota(a.id, q(6)); // active account is running low
      await store.updateQuota(b.id, q(90));
      return { a, b };
    };
    const lastState = () => [...postedMessages].reverse().find((m) => m.type === 'state') as any;

    it('pushes a suggestion naming the better account when the active one is low', async () => {
      const { b } = await setup();
      await panelProvider.push();
      const suggestion = lastState().suggestion;
      expect(suggestion.accountId).toBe(b.id);
      expect(suggestion.lowText).toBe('Gemini weekly 6%');
      expect(suggestion.betterText).toBe('Gemini weekly 90%');
    });

    it('pushes nothing when the active account is fine', async () => {
      const { a } = await setup();
      await store.updateQuota(a.id, q(70));
      await panelProvider.push();
      expect(lastState().suggestion).toBeUndefined();
    });

    it('"Not now" hides it for this situation and it stays hidden after a restart', async () => {
      await setup();
      await panelProvider.push();
      const key = lastState().suggestion.key;

      await panelProvider.handleDismissSuggestion(key);
      expect(lastState().suggestion).toBeUndefined();

      const again = new PanelProvider(fakeContext, store, new AuthDetector(dbPath), logger, statusBar);
      again.resolveWebviewView(fakeWebviewView);
      await again.push();
      expect(lastState().suggestion).toBeUndefined();
    });

    it('comes back for a different situation (the best account changes)', async () => {
      await setup();
      await panelProvider.push();
      await panelProvider.handleDismissSuggestion(lastState().suggestion.key);
      expect(lastState().suggestion).toBeUndefined();

      const c = await store.upsertFromSnapshot({ values: { 'antigravityUnifiedStateSync.oauthToken': 'Q0ND' }, capturedAt: 3 }, 'C');
      await store.updateQuota(c.id, q(100));
      await panelProvider.push();
      expect(lastState().suggestion.accountId).toBe(c.id);
    });

    it('can be switched off with switchyard.suggestBestAccount', async () => {
      await setup();
      useConfig({ suggestBestAccount: false });
      await panelProvider.push();
      expect(lastState().suggestion).toBeUndefined();
    });

    it('the message handler accepts dismissSuggestion', async () => {
      await setup();
      await panelProvider.push();
      const key = lastState().suggestion.key;
      const handler = vi.mocked(fakeWebviewView.webview.onDidReceiveMessage).mock.calls[0]![0] as (m: any) => Promise<void>;
      await handler({ type: 'dismissSuggestion', key });
      expect(lastState().suggestion).toBeUndefined();
    });
  });

  describe('quota errors and history', () => {
    const live = (g: number, updatedAt = Date.now()) =>
      ({
        tierName: 'Google AI Pro Quota',
        updatedAt,
        source: 'live',
        gemini: { name: 'Gemini', weekly: { remainingPercent: g, resetTime: new Date(Date.now() + 3 * 86400000).toISOString() } },
        claudeGpt: { name: 'Claude + GPT', weekly: { remainingPercent: 80, resetTime: new Date(Date.now() + 3 * 86400000).toISOString() } },
      }) as any;

    const setup = async () => {
      const a = await store.upsertFromSnapshot({ values: { 'antigravityUnifiedStateSync.oauthToken': 'QUFB' }, capturedAt: 1 }, 'A');
      const b = await store.upsertFromSnapshot({ values: { 'antigravityUnifiedStateSync.oauthToken': 'QkJC' }, capturedAt: 2 }, 'B');
      await store.setActive(a.id);
      return { a, b };
    };
    const lastState = () => [...postedMessages].reverse().find((m) => m.type === 'state') as any;
    const collector = () => (panelProvider as any).quotaCollector;
    const failWith = (kind: string) => {
      collector().getQuotaResult = vi.fn(async () => ({ error: { kind, message: `plain text for ${kind}` } }));
    };

    it('a first failed read is not shown (the language server is probably still starting)', async () => {
      const { a } = await setup();
      failWith('no-language-server');
      await panelProvider.refreshActiveQuota();
      await panelProvider.push();
      expect(lastState().quotaError).toBeUndefined();
      void a;
    });

    it('the second failed read in a row shows the error with a plain explanation', async () => {
      const { a } = await setup();
      failWith('no-language-server');
      await panelProvider.refreshActiveQuota();
      await panelProvider.refreshActiveQuota();
      expect(lastState().quotaError).toMatchObject({
        accountId: a.id,
        kind: 'no-language-server',
        message: 'plain text for no-language-server',
      });
    });

    it('pressing Retry shows a failure straight away', async () => {
      const { a } = await setup();
      failWith('request-failed');
      await (panelProvider as any).handleRefreshQuota(a.id);
      expect(lastState().quotaError?.kind).toBe('request-failed');
    });

    it('a successful read clears the error', async () => {
      const { a } = await setup();
      failWith('request-failed');
      await (panelProvider as any).handleRefreshQuota(a.id);
      expect(lastState().quotaError).toBeDefined();

      collector().getQuotaResult = vi.fn(async () => ({ quota: live(50) }));
      await (panelProvider as any).handleRefreshQuota(a.id);
      expect(lastState().quotaError).toBeUndefined();
    });

    it('an error belongs to one account: switching to another account hides it', async () => {
      const { a, b } = await setup();
      failWith('request-failed');
      await (panelProvider as any).handleRefreshQuota(a.id);
      expect(lastState().quotaError).toBeDefined();

      await store.setActive(b.id);
      await panelProvider.push();
      expect(lastState().quotaError).toBeUndefined();
    });

    it('a reader that throws counts as a failed read, never crashes the panel', async () => {
      const { a } = await setup();
      collector().getQuotaResult = vi.fn(async () => {
        throw new Error('socket exploded with secret-token-123');
      });
      await (panelProvider as any).handleRefreshQuota(a.id);
      const err = lastState().quotaError;
      expect(err.kind).toBe('request-failed');
      expect(JSON.stringify(err)).not.toContain('secret-token-123'); // raw error text is never shown
    });

    it('a live read is added to the account history', async () => {
      const { a } = await setup();
      collector().getQuotaResult = vi.fn(async () => ({ quota: live(70) }));
      await (panelProvider as any).handleRefreshQuota(a.id);
      const history = (panelProvider as any).history.get(a.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ g: 70, c: 80 });
    });

    it('a database-fallback read is not added to the history (it may be old)', async () => {
      const { a } = await setup();
      collector().getQuotaResult = vi.fn(async () => ({ quota: { ...live(70), source: 'vscdb' } }));
      await (panelProvider as any).handleRefreshQuota(a.id);
      expect((panelProvider as any).history.get(a.id)).toHaveLength(0);
    });

    it('pushes a trend once there is enough history, and drops it when the account is removed', async () => {
      const { a, b } = await setup();
      const now = Date.now();
      const history = (panelProvider as any).history;
      await history.record(a.id, live(90), now - 10 * 3600_000);
      await history.record(a.id, live(80), now - 1 * 3600_000);
      await history.record(b.id, live(10), now - 2 * 3600_000);

      await panelProvider.push();
      const trends = lastState().trends;
      expect(trends[a.id].gemini.usedPercent).toBe(10);
      expect(trends[a.id].gemini.points.length).toBe(24);
      expect(trends[b.id]).toBeUndefined(); // one reading is not a trend

      await store.remove(b.id);
      await panelProvider.push();
      expect(history.get(b.id)).toEqual([]);
    });

    it('sends no trends field when nobody has any history', async () => {
      await setup();
      await panelProvider.push();
      expect(lastState().trends).toBeUndefined();
    });
  });
});



