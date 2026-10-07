import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { AccountStore } from '../accounts/AccountStore';
import { AuthDetector } from '../accounts/AuthDetector';
import { createAccountId, Snapshot } from '../accounts/types';
import { CaptureManager } from '../capture/CaptureManager';
import type { AccountMeta, AddAccountGuideState, ToHost, ToWebview } from '../shared/messages';
import { Logger } from '../util/logger';
import { StatusBar } from './StatusBar';
import { SwitchEngine } from '../switch/SwitchEngine';
import { QuotaCollector } from '../quota/QuotaCollector';

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agSwitchyard.panel';
  private view?: vscode.WebviewView;

  private pendingSnapshot?: Snapshot;
  private lastDetectedHash?: string;
  private lastSnapshotUpdateMap = new Map<string, number>();
  private _detecting = false;
  private dismissedSignOutBanner = false;
  private readonly quotaCollector: QuotaCollector;
  private quotaTimer?: NodeJS.Timeout;
  private captureManager?: CaptureManager;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: AccountStore,
    private readonly detector: AuthDetector | undefined,
    private readonly logger: Logger,
    private readonly statusBar: StatusBar,
    private switchEngine?: SwitchEngine
  ) {
    this.quotaCollector = new QuotaCollector(this.logger);
  }

  public setSwitchEngine(switchEngine: SwitchEngine): void {
    this.switchEngine = switchEngine;
  }

  public setCaptureManager(captureManager: CaptureManager): void {
    this.captureManager = captureManager;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.html(view.webview);

    if (!this.quotaTimer) {
      this.quotaTimer = setInterval(() => {
        if (this.view?.visible) {
          void this.refreshActiveQuota();
        }
      }, 60_000);
    }

    view.webview.onDidReceiveMessage(async (msg: ToHost) => {
      this.logger.info(`Received webview message: ${msg.type}`);
      try {
        switch (msg.type) {
          case 'ready':
            await this.detectAndRefresh();
            break;

          case 'saveDetected':
            await this.handleSaveDetected();
            break;

          case 'add':
            await vscode.commands.executeCommand('switchyard.addAccount');
            break;

          case 'addNewAccount':
            await this.handleAddNewAccount();
            break;

          case 'cancelAddAccount':
            await this.handleCancelAddAccount();
            break;

          case 'signIn':
            await this.handleSignIn();
            break;

          case 'reauth':
            await this.handleReauth(msg.id);
            break;

          case 'togglePin':
            await this.handleTogglePin(msg.id);
            break;

          case 'openBackupsFolder':
            await vscode.commands.executeCommand('switchyard.openBackupsFolder');
            break;

          case 'restoreBackup':
            await vscode.commands.executeCommand('switchyard.restoreBackup');
            break;

          case 'rename':
            await this.handleRename(msg.id, msg.label);
            break;

          case 'remove':
            await this.handleRemove(msg.id);
            break;

          case 'switch':
            await this.handleSwitch(msg.id);
            break;

          case 'dismissToast':
            // Only clear pendingSnapshot on explicit dismiss (NOT on save)
            this.pendingSnapshot = undefined;
            break;

          case 'openSettings':
            await this.view?.webview.postMessage({ type: 'openSettings' });
            break;

          case 'openSettingsEditor':
            await vscode.commands.executeCommand('workbench.action.openSettings', 'switchyard');
            break;

          case 'updateSetting': {
            const config = vscode.workspace.getConfiguration('switchyard');
            await config.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
            await this.push();
            break;
          }

          case 'revealProfile':
            await this.handleRevealProfile(msg.id);
            break;

          case 'copySettings':
            await this.handleCopySettings(msg.id);
            break;

          case 'import':
            await vscode.commands.executeCommand('switchyard.importAccount');
            break;

          case 'refreshQuota':
            await this.handleRefreshQuota(msg.accountId);
            break;

          case 'saveCaptured':
            await this.handleSaveCaptured(msg.label);
            break;

          case 'cancelCapture':
            await this.handleCancelCapture();
            break;

          case 'reopenCaptureWindow':
            await this.handleReopenCaptureWindow();
            break;

          case 'finishCapture':
            await this.handleFinishCapture();
            break;
        }
      } catch (err) {
        this.logger.error('Failed to handle webview message', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.view?.webview.postMessage({ type: 'error', message: errorMsg });
      }
    });

    // Immediately detect and push state (detectAndRefresh now always calls push)
    void this.detectAndRefresh();
  }

  /**
   * Pushes the current state of accounts, active ID, and masking preference to the webview.
   */
  public async push(overrides?: { unsupported?: { reason: string; version?: string } }): Promise<void> {
    const rawAccounts = await this.store.list();
    const activeId = await this.store.activeId();
    const config = vscode.workspace.getConfiguration('switchyard');
    const maskEmails = config.get<boolean>('maskEmails', false);
    const mode = config.get<'profile' | 'tokenSwap'>('mode', 'tokenSwap');
    const confirmBeforeSwitch = config.get<boolean>('confirmBeforeSwitch', true);
    const backupRetention = config.get<number>('backupRetention', 5);

    const pinnedIds = this.ctx.globalState?.get<string[]>('switchyard.pinned', []) ?? [];
    const accounts = rawAccounts.map((acc) => ({
      ...acc,
      pinned: pinnedIds.includes(acc.id),
    }));

    // Get capture session state
    const captureSession = this.captureManager?.getCurrentSession();

    // Check addingAccount guide state
    let addAccountGuide: AddAccountGuideState | undefined;
    const addingState = this.ctx.globalState?.get<{
      previousId?: string;
      previousEmail?: string;
      expectedEmail?: string;
    } | undefined>('switchyard.addingAccount');

    if (addingState) {
      if (!activeId) {
        addAccountGuide = {
          active: true,
          previousEmail: addingState.previousEmail,
          previousId: addingState.previousId,
          expectedEmail: addingState.expectedEmail,
        };
      } else {
        // Active account detected, clear addingAccount guide
        await this.ctx.globalState?.update('switchyard.addingAccount', undefined);
      }
    } else if (!activeId && rawAccounts.length > 0 && !this.dismissedSignOutBanner) {
      addAccountGuide = {
        active: true,
      };
    }


    const msg: ToWebview = {
      type: 'state',
      accounts,
      activeId,
      maskEmails,
      mode,
      confirmBeforeSwitch,
      backupRetention,
      addAccountGuide,
      captureSession: captureSession ? {
        state: captureSession.state,
        detectedEmail: captureSession.detectedEmail,
        diagnostic: captureSession.diagnostic,
        error: captureSession.error,
      } : undefined,
      ...overrides,
    };

    await this.view?.webview.postMessage(msg);
    this.statusBar.update(accounts, activeId, maskEmails);
    void vscode.commands.executeCommand('setContext', 'switchyard.hasAccounts', accounts.length > 0);
  }

  public async showSettings(): Promise<void> {
    await this.view?.webview.postMessage({ type: 'openSettings' });
  }


  /**
   * Detects the active session in state.vscdb and refreshes state.
   * If a saved account is detected, keeps its session fresh (rate limited to 60s).
   * If an unsaved account is detected, triggers the new login toast.
   * ALWAYS pushes updated state to the webview at the end.
   */
  public async detectAndRefresh(force = false): Promise<void> {
    if (this._detecting) {
      return;
    }
    this._detecting = true;

    try {
      if (!this.detector) {
        await this.push();
        return;
      }

      const result = await this.detector.detectActive();

      if ('unsupported' in result) {
        this.logger.debug('Active detection unsupported or signed out:', result.reason);
        this.pendingSnapshot = undefined;
        await this.store.setActive(undefined);
        await this.push({
          unsupported: {
            reason: result.reason,
            version: result.version,
          },
        });
        return;
      }

      if ('partial' in result) {
        // Auth tokens are in the OS secret store, not in state.vscdb.
        // Try to match the profileUrl against saved accounts.
        this.logger.debug('Partial detection: auth tokens likely in OS secret store');
        const accounts = await this.store.list();

        if (accounts.length > 0) {
          // Try to match by profileUrl if available
          let matched: AccountMeta | undefined;

          if (result.profileUrl) {
            // Match by profileUrl stored in any saved account's snapshot
            for (const acc of accounts) {
              const snap = await this.store.loadSnapshot(acc.id);
              if (snap?.values?.['antigravity.profileUrl'] === result.profileUrl) {
                matched = acc;
                break;
              }
            }
          }

          if (!matched && accounts.length === 1) {
            // Only one account saved — reasonable to assume it's the active one
            matched = accounts[0];
          }

          if (matched) {
            this.dismissedSignOutBanner = false;
            this.pendingSnapshot = undefined;
            const currentActive = await this.store.activeId();
            if (currentActive !== matched.id) {
              await this.store.setActive(matched.id);
              this.logger.info(`Partial detection matched account: ${matched.email}`);
            }
          } else {
            // Multiple accounts saved but can't determine which is active.
            // Don't clear activeId — keep last known active to avoid false sign-out banner.
            this.logger.debug('Partial detection: could not match to a specific saved account');
          }
        }

        await this.push();
        return;
      }

      const { identity, snapshot } = result;
      const contentHash = crypto.createHash('sha256').update(JSON.stringify(snapshot.values)).digest('hex');

      // Match detected account against store
      let matched: AccountMeta | undefined;
      if (identity.email) {
        matched = await this.store.getByEmail(identity.email);
      }
      if (!matched && identity.fingerprint) {
        matched = await this.store.getByFingerprint(identity.fingerprint);
      }
      if (!matched) {
        matched = await this.store.get(`fp-${identity.fingerprint}`);
      }
      if (!matched && snapshot.values['antigravity.profileUrl']) {
        const targetUrl = snapshot.values['antigravity.profileUrl'];
        const accounts = await this.store.list();
        for (const acc of accounts) {
          const snap = await this.store.loadSnapshot(acc.id);
          if (snap?.values?.['antigravity.profileUrl'] === targetUrl) {
            matched = acc;
            break;
          }
        }
      }

      if (matched) {
        // Matched a saved account — clear any pending toast & guide
        this.dismissedSignOutBanner = false;
        this.pendingSnapshot = undefined;
        await this.ctx.globalState?.update('switchyard.addingAccount', undefined);

        if (!identity.email && matched.email) {
          identity.email = matched.email;
        }

        const currentActive = await this.store.activeId();
        if (currentActive !== matched.id) {
          await this.store.setActive(matched.id);
          this.logger.info(`Detected active account switched to: ${matched.email}`);
        }

        // Token rotation sync: update stored snapshot if changed and >= 60s elapsed
        const lastUpdate = this.lastSnapshotUpdateMap.get(matched.id) || 0;
        const now = Date.now();
        if (contentHash !== this.lastDetectedHash && (now - lastUpdate >= 60_000 || force)) {
          this.lastSnapshotUpdateMap.set(matched.id, now);
          this.lastDetectedHash = contentHash;
          await this.store.saveSnapshot(matched.id, snapshot);
          this.logger.debug(`Synchronized rotated snapshot for ${matched.email}`);
        }
      } else {
        // Unsaved account detected (first-run capture or new login)
        this.pendingSnapshot = snapshot;
        const emailDisplay = identity.email || `Account (${identity.fingerprint.slice(0, 6)})`;
        const candidateId = identity.email ? createAccountId(identity.email) : `fp-${identity.fingerprint}`;

        // Clear activeId so the old account is not shown as active
        await this.store.setActive(undefined);

        await this.view?.webview.postMessage({
          type: 'toast',
          message: `Save ${emailDisplay}?`,
          accountId: candidateId,
        });

        void vscode.window.showInformationMessage(
          `Switchyard detected account: ${emailDisplay}. Save to Switchyard?`,
          'Save Account',
          'Ignore'
        ).then(async (selection) => {
          if (selection === 'Save Account') {
            await this.handleSaveDetected();
          }
        });
      }

      // Refresh active account quota
      const activeAccountId = await this.store.activeId();
      if (activeAccountId) {
        try {
          const quota = await this.quotaCollector.getQuotaSummary(this.detector?.databasePath);
          if (quota) {
            await this.store.updateQuota(activeAccountId, quota);
          }
        } catch (err) {
          this.logger.debug('Failed to update quota summary:', err);
        }
      }

      // Always push updated state to the webview
      await this.push();
    } catch (err) {
      this.logger.error('Error in detectAndRefresh:', err);
      // Still push state even on error so the webview isn't stuck in loading
      await this.push();
    } finally {
      this._detecting = false;
    }
  }

  /**
   * Refreshes the currently active account's quota in the background.
   */
  public async refreshActiveQuota(): Promise<void> {
    const activeId = await this.store.activeId();
    if (!activeId) return;
    try {
      const quota = await this.quotaCollector.getQuotaSummary(this.detector?.databasePath);
      if (quota) {
        await this.store.updateQuota(activeId, quota);
        await this.push();
      }
    } catch (err) {
      this.logger.debug('Periodic quota refresh failed:', err);
    }
  }

  /**
   * Manually refreshes quota for a specific account or active account.
   */
  private async handleRefreshQuota(accountId?: string): Promise<void> {
    const targetId = accountId || (await this.store.activeId());
    if (!targetId) return;
    try {
      const quota = await this.quotaCollector.getQuotaSummary(this.detector?.databasePath);
      if (quota) {
        await this.store.updateQuota(targetId, quota);
        await this.push();
      }
    } catch (err) {
      this.logger.error('Failed to manually refresh quota:', err);
    }
  }

  /**
   * Saves the detected unsaved session when the user clicks 'Save' on the toast.
   */
  public async handleSaveDetected(): Promise<void> {
    this.logger.info('Handling saveDetected request...');

    if (!this.pendingSnapshot && this.detector) {
      const activeCheck = await this.detector.detectActive();
      if (!('unsupported' in activeCheck) && !('partial' in activeCheck)) {
        this.pendingSnapshot = activeCheck.snapshot;
      }
    }

    if (!this.pendingSnapshot) {
      vscode.window.showWarningMessage('No active Google session found to save.');
      await this.push();
      return;
    }

    const contentHash = crypto.createHash('sha256').update(JSON.stringify(this.pendingSnapshot.values)).digest('hex');
    const meta = await this.store.upsertFromSnapshot(this.pendingSnapshot);

    if (meta.email.startsWith('unknown-') || !meta.email.includes('@') || meta.email.endsWith('@switchyard.local')) {
      const enteredEmail = await vscode.window.showInputBox({
        title: 'Save Account',
        prompt: 'Enter the Google account email address for this session',
        placeHolder: 'e.g. user@gmail.com',
      });
      if (enteredEmail && enteredEmail.trim()) {
        await this.store.updateMeta(meta.id, { email: enteredEmail.trim() });
        meta.email = enteredEmail.trim();
      }
    }

    await this.store.setActive(meta.id);
    await this.ctx.globalState?.update('switchyard.addingAccount', undefined);
    this.lastDetectedHash = contentHash;
    this.lastSnapshotUpdateMap.set(meta.id, Date.now());
    this.pendingSnapshot = undefined;
    await this.push();

    this.logger.info(`Successfully saved account: ${meta.email}`);
    vscode.window.showInformationMessage(`Saved account ${meta.email}`);
  }

  /**
   * Prompts user for a new label and renames the account.
   */
  public async handleRename(id: string, newLabel?: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    let label = newLabel;
    if (label === undefined || label === '') {
      label = await vscode.window.showInputBox({
        title: `Rename Account: ${account.email}`,
        prompt: 'Enter a display label for this account',
        value: account.label || '',
        placeHolder: 'e.g. Work, Personal, Client A',
      });
      if (label === undefined) return; // User cancelled
    }

    await this.store.rename(id, label);
    await this.push();
  }

  /**
   * Shows a confirmation modal dialog before deleting the account and secret credentials.
   */
  public async handleRemove(id: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    const answer = await vscode.window.showWarningMessage(
      `Remove account ${account.email}? This will delete the saved session from your secure credentials.`,
      { modal: true },
      'Remove'
    );

    if (answer === 'Remove') {
      await this.store.remove(id);
      await this.detectAndRefresh(true);
      vscode.window.showInformationMessage(`Removed account ${account.email}`);
    }
  }

  /**
   * Handles switching to an account.
   */
  public async handleSwitch(id: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    if (!this.switchEngine) {
      vscode.window.showErrorMessage('Switchyard: Switch engine is not initialized.');
      return;
    }

    const mode = this.switchEngine.mode;

    if (mode === 'tokenSwap') {
      const activeId = await this.store.activeId();
      if (id === activeId) {
        vscode.window.showInformationMessage(`Account ${account.email} is already active.`);
        return;
      }
      await this.view?.webview.postMessage({
        type: 'busy',
        message: `Switching to ${account.email}…`,
      });
    }

    const result = await this.switchEngine.switchTo(id);
    if (!result.ok) {
      if (result.error) {
        await this.view?.webview.postMessage({
          type: 'error',
          message: result.error,
        });
        vscode.window.showErrorMessage(`Switchyard: ${result.error}`);
      }
      await this.push();
    } else {
      await this.push();
    }
  }

  public async handleRevealProfile(id: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    if (this.switchEngine?.revealProfile) {
      await this.switchEngine.revealProfile(id);
    } else {
      vscode.window.showInformationMessage(`Profile folder for ${account.email}`);
    }
  }

  public async handleCopySettings(id: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    const answer = await vscode.window.showWarningMessage(
      `Copy settings.json, keybindings.json, and snippets from this window into the isolated profile for ${account.email}? Existing configuration in that profile will be overwritten.`,
      { modal: true },
      'Copy Settings',
      'Cancel'
    );

    if (answer === 'Copy Settings') {
      if (this.switchEngine?.copySettingsToProfile) {
        const result = await this.switchEngine.copySettingsToProfile(id);
        if (result.ok) {
          vscode.window.showInformationMessage(
            `Successfully copied ${result.count} configuration item(s) to ${account.email}'s profile.`
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to copy settings: ${result.error || 'Unknown error'}`
          );
        }
      }
    }
  }

  public async getAccounts(): Promise<AccountMeta[]> {
    return this.store.list();
  }

  public async getActiveId(): Promise<string | undefined> {
    return this.store.activeId();
  }

  public async handleAddNewAccount(): Promise<void> {
    this.dismissedSignOutBanner = false;
    const config = vscode.workspace.getConfiguration('switchyard');
    const mode = config.get<'profile' | 'tokenSwap'>('mode', 'tokenSwap');
    const addAccountMethod = config.get<'sideWindow' | 'signOutRestart'>('addAccountMethod', 'sideWindow');

    if (mode === 'profile') {
      const label = await vscode.window.showInputBox({
        title: 'Add Account (Profile Mode)',
        prompt: 'Enter a label or identifier for the new isolated profile',
        placeHolder: 'e.g. Work, Secondary, Client B',
      });
      if (!label) return;
      const meta = await this.store.upsertFromSnapshot({
        values: {},
        capturedAt: Date.now(),
      }, label);
      await this.push();
      await this.handleSwitch(meta.id);
      return;
    }

    // Token Swap mode: check preferred method
    if (addAccountMethod === 'sideWindow' && this.captureManager) {
      // Use side-window capture flow
      const result = await this.captureManager.startCapture();
      if (!result.ok) {
        vscode.window.showErrorMessage(`Switchyard: Failed to start capture: ${result.error}`);
        // Fall back to legacy flow
        await this.handleAddNewAccountLegacy();
      }
      // UI will update via capture state change callback
      return;
    }

    // Fall back to legacy sign-out-restart flow
    await this.handleAddNewAccountLegacy();
  }

  /**
   * Legacy add account flow (sign out and restart).
   */
  private async handleAddNewAccountLegacy(): Promise<void> {
    // Token Swap mode: modal explanation
    const choice = await vscode.window.showInformationMessage(
      'Switchyard will save your current session, sign you out of Antigravity, and restart the IDE. After restart, sign in with your new Google account; Switchyard will detect and save it automatically.',
      { modal: true },
      'Sign Out & Restart',
      'Cancel'
    );

    if (choice === 'Sign Out & Restart') {
      if (this.switchEngine?.signOutAndRestart) {
        await this.switchEngine.signOutAndRestart();
      } else {
        vscode.window.showErrorMessage('Switchyard: Switch engine does not support signing out.');
      }
    }
  }

  /**
   * Handles saving the captured account with optional label.
   */
  public async handleSaveCaptured(label?: string): Promise<void> {
    if (!this.captureManager) {
      vscode.window.showErrorMessage('Switchyard: Capture manager not initialized.');
      return;
    }

    const result = await this.captureManager.saveAccount(label);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Switchyard: Failed to save account: ${result.error}`);
    } else {
      vscode.window.showInformationMessage('Switchyard: Account saved successfully!');
    }
    await this.push();
  }

  /**
   * Manual finish: closes the side window, flushes its DB and reads the login.
   */
  public async handleFinishCapture(): Promise<void> {
    if (!this.captureManager) {
      return;
    }
    const result = await this.captureManager.finishSignIn();
    if (!result.ok && result.error) {
      vscode.window.showWarningMessage(`Switchyard: ${result.error}`);
    }
    await this.push();
  }

  /**
   * Handles canceling the capture session.
   */
  public async handleCancelCapture(): Promise<void> {
    if (!this.captureManager) {
      return;
    }

    await this.captureManager.cancel();
    await this.push();
  }

  /**
   * Handles reopening the capture window.
   */
  public async handleReopenCaptureWindow(): Promise<void> {
    if (!this.captureManager) {
      return;
    }

    // "Try Again" after a timeout/failure must start a fresh session
    const current = this.captureManager.getCurrentSession();
    if (current && ['timedOut', 'failed', 'cancelled'].includes(current.state)) {
      const started = await this.captureManager.startCapture();
      if (!started.ok) {
        vscode.window.showErrorMessage(`Switchyard: Failed to start capture: ${started.error}`);
      }
      return;
    }

    const result = await this.captureManager.reopenWindow();
    if (!result.ok) {
      vscode.window.showErrorMessage(`Switchyard: Failed to reopen window: ${result.error}`);
    }
  }

  public async handleCancelAddAccount(): Promise<void> {
    this.dismissedSignOutBanner = true;
    const addingState = this.ctx.globalState?.get<{
      previousId?: string;
      previousEmail?: string;
    } | undefined>('switchyard.addingAccount');

    await this.ctx.globalState?.update('switchyard.addingAccount', undefined);

    if (addingState?.previousId) {
      const choice = await vscode.window.showInformationMessage(
        `Cancelled adding account. Restore session for ${addingState.previousEmail || 'previous account'}?`,
        'Restore Account',
        'Dismiss'
      );
      if (choice === 'Restore Account') {
        await this.handleSwitch(addingState.previousId);
        return;
      }
    }
    await this.push();
  }

  public async handleSignIn(): Promise<void> {
    // 1. Refresh active check first in case the user is already signed in
    await this.detectAndRefresh(true);
    const activeId = await this.store.activeId();
    if (activeId) {
      const activeAcc = await this.store.get(activeId);
      void vscode.window.showInformationMessage(
        `Antigravity is already signed in with ${activeAcc?.email || 'your active account'}.`
      );
      return;
    }

    // 2. Try auth session request
    try {
      await vscode.authentication.getSession('antigravity_auth', [], { createIfNone: true });
      return;
    } catch {
      // try command fallback
    }

    const candidateCommands = [
      'antigravity.login',
      'antigravity.signin',
      'antigravity.signIn',
      'workbench.action.accounts.manage',
    ];
    let executed = false;
    for (const cmd of candidateCommands) {
      try {
        await vscode.commands.executeCommand(cmd);
        executed = true;
        break;
      } catch {
        // try next
      }
    }
    if (!executed) {
      void vscode.window.showInformationMessage(
        'To sign in: Click the profile avatar icon in the top-right of the Antigravity window or the Accounts icon at the bottom of the Activity Bar.'
      );
    }
  }


  public async handleReauth(id: string): Promise<void> {
    const account = await this.store.get(id);
    if (!account) return;

    const choice = await vscode.window.showInformationMessage(
      `Re-authenticate ${account.email}? We'll sign you out and restart so you can sign in with ${account.email} again.`,
      { modal: true },
      'Sign Out & Restart',
      'Cancel'
    );

    if (choice === 'Sign Out & Restart') {
      if (this.switchEngine?.signOutAndRestart) {
        await this.switchEngine.signOutAndRestart({
          previousId: account.id,
          previousEmail: account.email,
          expectedEmail: account.email,
        });
      }
    }
  }

  public async handleTogglePin(id: string): Promise<void> {
    const pinnedList = this.ctx.globalState?.get<string[]>('switchyard.pinned', []) ?? [];
    const pinned = new Set(pinnedList);
    if (pinned.has(id)) {
      pinned.delete(id);
    } else {
      pinned.add(id);
    }
    await this.ctx.globalState?.update('switchyard.pinned', Array.from(pinned));
    await this.push();
  }



  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));

    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${css}">
  <title>Switchyard</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
