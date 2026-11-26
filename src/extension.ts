import { isAntigravity26OrNewer } from './platform/agyDaemon';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore } from './accounts/AccountStore';
import { AuthDetector } from './accounts/AuthDetector';
import { parseSnapshot } from './accounts/identity';
import { CaptureManager } from './capture/CaptureManager';
import { QuotaResetNotifier } from './quota/QuotaResetNotifier';
import { isCompanionMode, setupCompanionMode, createCompanionStatusBar } from './capture/companion';
import { KEYS, OUTPUT_CHANNEL_NAME } from './constants';
import { accountDisplayName } from './shared/accountName';
import { listBackups, recoverCorruptedQuotas, restoreBackup } from './db/backup';
import { readKeys } from './db/StateDb';
import { findStateDb, getBackupsDir, getGlobalStorageDir } from './platform/paths';
import { resolveWslContextFromVscode } from './platform/wsl';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import { formatAccountQuotaBrief } from './shared/statusBarModel';
import type { StatusBarMode } from './shared/messages';
import { Logger } from './util/logger';
import { createSwitchEngine } from './switch/SwitchEngine';
import { reconcilePendingSwitch } from './switch/reconcile';

let channel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const logger = new Logger(channel);
  logger.info('Activating Switchyard extension...');

  if (isCompanionMode(context.globalStorageUri)) {
    logger.info('Running in companion mode - setting up minimal UI');
    const companionDisposable = setupCompanionMode(context, logger);
    const companionStatusBar = createCompanionStatusBar();
    context.subscriptions.push(channel, companionDisposable, companionStatusBar);
    return;
  }

  const dbPath = findStateDb({ globalStorageUriPath: context.globalStorageUri.fsPath });
  if (dbPath) {
    logger.info(`Found state.vscdb at: ${dbPath}`);
  } else {
    logger.warn('Could not locate state.vscdb database in candidate locations.');
  }

  // Check if user is running a legacy Antigravity IDE version (<= 2.5.5)
  const agyExtension = vscode.extensions.getExtension('google.google-antigravity');
  const is26Plus = Boolean(agyExtension) || isAntigravity26OrNewer(vscode.env?.appRoot);
  const dismissedOldIdeWarning = context.globalState.get<boolean>('switchyard.dismissedOldIdeNotice', false);
  if (!is26Plus && !dismissedOldIdeWarning && dbPath) {
    void readKeys(dbPath, [KEYS.oauth, KEYS.legacyInit]).then((legacyVals) => {
      if (legacyVals[KEYS.oauth] || legacyVals[KEYS.legacyInit]) {
        logger.warn('Detected legacy Antigravity IDE (<= 2.5.5): auth stored in state.vscdb without agy daemon.');
        void vscode.window
          .showWarningMessage(
            'Switchyard: You are using an older version of Antigravity IDE (<= 2.5.5). Please update Antigravity IDE to the latest version (v2.6.0+) for full OS Keychain and agy daemon support.',
            'Dismiss',
            "Don't Show Again"
          )
          .then((choice) => {
            if (choice === "Don't Show Again") {
              void context.globalState.update('switchyard.dismissedOldIdeNotice', true);
            }
          });
      }
    });
  }

  const store = new AccountStore({
    secrets: context.secrets,
    state: context.globalState,
  });

  const wslCtx = resolveWslContextFromVscode(vscode);
  const detector = new AuthDetector(dbPath, wslCtx);

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

  const captureManager = new CaptureManager({
    store,
    logger,
    globalStorageUri: context.globalStorageUri,
    extensionUri: context.extensionUri,
    memento: context.globalState,
  });

  panelProvider.setCaptureManager(captureManager);

  captureManager.onStateChange((_session) => {
    void panelProvider.push();
  });

  void captureManager.sweepStaleSessions().then(() => captureManager.resume());

  context.subscriptions.push(
    channel,
    statusBar,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => captureManager.dispose() }
  );

  void reconcilePendingSwitch(context.globalState, store, logger, dbPath).then(
    () => {
      void panelProvider.push();
    },
    (err) => {
      logger.warn('Pending switch reconciliation failed:', err);
    }
  );

  // Auto-heal any corrupted Pro/Ultra quotas from previous switch race conditions
  if (dbPath) {
    const backupDir = getBackupsDir(getGlobalStorageDir(dbPath));
    void recoverCorruptedQuotas(store, backupDir, logger).then((restored) => {
      if (restored) {
        void panelProvider.push();
      }
    });
  }

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

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void panelProvider.detectAndRefresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(() => {
      logger.info('Authentication sessions changed; triggering detectAndRefresh');
      void panelProvider.detectAndRefresh();
    })
  );

  const pollTimer = setInterval(() => {
    void panelProvider.detectAndRefresh();
  }, 5000);
  context.subscriptions.push({
    dispose: () => clearInterval(pollTimer),
  });

  const quotaNotifier = new QuotaResetNotifier({
    listAccounts: () => store.list(),
    getActiveId: () => store.activeId(),
    memento: context.globalState,
    logger,
    readSettings: () => ({
      enabled: vscode.workspace.getConfiguration('switchyard').get<boolean>('notifyOnQuotaReset', true),
    }),
    onSwitch: (id) => panelProvider.handleSwitch(id),
    onOpenPanel: async () => {
      await vscode.commands.executeCommand('workbench.view.extension.agSwitchyard');
    },
    onTurnOff: async () => {
      await vscode.workspace
        .getConfiguration('switchyard')
        .update('notifyOnQuotaReset', false, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        'Switchyard: quota reset notifications are off. Turn them back on with the setting switchyard.notifyOnQuotaReset.'
      );
    },
  });
  quotaNotifier.start();
  context.subscriptions.push({ dispose: () => quotaNotifier.dispose() });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('switchyard.mode')) {
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
      }

      if (
        e.affectsConfiguration('switchyard.maskEmails') ||
        e.affectsConfiguration('switchyard.mode') ||
        e.affectsConfiguration('switchyard.confirmBeforeSwitch') ||
        e.affectsConfiguration('switchyard.backupRetention') ||
        e.affectsConfiguration('switchyard.statusBarMode') ||
        e.affectsConfiguration('switchyard.addAccountMethod') ||
        e.affectsConfiguration('switchyard.suggestBestAccount')
      ) {
        void panelProvider.push();
      }
    })
  );

  context.subscriptions.push(
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

    vscode.commands.registerCommand('switchyard.addNewAccount', async () => {
      await panelProvider.handleAddNewAccount();
    }),

    vscode.commands.registerCommand('switchyard.openBackupsFolder', async () => {
      const storageDir = dbPath
        ? getGlobalStorageDir(dbPath)
        : path.dirname(context.globalStorageUri.fsPath);
      const backupDir = getBackupsDir(storageDir);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(backupDir));
    }),

    vscode.commands.registerCommand('switchyard.switchAccount', async (targetAccountId?: string) => {
      if (typeof targetAccountId === 'string' && targetAccountId) {
        await panelProvider.handleSwitch(targetAccountId);
        return;
      }
      const accounts = await store.list();
      const activeId = await store.activeId();

      if (accounts.length === 0) {
        vscode.window.showInformationMessage('Switchyard: No saved accounts yet. Sign in and click "Add Account".');
        return;
      }

      const config = vscode.workspace.getConfiguration('switchyard');
      const hideEmails = config.get<boolean>('maskEmails', false);
      const pinnedIds = new Set(context.globalState.get<string[]>('switchyard.pinned', []));

      const ordered = [...accounts].sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        const aPinned = pinnedIds.has(a.id);
        const bPinned = pinnedIds.has(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
      });

      const items = ordered.map((acc) => {
        const title = hideEmails ? accountDisplayName(acc, true) : acc.email;
        const isActive = acc.id === activeId;
        const isPinned = pinnedIds.has(acc.id);
        const quotaBrief = formatAccountQuotaBrief(acc, isActive);
        const detailParts: string[] = [];
        if (isActive) {
          detailParts.push('Currently active');
        } else if (isPinned) {
          detailParts.push('$(pin) Pinned');
        }
        if (quotaBrief) detailParts.push(quotaBrief);

        return {
          label: isActive ? `$(check) ${title}` : isPinned ? `$(pin) ${title}` : title,
          description: hideEmails
            ? acc.plan
              ? `(${acc.plan})`
              : ''
            : acc.label || (acc.plan ? `(${acc.plan})` : ''),
          detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
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

    vscode.commands.registerCommand('switchyard.refresh', async () => {
      await panelProvider.detectAndRefresh(true);
      vscode.window.showInformationMessage('Switchyard: Refreshed accounts and active state.');
    }),

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

    vscode.commands.registerCommand('switchyard.importAccount', async (targetDbUri?: vscode.Uri) => {
      let chosenPath: string | undefined;

      if (targetDbUri?.fsPath) {
        chosenPath = targetDbUri.fsPath;
      } else {
        const backupsDir = dbPath ? getBackupsDir(getGlobalStorageDir(dbPath)) : undefined;
        const defaultUri = backupsDir && fs.existsSync(backupsDir) ? vscode.Uri.file(backupsDir) : undefined;

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
        const hasAuth = Boolean(values[KEYS.oauth] || values[KEYS.legacyInit] || values[KEYS.userStatus]);
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

    vscode.commands.registerCommand('switchyard.openSettings', async () => {
      await vscode.commands.executeCommand('agSwitchyard.panel.focus');
      await panelProvider.showSettings();
    }),

    vscode.commands.registerCommand('switchyard.cycleNextAccount', async () => {
      await panelProvider.handleCycleNextAccount();
    }),

    vscode.commands.registerCommand('switchyard.cycleStatusBarMode', async () => {
      const modes: StatusBarMode[] = ['quota', 'compactGraph', 'burnRate', 'minimal'];
      const config = vscode.workspace.getConfiguration('switchyard');
      const current = config.get<StatusBarMode>('statusBarMode', 'quota');
      const next = modes[(modes.indexOf(current) + 1) % modes.length] ?? 'quota';
      await config.update('statusBarMode', next, vscode.ConfigurationTarget.Global);
      await panelProvider.push();
      vscode.window.setStatusBarMessage(`Switchyard status bar: ${next}`, 2500);
    })
  );

  void panelProvider.detectAndRefresh();
}

export function deactivate(): void {}
