import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore } from './accounts/AccountStore';
import { AuthDetector } from './accounts/AuthDetector';
import { parseSnapshot } from './accounts/identity';
import { CaptureManager } from './capture/CaptureManager';
import { isCompanionMode, setupCompanionMode, createCompanionStatusBar } from './capture/companion';
import { KEYS, OUTPUT_CHANNEL_NAME } from './constants';
import { listBackups, restoreBackup } from './db/backup';
import { readKeys } from './db/StateDb';
import { findStateDb, getBackupsDir, getGlobalStorageDir } from './platform/paths';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import { Logger } from './util/logger';
import { createSwitchEngine } from './switch/SwitchEngine';
import { reconcilePendingSwitch } from './switch/reconcile';

let channel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const logger = new Logger(channel);
  logger.info('Activating Switchyard extension...');

  // 0. Detect Companion Mode (capture window)
  if (isCompanionMode(context.globalStorageUri)) {
    logger.info('Running in companion mode - setting up minimal UI');
    const companionDisposable = setupCompanionMode(context, logger);
    const companionStatusBar = createCompanionStatusBar();
    context.subscriptions.push(channel, companionDisposable, companionStatusBar);
    // Skip all other initialization for companion mode
    return;
  }

  // 1. Locate state.vscdb
  const dbPath = findStateDb({ globalStorageUriPath: context.globalStorageUri.fsPath });
  if (dbPath) {
    logger.info(`Found state.vscdb at: ${dbPath}`);
  } else {
    logger.warn('Could not locate state.vscdb database in candidate locations.');
  }

  // 2. Initialize Core Services
  const store = new AccountStore({
    secrets: context.secrets,
    state: context.globalState,
  });

  const detector = dbPath ? new AuthDetector(dbPath) : undefined;

  const mode = vscode.workspace
    .getConfiguration('switchyard')
    .get<'profile' | 'tokenSwap'>('mode', 'tokenSwap');

  const switchEngine = createSwitchEngine(mode, {
    store,
    logger,
    globalStorageUri: context.globalStorageUri,
    extensionUri: context.extensionUri,
    memento: context.globalState,
    dbPath,
    detector,
  });

  const statusBar = new StatusBar();
  const panelProvider = new PanelProvider(context, store, detector, logger, statusBar, switchEngine);

  // 2c. Initialize Capture Manager for side-window add account flow
  const captureManager = new CaptureManager({
    store,
    logger,
    globalStorageUri: context.globalStorageUri,
    extensionUri: context.extensionUri,
    memento: context.globalState,
  });

  // 2d. Set capture manager on panel provider
  panelProvider.setCaptureManager(captureManager);

  // Register capture state change callback
  captureManager.onStateChange((_session) => {
    void panelProvider.push(); // Refresh UI when capture state changes
  });

  // 2e. Sweep stale capture sessions on startup
  void captureManager.sweepStaleSessions();

  // 2f. Reconcile any pending switch from a previous IDE quit/restart
  void reconcilePendingSwitch(context.globalState, store, logger, dbPath);

  // 3. Register Webview Provider & Status Bar
  context.subscriptions.push(
    channel,
    statusBar,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => captureManager.dispose() }
  );

  // 4. File Watcher on state.vscdb directory (debounced 500 ms)
  if (dbPath) {
    const dbDir = path.dirname(dbPath);
    try {
      let debounceTimer: NodeJS.Timeout | undefined;
      const watcher = fs.watch(dbDir, (_eventType, filename) => {
        if (filename && (filename === 'state.vscdb' || filename.startsWith('state.vscdb'))) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            void panelProvider.detectAndRefresh();
          }, 500);
        }
      });

      context.subscriptions.push({
        dispose: () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          watcher.close();
        },
      });
    } catch (err) {
      logger.error('Failed to attach file watcher on state.vscdb directory', err);
    }
  }

  // 5. Window Focus Listener (re-detect on focus)
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void panelProvider.detectAndRefresh();
      }
    })
  );

  // 5b. Authentication Sessions Change Listener (re-detect when user logs in/out in the IDE)
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(() => {
      logger.info('Authentication sessions changed; triggering detectAndRefresh');
      void panelProvider.detectAndRefresh();
    })
  );

  // 5c. Periodic Detection Polling (every 5 seconds) to catch live logins/logouts automatically
  const pollTimer = setInterval(() => {
    void panelProvider.detectAndRefresh();
  }, 5000);
  context.subscriptions.push({
    dispose: () => clearInterval(pollTimer),
  });

  // 6. Settings Change Listener (e.g. switchyard.maskEmails, switchyard.mode)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('switchyard.maskEmails') ||
        e.affectsConfiguration('switchyard.mode') ||
        e.affectsConfiguration('switchyard.confirmBeforeSwitch') ||
        e.affectsConfiguration('switchyard.backupRetention')
      ) {
        const currentMode = vscode.workspace
          .getConfiguration('switchyard')
          .get<'profile' | 'tokenSwap'>('mode', 'tokenSwap');
        panelProvider.setSwitchEngine(
          createSwitchEngine(currentMode, {
            store,
            logger,
            globalStorageUri: context.globalStorageUri,
            extensionUri: context.extensionUri,
            memento: context.globalState,
            dbPath,
            detector,
          })
        );
        void panelProvider.push();
      }
    })
  );

  // 7. Register Commands
  context.subscriptions.push(
    // switchyard.addAccount: capture current login
    vscode.commands.registerCommand('switchyard.addAccount', async () => {
      if (!detector) {
        vscode.window.showErrorMessage('Switchyard: state.vscdb database not found.');
        return;
      }

      const result = await detector.detectActive();
      if ('unsupported' in result || 'partial' in result) {
        vscode.window.showWarningMessage('Switchyard: No active Google login found. Please sign in to Antigravity first.');
        return;
      }

      const { identity, snapshot } = result;
      const email = identity.email || `account-${identity.fingerprint.slice(0, 6)}`;

      // Check if already saved
      const existing = identity.email
        ? await store.getByEmail(identity.email)
        : await store.get(`fp-${identity.fingerprint}`);

      if (existing) {
        const choice = await vscode.window.showInformationMessage(
          `Switchyard: Account ${existing.email} is already saved.`,
          'Add Another Account',
          'Import from Backup/File'
        );
        if (choice === 'Add Another Account') {
          await vscode.commands.executeCommand('switchyard.addNewAccount');
        } else if (choice === 'Import from Backup/File') {
          await vscode.commands.executeCommand('switchyard.importAccount');
        }
        return;
      }

      // Prompt for optional label
      const label = await vscode.window.showInputBox({
        title: 'Add Account to Switchyard',
        prompt: `Enter an optional label for ${email}`,
        placeHolder: 'e.g. Work, Personal, Client A',
      });

      const meta = await store.upsertFromSnapshot(snapshot, label);
      await store.setActive(meta.id);
      await panelProvider.push();

      vscode.window.showInformationMessage(`Switchyard: Successfully saved account ${meta.email}`);
    }),

    // switchyard.addNewAccount: guided flow to sign out and sign in with new account
    vscode.commands.registerCommand('switchyard.addNewAccount', async () => {
      await panelProvider.handleAddNewAccount();
    }),

    // switchyard.openBackupsFolder: reveals the backup directory in system file explorer
    vscode.commands.registerCommand('switchyard.openBackupsFolder', async () => {
      if (!dbPath) {
        vscode.window.showErrorMessage('Switchyard: Cannot locate database path.');
        return;
      }
      const backupDir = getBackupsDir(getGlobalStorageDir(dbPath));
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(backupDir));
    }),


    // switchyard.switchAccount: Quick Pick selector
    vscode.commands.registerCommand('switchyard.switchAccount', async () => {
      const accounts = await store.list();
      const activeId = await store.activeId();

      if (accounts.length === 0) {
        vscode.window.showInformationMessage('Switchyard: No saved accounts yet. Sign in and click "Add Account".');
        return;
      }

      const maskEmails = vscode.workspace.getConfiguration('switchyard').get<boolean>('maskEmails', false);

      const items = accounts.map((acc) => {
        const displayEmail = maskEmails
          ? acc.email.replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, '$1****$2')
          : acc.email;
        const isActive = acc.id === activeId;
        return {
          label: isActive ? `$(check) ${displayEmail}` : displayEmail,
          description: acc.label || (acc.plan ? `(${acc.plan})` : ''),
          detail: isActive ? 'Currently active' : undefined,
          id: acc.id,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an account to switch to',
        title: 'Switchyard – Switch Account',
      });

      if (picked) {
        await panelProvider.handleSwitch(picked.id);
      }
    }),

    // switchyard.refresh
    vscode.commands.registerCommand('switchyard.refresh', async () => {
      await panelProvider.detectAndRefresh(true);
      vscode.window.showInformationMessage('Switchyard: Refreshed accounts and active state.');
    }),

    // switchyard.restoreBackup
    vscode.commands.registerCommand('switchyard.restoreBackup', async () => {
      if (!dbPath) {
        vscode.window.showErrorMessage('Switchyard: Cannot restore backup because state.vscdb path is unknown.');
        return;
      }

      const backupDir = getBackupsDir(getGlobalStorageDir(dbPath));
      const backups = await listBackups(backupDir);

      if (backups.length === 0) {
        vscode.window.showInformationMessage('Switchyard: No database backups found.');
        return;
      }

      const items = backups.map((b) => ({
        label: `Backup ${new Date(b.timestamp).toLocaleString()}`,
        description: `${b.files.length} files (${b.files.join(', ')})`,
        backup: b,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a backup to restore',
        title: 'Switchyard – Restore Backup',
      });

      if (picked) {
        const confirm = await vscode.window.showWarningMessage(
          `Restore backup from ${new Date(picked.backup.timestamp).toLocaleString()}? This will replace the active session database.`,
          { modal: true },
          'Restore'
        );

        if (confirm === 'Restore') {
          await restoreBackup(picked.backup, dbPath);
          await panelProvider.detectAndRefresh(true);
          vscode.window.showInformationMessage('Switchyard: Backup restored successfully.');
        }
      }
    }),

    // switchyard.importAccount: import account from a database file (e.g. spike/B.vscdb or backup)
    vscode.commands.registerCommand('switchyard.importAccount', async (targetDbUri?: vscode.Uri) => {
      let chosenPath: string | undefined;

      if (targetDbUri?.fsPath) {
        chosenPath = targetDbUri.fsPath;
      } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let defaultUri: vscode.Uri | undefined;
        const firstFolder = workspaceFolders?.[0];
        if (firstFolder) {
          const spikeB = path.join(firstFolder.uri.fsPath, 'spike', 'B.vscdb');
          if (fs.existsSync(spikeB)) {
            defaultUri = vscode.Uri.file(spikeB);
          }
        }

        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          title: 'Select a database (.vscdb) or backup to import into Switchyard',
          defaultUri,
          filters: { 'VS Code State Database': ['vscdb', 'backup'] },
        });

        if (picked && picked[0]) {
          chosenPath = picked[0].fsPath;
        }
      }

      if (!chosenPath) {
        return;
      }

      try {
        const targetKeys = [
          KEYS.oauth,
          KEYS.userStatus,
          KEYS.modelCredits,
          KEYS.profileUrl,
          KEYS.legacyInit,
        ];
        const values = await readKeys(chosenPath, targetKeys);
        const hasAuth = Boolean(values[KEYS.oauth] || values[KEYS.legacyInit]);
        if (!hasAuth) {
          vscode.window.showWarningMessage('Switchyard: No auth credentials found in the selected file.');
          return;
        }

        const identity = parseSnapshot(values);
        const email = identity.email || `imported-${identity.fingerprint.slice(0, 6)}`;

        const label = await vscode.window.showInputBox({
          title: 'Import Account to Switchyard',
          prompt: `Enter an optional label for ${email}`,
          value: 'Account B',
        });

        const meta = await store.upsertFromSnapshot({
          values,
          capturedAt: Date.now(),
        }, label);

        await panelProvider.push();
        vscode.window.showInformationMessage(`Switchyard: Successfully imported ${meta.email}!`);
      } catch (err) {
        logger.error('Failed to import account from database', err);
        vscode.window.showErrorMessage(`Switchyard: Failed to import account: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // switchyard.openSettings: open in-panel settings
    vscode.commands.registerCommand('switchyard.openSettings', async () => {
      await vscode.commands.executeCommand('agSwitchyard.panel.focus');
      await panelProvider.showSettings();
    })
  );

  // 8. Initial Detection & Sync
  // detectAndRefresh is also triggered by resolveWebviewView when the panel appears,
  // but we call it here too for activation-time detection before the panel is shown.
  void panelProvider.detectAndRefresh();
}

export function deactivate(): void {
  // Handled automatically via subscriptions
}
