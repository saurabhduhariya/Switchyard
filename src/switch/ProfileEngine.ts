import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import {
  buildLaunchArgs,
  findExecutable,
  getSharedExtensionsDir,
  isProcessAlive,
} from '../platform/ide';
import { Logger } from '../util/logger';
import {
  CopySettingsResult,
  SwitchEngine,
  SwitchOptions,
  SwitchResult,
} from './SwitchEngine';

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

export interface ProfileEngineOptions {
  store: AccountStore;
  logger: Logger;
  globalStorageUri: vscode.Uri;
  extensionUri?: vscode.Uri;
  memento: MementoLike;
  spawner?: ProcessSpawner;
  executableFinder?: (customPath?: string) => string;
}

/**
 * SwitchEngine implementation for Mode A (Profile Engine).
 * Runs each account in an isolated window using --user-data-dir.
 *
 * NOTE: As per specifications, ProfileEngine imports nothing from db/
 * and neither reads nor writes authentication tokens.
 */
export class ProfileEngine implements SwitchEngine {
  readonly mode = 'profile' as const;

  private store: AccountStore;
  private logger: Logger;
  private globalStorageUri: vscode.Uri;
  private extensionUri?: vscode.Uri;
  private memento: MementoLike;
  private spawner: ProcessSpawner;
  private executableFinder: (customPath?: string) => string;

  constructor(options: ProfileEngineOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.globalStorageUri = options.globalStorageUri;
    this.extensionUri = options.extensionUri;
    this.memento = options.memento;
    this.spawner = options.spawner ?? spawn;
    this.executableFinder = options.executableFinder ?? findExecutable;
  }

  /**
   * Returns the isolated user data directory path for an account.
   */
  getProfileDir(accountId: string): string {
    const parentDir = path.dirname(this.globalStorageUri.fsPath);
    return path.join(parentDir, 'profiles', accountId);
  }

  /**
   * Switches to an account by focusing or launching its isolated profile window.
   */
  async switchTo(accountId: string, options?: SwitchOptions): Promise<SwitchResult> {
    const account = await this.store.get(accountId);
    if (!account) {
      this.logger.error(`Account not found: ${accountId}`);
      return {
        ok: false,
        mode: 'profile',
        error: `Account ${accountId} not found in saved accounts.`,
      };
    }

    // 1. Check if a window for this profile is already running
    const pids = this.memento.get<Record<string, number>>('switchyard.profilePids', {});
    const existingPid = pids[accountId];
    if (existingPid && isProcessAlive(existingPid)) {
      this.logger.info(
        `Profile window for ${account.email} is already active (PID: ${existingPid})`
      );
      void vscode.window.showInformationMessage(
        `Account ${account.email} is already open in another window.`
      );
      return {
        ok: true,
        mode: 'profile',
        message: 'Already open',
      };
    }

    // 2. Prepare profile directory
    const profileDir = this.getProfileDir(accountId);
    const profileDb = path.join(profileDir, 'User', 'globalStorage', 'state.vscdb');
    const isFirstLaunch = !fs.existsSync(profileDb);

    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // 3. Resolve executable & shared extensions
    let exe: string;
    try {
      const config = vscode.workspace.getConfiguration('switchyard');
      const customPath = config.get<string>('executablePath');
      exe = this.executableFinder(customPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Executable resolution failed: ${msg}`);
      return { ok: false, mode: 'profile', error: msg };
    }

    const extensionsDir = getSharedExtensionsDir(this.extensionUri);

    // 4. Resolve workspace folders to reopen
    const currentFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const foldersToOpen = options?.folders ?? currentFolders;

    // 5. Build CLI arguments
    const args = buildLaunchArgs({
      userDataDir: profileDir,
      extensionsDir,
      folders: foldersToOpen,
      newWindow: true,
    });

    this.logger.info(
      `Launching profile window for ${account.email} [dir=${profileDir}, exe=${exe}]`
    );

    // 6. Spawn detached IDE process
    try {
      const child = this.spawner(exe, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });

      if (child.pid) {
        pids[accountId] = child.pid;
        await this.memento.update('switchyard.profilePids', pids);
        this.logger.debug(`Tracked PID ${child.pid} for account ${accountId}`);
      }

      child.unref();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn profile window: ${msg}`);
      return { ok: false, mode: 'profile', error: msg };
    }

    // 7. Update lastUsedAt timestamp
    await this.store.touch(accountId);

    // 8. First-launch user guidance toast
    if (isFirstLaunch) {
      void vscode.window.showInformationMessage(
        `Opened new window for ${account.email}. Please sign in once with ${account.email} in the new window.`
      );
    }

    return { ok: true, mode: 'profile' };
  }

  /**
   * Copies configuration files (settings.json, keybindings.json, snippets/)
   * from the current user directory into the isolated profile directory.
   */
  async copySettingsToProfile(accountId: string): Promise<CopySettingsResult> {
    const account = await this.store.get(accountId);
    if (!account) {
      return { ok: false, count: 0, error: `Account ${accountId} not found.` };
    }

    const profileDir = this.getProfileDir(accountId);
    const targetUserDir = path.join(profileDir, 'User');
    const sourceUserDir = path.dirname(path.dirname(this.globalStorageUri.fsPath));

    if (!fs.existsSync(sourceUserDir)) {
      return {
        ok: false,
        count: 0,
        error: `Could not locate source User configuration directory at: ${sourceUserDir}`,
      };
    }

    let copiedCount = 0;
    try {
      if (!fs.existsSync(targetUserDir)) {
        fs.mkdirSync(targetUserDir, { recursive: true });
      }

      // Copy settings.json
      const settingsSrc = path.join(sourceUserDir, 'settings.json');
      if (fs.existsSync(settingsSrc)) {
        fs.copyFileSync(settingsSrc, path.join(targetUserDir, 'settings.json'));
        copiedCount++;
      }

      // Copy keybindings.json
      const keybindingsSrc = path.join(sourceUserDir, 'keybindings.json');
      if (fs.existsSync(keybindingsSrc)) {
        fs.copyFileSync(keybindingsSrc, path.join(targetUserDir, 'keybindings.json'));
        copiedCount++;
      }

      // Copy snippets directory
      const snippetsSrc = path.join(sourceUserDir, 'snippets');
      if (fs.existsSync(snippetsSrc) && fs.statSync(snippetsSrc).isDirectory()) {
        const targetSnippetsDir = path.join(targetUserDir, 'snippets');
        if (!fs.existsSync(targetSnippetsDir)) {
          fs.mkdirSync(targetSnippetsDir, { recursive: true });
        }
        const entries = fs.readdirSync(snippetsSrc, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            fs.copyFileSync(
              path.join(snippetsSrc, entry.name),
              path.join(targetSnippetsDir, entry.name)
            );
            copiedCount++;
          }
        }
      }

      this.logger.info(
        `Copied ${copiedCount} configuration item(s) to profile for ${account.email}`
      );
      return { ok: true, count: copiedCount };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to copy settings to profile: ${msg}`);
      return { ok: false, count: copiedCount, error: msg };
    }
  }

  /**
   * Reveals the profile folder in the system file manager.
   */
  async revealProfile(accountId: string): Promise<void> {
    const profileDir = this.getProfileDir(accountId);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    const uri = vscode.Uri.file(profileDir);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }
}
