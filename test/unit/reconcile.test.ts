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
    commands: {
      executeCommand: vi.fn(),
    },
  };
});

import * as vscode from 'vscode';
import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { __setTestKeychainToken } from '../../src/platform/keychain';
import { reconcilePendingSwitch } from '../../src/switch/reconcile';
import { fingerprint } from '../../src/accounts/identity';
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
  async get(key: string) { return this.data.get(key); }
  async store(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
}

describe('switch/reconcile', () => {
  let tmpDir: string;
  let memento: MemoryMemento;
  let store: AccountStore;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-reconcile-test-'));
    memento = new MemoryMemento();
    store = new AccountStore({ secrets: new MemorySecretStorage(), state: memento });
    logger = new Logger({ appendLine: vi.fn() } as any);
    vi.clearAllMocks();
  });

  it('does nothing when no pending switch is recorded', async () => {
    await reconcilePendingSwitch(memento, store, logger, undefined);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reconciles successful switch: marks active, shows info message, and deletes result file', async () => {
    const resultFile = path.join(tmpDir, 'success-result.json');
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, switchedAt: Date.now() }));

    await memento.update('switchyard.pendingSwitch', {
      targetId: 'acc-success',
      targetEmail: 'success@example.com',
      resultFile,
      startedAt: Date.now() - 5000,
    });

    await reconcilePendingSwitch(memento, store, logger, undefined);

    // Verify active account was updated
    const active = await store.activeId();
    expect(active).toBe('acc-success');

    // Verify information toast shown
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Switched to account success@example.com'
    );

    // Verify pendingSwitch cleared and result file deleted
    expect(memento.get('switchyard.pendingSwitch')).toBeUndefined();
    expect(fs.existsSync(resultFile)).toBe(false);
  });

  it('handles failed switch: shows error dialog and offers backup restore', async () => {
    const resultFile = path.join(tmpDir, 'fail-result.json');
    fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: 'Database locked' }));

    await memento.update('switchyard.pendingSwitch', {
      targetId: 'acc-fail',
      targetEmail: 'fail@example.com',
      resultFile,
      startedAt: Date.now() - 5000,
    });

    vi.mocked(vscode.window.showErrorMessage).mockResolvedValueOnce('Restore Backup' as any);

    await reconcilePendingSwitch(memento, store, logger, undefined);

    // Active account should NOT be changed
    expect(await store.activeId()).toBeUndefined();

    // Verify error dialog shown
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to switch to fail@example.com: Database locked'),
      'Restore Backup'
    );

    // Verify restoreBackup command was triggered on choice
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('switchyard.restoreBackup');

    // Verify pendingSwitch cleared and result file deleted
    expect(memento.get('switchyard.pendingSwitch')).toBeUndefined();
    expect(fs.existsSync(resultFile)).toBe(false);
  });

  it('warns on live email conflict even if fingerprint matches target metadata', async () => {
    const livePayload = JSON.stringify({
      id_token_email: 'old@example.com',
      token: { access_token: 'acc', refresh_token: 'ref-shared' },
    });
    const fp = fingerprint(livePayload);
    await memento.update('switchyard.accounts', [
      { id: 'acc-target', email: 'target@example.com', addedAt: Date.now(), fingerprint: fp },
    ]);

    const resultFile = path.join(tmpDir, 'mismatch-result.json');
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, switchedAt: Date.now() }));
    await memento.update('switchyard.pendingSwitch', {
      targetId: 'acc-target',
      targetEmail: 'target@example.com',
      resultFile,
      startedAt: Date.now() - 5000,
    });

    __setTestKeychainToken(livePayload);
    try {
      await reconcilePendingSwitch(memento, store, logger, undefined);
      expect(await store.activeId()).toBeUndefined();
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('verification detected a mismatch'),
        'Retry Switch',
        'Dismiss'
      );
    } finally {
      __setTestKeychainToken(undefined);
    }
  });

  it('does not hang when verification mismatch notification stays open without user click', async () => {
    const livePayload = JSON.stringify({
      id_token_email: 'old@example.com',
      token: { access_token: 'acc', refresh_token: 'ref-shared' },
    });
    const fp = fingerprint(livePayload);
    await memento.update('switchyard.accounts', [
      { id: 'acc-target', email: 'target@example.com', addedAt: Date.now(), fingerprint: fp },
    ]);

    const resultFile = path.join(tmpDir, 'pending-toast-result.json');
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, switchedAt: Date.now() }));
    await memento.update('switchyard.pendingSwitch', {
      targetId: 'acc-target',
      targetEmail: 'target@example.com',
      resultFile,
      startedAt: Date.now() - 5000,
    });

    let resolveToast!: (val: string | undefined) => void;
    vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(
      () => new Promise<string | undefined>((r) => { resolveToast = r; }) as any
    );

    __setTestKeychainToken(livePayload);
    try {
      await reconcilePendingSwitch(memento, store, logger, undefined);
      expect(memento.get('switchyard.pendingSwitch')).toBeUndefined();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

      resolveToast('Retry Switch');
      await Promise.resolve();
      await Promise.resolve();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('switchyard.switchAccount', 'acc-target');
    } finally {
      __setTestKeychainToken(undefined);
    }
  });
});
