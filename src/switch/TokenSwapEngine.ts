import { getWorkspaceRelaunchArgs, findExecutable, getMainProcessPid } from '../platform/ide';
import { isAntigravity26OrNewer } from '../platform/agyDaemon';
import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AuthDetector } from '../accounts/AuthDetector';
import { parseSnapshot } from '../accounts/identity';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { findStateDb, getBackupsDir } from '../platform/paths';
import { isWsl } from '../platform/wsl';
import { CAPTURE_SESSION_STATE_KEY, KEYS } from '../constants';
import { Logger } from '../util/logger';
import { SwitchJob } from './job';
import { SignOutAndRestartOptions, SwitchEngine, SwitchOptions, SwitchResult } from './SwitchEngine';


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
        `Switch to ${account.email}? Antigravity IDE will quit, swap credentials, and restart. (Note: switching restarts all Antigravity windows.)`,
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
    if (this.detector && activeId) {
      try {
        const activeAccount = await this.store.get(activeId);
        const activeResult = await this.detector.detectActive();
        if (!('unsupported' in activeResult) && !('partial' in activeResult)) {
          const activeEmail = activeAccount?.email?.toLowerCase().trim();
          const detectedEmail = activeResult.identity?.email?.toLowerCase().trim();
          if (!activeEmail || !detectedEmail || activeEmail === detectedEmail) {
            await this.store.saveSnapshot(activeId, activeResult.snapshot);
            this.logger.debug('Re-captured active session before token swap');
          } else {
            this.logger.warn(
              `Skipping active session re-capture: detected email (${detectedEmail}) does not match active account (${activeEmail})`
            );
          }
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

    // 3b. If running on Antigravity 2.6.0+ (agy extension or OS Keychain active),
    // verify the saved account has a v2.6.0 keychainToken before quitting the IDE.
    let isAgy26OrNewer = false;
    try {
      isAgy26OrNewer = Boolean(
        vscode.extensions?.getExtension?.('google.google-antigravity') ||
        isAntigravity26OrNewer(vscode.env?.appRoot)
      );
    } catch {
      isAgy26OrNewer = isAntigravity26OrNewer();
    }
    if (isAgy26OrNewer && !targetSnapshot.values[KEYS.keychainToken]) {
      this.logger.warn(
        `Account ${account.email} has a legacy <= 2.5.5 snapshot without ${KEYS.keychainToken}`
      );
      const action = await vscode.window.showWarningMessage(
        `Account "${account.email}" was saved in an older version of Antigravity IDE (<= 2.5.5). Antigravity 2.6+ now uses the OS Keychain. Please sign in with ${account.email} once in the side window to update this saved account.`,
        { modal: true },
        'Update Account in Side Window',
        'Cancel'
      );
      if (action === 'Update Account in Side Window') {
        void vscode.commands.executeCommand('switchyard.addNewAccount');
      }
      return {
        ok: false,
        mode: 'tokenSwap',
        message: 'Account requires re-authentication for Antigravity 2.6+',
        error: 'Account requires re-authentication for Antigravity 2.6+',
      };
    }

    // Determine target fingerprint and credential email from the exact snapshot values being written.
    // Always inspect KEYS.keychainToken directly so stale antigravityUserStatus metadata cannot mask
    // a keychain payload belonging to a different account.
    const targetIdentity = parseSnapshot(targetSnapshot.values);
    const targetFingerprint = targetIdentity.fingerprint;
    const keychainTokenVal = targetSnapshot.values[KEYS.keychainToken];
    const keychainIdentity = keychainTokenVal
      ? parseSnapshot({ [KEYS.keychainToken]: keychainTokenVal })
      : undefined;
    const expectedEmail = account.email?.toLowerCase().trim();
    const mismatchedEmail =
      keychainIdentity?.email &&
      expectedEmail &&
      keychainIdentity.email.toLowerCase().trim() !== expectedEmail
        ? keychainIdentity.email
        : targetIdentity.email &&
            expectedEmail &&
            targetIdentity.email.toLowerCase().trim() !== expectedEmail
          ? targetIdentity.email
          : undefined;

    if (mismatchedEmail) {
      const mismatchMsg = `Saved credentials for ${account.email} belong to ${mismatchedEmail}. Please remove or re-add ${account.email} cleanly before switching.`;
      this.logger.warn(mismatchMsg);
      const action = await vscode.window.showWarningMessage(
        `Switchyard: Stored session for "${account.email}" actually contains credentials for "${mismatchedEmail}". Please sign in with ${account.email} again in the side window to repair this saved account.`,
        { modal: true },
        'Update Account in Side Window',
        'Cancel'
      );
      if (action === 'Update Account in Side Window') {
        void vscode.commands.executeCommand('switchyard.addNewAccount');
      }
      return {
        ok: false,
        mode: 'tokenSwap',
        message: mismatchMsg,
        error: mismatchMsg,
      };
    }

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

    // 4-8. Resolve relaunch context, write SwitchJob in persistent shared storage, and spawn helper
    const prep = this.prepareRelaunchContext(options?.folders);
    if (!prep.ok) {
      return { ok: false, mode: 'tokenSwap', error: prep.error };
    }

    const spawned = this.spawnHelperJob({
      resolvedDb: prep.resolvedDb,
      backupDir: prep.backupDir,
      label: 'job',
      jobFields: {
        targetEmail: account.email,
        targetFingerprint,
        values: targetSnapshot.values,
        keychainToken: targetSnapshot.values[KEYS.keychainToken],
        deleteKeys: [
          KEYS.oauth,
          KEYS.legacyInit,
          KEYS.userStatus,
          KEYS.modelCredits,
          KEYS.profileUrl,
        ],
        relaunch: {
          exe: prep.exe,
          args: prep.foldersToOpen,
        },
      },
    });
    if (!spawned.ok) {
      return { ok: false, mode: 'tokenSwap', error: spawned.error };
    }

    // 9. Record pendingSwitch state in memento for post-restart reconciliation
    await this.memento.update('switchyard.pendingSwitch', {
      targetId: accountId,
      targetEmail: account.email,
      resultFile: spawned.resultFile,
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

  /**
   * Signs out the current session, deletes credentials from the database via switch-helper,
   * stores addingAccount state in memento, and relaunches the IDE.
   */
  async signOutAndRestart(options?: SignOutAndRestartOptions): Promise<SwitchResult> {
    // 1. Capture current active session if available
    let previousId = options?.previousId;
    let previousEmail = options?.previousEmail;
    const currentActiveId = previousId || (await this.store.activeId());

    if (this.detector && currentActiveId) {
      try {
        const currentMeta = await this.store.get(currentActiveId);
        const activeResult = await this.detector.detectActive();
        if (!('unsupported' in activeResult) && !('partial' in activeResult)) {
          const expectedEmail = (previousEmail || currentMeta?.email)?.toLowerCase().trim();
          const detectedEmail = activeResult.identity?.email?.toLowerCase().trim();
          if (!expectedEmail || !detectedEmail || expectedEmail === detectedEmail) {
            await this.store.saveSnapshot(currentActiveId, activeResult.snapshot);
            previousId = currentActiveId;
            previousEmail = previousEmail || currentMeta?.email;
            this.logger.debug(`Captured current active session before sign-out: ${currentActiveId}`);
          } else {
            this.logger.warn(
              `Skipping sign-out snapshot save: detected email (${detectedEmail}) does not match account (${expectedEmail})`
            );
          }
        }
      } catch (err) {
        this.logger.warn('Failed to capture active session before sign-out', err);
      }
    }

    if (!previousId) {
      previousId = await this.store.activeId();
      if (previousId) {
        const acc = await this.store.get(previousId);
        previousEmail = previousEmail || acc?.email;
      }
    }

    // 2-6. Resolve relaunch context, write SwitchJob in persistent shared storage, and spawn helper
    const prep = this.prepareRelaunchContext(options?.folders);
    if (!prep.ok) {
      return { ok: false, mode: 'tokenSwap', error: prep.error };
    }

    const spawned = this.spawnHelperJob({
      resolvedDb: prep.resolvedDb,
      backupDir: prep.backupDir,
      label: 'sign-out job',
      jobFields: {
        targetEmail: '',
        targetFingerprint: '',
        values: {},
        clearKeychain: true,
        deleteKeys: [
          KEYS.oauth,
          KEYS.legacyInit,
          KEYS.userStatus,
          KEYS.modelCredits,
          KEYS.profileUrl,
        ],
        relaunch: {
          exe: prep.exe,
          args: prep.foldersToOpen,
        },
      },
    });
    if (!spawned.ok) {
      return { ok: false, mode: 'tokenSwap', error: spawned.error };
    }

    // 7. Record addingAccount state in memento and clear any abandoned capture session
    await this.memento.update(CAPTURE_SESSION_STATE_KEY, undefined);
    await this.memento.update('switchyard.addingAccount', {
      previousId,
      previousEmail,
      expectedEmail: options?.expectedEmail,
      resultFile: spawned.resultFile,
      startedAt: Date.now(),
    });

    // 8. Clear activeId in store so old account is not marked active upon restart
    await this.store.setActive(undefined);

    // 9. Trigger IDE quit
    this.logger.info('Triggering workbench.action.quit for sign out and restart');
    void vscode.commands.executeCommand('workbench.action.quit');

    return {
      ok: true,
      mode: 'tokenSwap',
      message: 'Signing out and restarting Antigravity IDE...',
    };
  }

  private prepareRelaunchContext(
    overrideFolders?: string[]
  ):
    | { ok: true; exe: string; foldersToOpen: string[]; resolvedDb: string; backupDir: string }
    | { ok: false; error: string } {
    const config = vscode.workspace.getConfiguration('switchyard');
    let exe: string;
    try {
      const customPath = config.get<string>('executablePath');
      exe = this.executableFinder(customPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Executable resolution failed: ${msg}`);
      return { ok: false, error: msg };
    }

    let remoteName: string | undefined;
    try {
      remoteName = (vscode as any).env?.remoteName;
    } catch {
      // ignore when mocked in unit tests
    }
    const foldersToOpen = getWorkspaceRelaunchArgs({
      overrideFolders,
      workspaceFolders: vscode.workspace.workspaceFolders,
      workspaceFile: vscode.workspace.workspaceFile,
      remoteName,
    });

    const resolvedDb =
      this.dbPath ||
      findStateDb({ globalStorageUriPath: this.globalStorageUri.fsPath });
    if (!resolvedDb || !fs.existsSync(resolvedDb)) {
      return { ok: false, error: 'Could not locate state.vscdb database path.' };
    }
    const backupDir = getBackupsDir(path.dirname(resolvedDb));

    return { ok: true, exe, foldersToOpen, resolvedDb, backupDir };
  }

  private resolveJobsDir(resolvedDb: string): string {
    const sharedDir = path.join(path.dirname(resolvedDb), 'switchyard-jobs');
    try {
      fs.mkdirSync(sharedDir, { recursive: true, mode: 0o700 });
      return sharedDir;
    } catch {
      return os.tmpdir();
    }
  }

  private pruneOldJobFiles(jobsDir: string): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      for (const entry of fs.readdirSync(jobsDir)) {
        if (!/^switchyard-(job|result)-.*\.json$/.test(entry)) continue;
        const full = path.join(jobsDir, entry);
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.rmSync(full, { force: true });
          }
        } catch {
          // ignore per-file cleanup error
        }
      }
    } catch {
      // ignore
    }
  }

  private spawnHelperJob(params: {
    resolvedDb: string;
    backupDir: string;
    label: string;
    jobFields: Omit<
      SwitchJob,
      'version' | 'parentPid' | 'dbPath' | 'backupDir' | 'resultFile' | 'logFile'
    >;
  }): { ok: true; resultFile: string } | { ok: false; error: string } {
    const jobsDir = this.resolveJobsDir(params.resolvedDb);
    this.pruneOldJobFiles(jobsDir);

    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const jobPath = path.join(jobsDir, `switchyard-job-${randomSuffix}.json`);
    const resultFile = path.join(jobsDir, `switchyard-result-${randomSuffix}.json`);
    const logFile = path.join(jobsDir, 'switch-helper.log');

    const job: SwitchJob = {
      version: 1,
      parentPid: getMainProcessPid(), // Use Electron Main Process PID, not Extension Host PID
      dbPath: params.resolvedDb,
      backupDir: params.backupDir,
      resultFile,
      logFile,
      ...params.jobFields,
    };

    try {
      fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), { mode: 0o600 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to write job file: ${msg}` };
    }

    const helperPath = this.extensionUri
      ? path.join(this.extensionUri.fsPath, 'dist', 'switch-helper.js')
      : path.join(__dirname, '..', '..', 'dist', 'switch-helper.js');

    try {
      const helperEnv: Record<string, string | undefined> = { ...process.env };
      helperEnv.ELECTRON_RUN_AS_NODE = '1';
      delete helperEnv.VSCODE_IPC_HOOK;
      delete helperEnv.VSCODE_IPC_HOOK_EXTHOST;
      delete helperEnv.VSCODE_IPC_HOOK_CLI;
      if (isWsl() && helperEnv.WSL_INTEROP && !fs.existsSync(helperEnv.WSL_INTEROP)) {
        delete helperEnv.WSL_INTEROP;
      }

      const child = this.spawner(process.execPath, [helperPath, jobPath], {
        detached: true,
        stdio: 'ignore',
        env: helperEnv as NodeJS.ProcessEnv,
      });
      child.unref();
      this.logger.info(`Spawned switch-helper PID ${child.pid} for ${params.label} ${jobPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn switch-helper: ${msg}`);
      try {
        fs.rmSync(jobPath, { force: true });
      } catch {
        // ignore
      }
      return { ok: false, error: `Failed to spawn helper: ${msg}` };
    }

    return { ok: true, resultFile };
  }
}

