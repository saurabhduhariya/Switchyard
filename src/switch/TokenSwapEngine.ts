import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AuthDetector } from '../accounts/AuthDetector';
import { parseSnapshot } from '../accounts/identity';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { findExecutable } from '../platform/ide';
import { findStateDb, getBackupsDir } from '../platform/paths';
import { Logger } from '../util/logger';
import { SwitchJob } from './job';
import { SwitchEngine, SwitchOptions, SwitchResult } from './SwitchEngine';

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

export interface TokenSwapEngineOptions {
  store: AccountStore;
  logger: Logger;
  globalStorageUri: vscode.Uri;
  extensionUri?: vscode.Uri;
  memento: MementoLike;
  dbPath?: string;
  detector?: AuthDetector;
  spawner?: ProcessSpawner;
  executableFinder?: (customPath?: string) => string;
}

export class TokenSwapEngine implements SwitchEngine {
  readonly mode = 'tokenSwap' as const;

  private store: AccountStore;
  private logger: Logger;
  private globalStorageUri: vscode.Uri;
  private extensionUri?: vscode.Uri;
  private memento: MementoLike;
  private dbPath?: string;
  private detector?: AuthDetector;
  private spawner: ProcessSpawner;
  private executableFinder: (customPath?: string) => string;

  constructor(options: TokenSwapEngineOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.globalStorageUri = options.globalStorageUri;
    this.extensionUri = options.extensionUri;
    this.memento = options.memento;
    this.dbPath = options.dbPath;
    this.detector = options.detector;
    this.spawner = options.spawner || spawn;
    this.executableFinder = options.executableFinder || findExecutable;
  }

  async switchTo(accountId: string, options?: SwitchOptions): Promise<SwitchResult> {
    const account = await this.store.get(accountId);
    if (!account) {
      this.logger.error(`Account not found: ${accountId}`);
      return {
        ok: false,
        mode: 'tokenSwap',
        error: `Account ${accountId} not found in saved accounts.`,
      };
    }

    const activeId = await this.store.activeId();
    if (accountId === activeId) {
      this.logger.info(`Account ${account.email} is already active.`);
      return {
        ok: true,
        mode: 'tokenSwap',
        message: 'Already active',
      };
    }

    // 1. Confirm dialog (modal) if confirmBeforeSwitch setting is enabled
    const config = vscode.workspace.getConfiguration('switchyard');
    const confirm = config.get<boolean>('confirmBeforeSwitch', true);
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Switch to ${account.email}? Antigravity IDE will quit, swap credentials, and restart.`,
        { modal: true },
        'Switch and Restart',
        'Cancel'
      );
      if (answer !== 'Switch and Restart') {
        return {
          ok: false,
          mode: 'tokenSwap',
          message: 'Cancelled by user',
        };
      }
    }

    // 2. Re-capture active session before switching (rotation safety)
    if (this.detector) {
      try {
        const activeResult = await this.detector.detectActive();
        if (!('unsupported' in activeResult)) {
          await this.store.upsertFromSnapshot(activeResult.snapshot);
          this.logger.debug('Re-captured active session before token swap');
        }
      } catch (err) {
        this.logger.warn('Failed to re-capture active session before switch', err);
      }
    }

    // 3. Load target snapshot from SecretStorage
    const targetSnapshot = await this.store.loadSnapshot(accountId);
    if (
      !targetSnapshot ||
      !targetSnapshot.values ||
      Object.keys(targetSnapshot.values).length === 0
    ) {
      return {
        ok: false,
        mode: 'tokenSwap',
        error: `Session credentials for ${account.email} not found in secure storage. Please sign in again.`,
      };
    }

    // Determine target fingerprint from the exact snapshot values being written
    const targetIdentity = parseSnapshot(targetSnapshot.values);
    const targetFingerprint = targetIdentity.fingerprint;

    // Synchronize account metadata if fingerprint has changed (e.g. after token rotation)
    if (account.fingerprint !== targetFingerprint) {
      this.logger.info(
        `Target fingerprint updated for ${account.email}: ${account.fingerprint} -> ${targetFingerprint}`
      );
      account.fingerprint = targetFingerprint;
      await this.store.updateMeta(accountId, {
        fingerprint: targetFingerprint,
        ...(targetIdentity.plan ? { plan: targetIdentity.plan } : {}),
      });
    }

    // 4. Resolve executable & relaunch arguments
    let exe: string;
    try {
      const customPath = config.get<string>('executablePath');
      exe = this.executableFinder(customPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Executable resolution failed: ${msg}`);
      return { ok: false, mode: 'tokenSwap', error: msg };
    }

    const currentFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const foldersToOpen = options?.folders ?? currentFolders;

    // 5. Determine state.vscdb and backup directory
    const resolvedDb =
      this.dbPath ||
      findStateDb({ globalStorageUriPath: this.globalStorageUri.fsPath });
    if (!resolvedDb || !fs.existsSync(resolvedDb)) {
      return {
        ok: false,
        mode: 'tokenSwap',
        error: 'Could not locate state.vscdb database path.',
      };
    }
    const backupDir = getBackupsDir(path.dirname(resolvedDb));

    // 6. Build SwitchJob and write to temporary file
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const jobPath = path.join(os.tmpdir(), `switchyard-job-${randomSuffix}.json`);
    const resultFile = path.join(
      os.tmpdir(),
      `switchyard-result-${randomSuffix}.json`
    );

    const job: SwitchJob = {
      version: 1,
      parentPid: process.pid,
      dbPath: resolvedDb,
      targetEmail: account.email,
      targetFingerprint,
      values: targetSnapshot.values,
      backupDir,
      relaunch: {
        exe,
        args: foldersToOpen,
      },
      resultFile,
    };

    try {
      fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), { mode: 0o600 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, mode: 'tokenSwap', error: `Failed to write job file: ${msg}` };
    }

    // 7. Resolve switch-helper script path
    let helperPath: string;
    if (this.extensionUri) {
      helperPath = path.join(this.extensionUri.fsPath, 'dist', 'switch-helper.js');
    } else {
      helperPath = path.join(__dirname, '..', '..', 'dist', 'switch-helper.js');
    }

    // 8. Spawn detached helper process
    try {
      const helperEnv: Record<string, string | undefined> = { ...process.env };
      helperEnv.ELECTRON_RUN_AS_NODE = '1';
      delete helperEnv.VSCODE_IPC_HOOK;
      delete helperEnv.VSCODE_IPC_HOOK_EXTHOST;
      delete helperEnv.VSCODE_IPC_HOOK_CLI;

      const child = this.spawner(process.execPath, [helperPath, jobPath], {
        detached: true,
        stdio: 'ignore',
        env: helperEnv as NodeJS.ProcessEnv,
      });
      child.unref();
      this.logger.info(`Spawned switch-helper PID ${child.pid} for job ${jobPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn switch-helper: ${msg}`);
      try {
        fs.rmSync(jobPath, { force: true });
      } catch {
        // ignore
      }
      return { ok: false, mode: 'tokenSwap', error: `Failed to spawn helper: ${msg}` };
    }

    // 9. Record pendingSwitch state in memento for post-restart reconciliation
    await this.memento.update('switchyard.pendingSwitch', {
      targetId: accountId,
      targetEmail: account.email,
      resultFile,
      startedAt: Date.now(),
    });

    // 10. Update lastUsedAt timestamp
    await this.store.touch(accountId);

    // 11. Trigger IDE quit
    this.logger.info(`Triggering workbench.action.quit to switch to ${account.email}`);
    void vscode.commands.executeCommand('workbench.action.quit');

    return {
      ok: true,
      mode: 'tokenSwap',
      message: `Restarting Antigravity IDE to switch to ${account.email}...`,
    };
  }
}
