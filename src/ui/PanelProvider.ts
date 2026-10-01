import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { AccountStore } from '../accounts/AccountStore';
import { AuthDetector } from '../accounts/AuthDetector';
import { createAccountId, Snapshot } from '../accounts/types';
import type { AccountMeta, ToHost, ToWebview } from '../shared/messages';
import { Logger } from '../util/logger';
import { StatusBar } from './StatusBar';
import { SwitchEngine } from '../switch/SwitchEngine';

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agSwitchyard.panel';
  private view?: vscode.WebviewView;

  private pendingSnapshot?: Snapshot;
  private lastDetectedHash?: string;
  private lastSnapshotUpdateMap = new Map<string, number>();
  private _detecting = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: AccountStore,
    private readonly detector: AuthDetector | undefined,
    private readonly logger: Logger,
    private readonly statusBar: StatusBar,
    private switchEngine?: SwitchEngine
  ) {}

  public setSwitchEngine(switchEngine: SwitchEngine): void {
    this.switchEngine = switchEngine;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.html(view.webview);

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
            await vscode.commands.executeCommand('workbench.action.openSettings', 'switchyard');
            break;

          case 'revealProfile':
            await this.handleRevealProfile(msg.id);
            break;

          case 'copySettings':
            await this.handleCopySettings(msg.id);
            break;

          case 'import':
            await vscode.commands.executeCommand('switchyard.importAccount');
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
  public async push(): Promise<void> {
    const accounts = await this.store.list();
    const activeId = await this.store.activeId();
    const config = vscode.workspace.getConfiguration('switchyard');
    const maskEmails = config.get<boolean>('maskEmails', false);
    const mode = config.get<'profile' | 'tokenSwap'>('mode', 'profile');

    const msg: ToWebview = {
      type: 'state',
      accounts,
      activeId,
      maskEmails,
      mode,
    };

    await this.view?.webview.postMessage(msg);
    this.statusBar.update(accounts, activeId, maskEmails);
    void vscode.commands.executeCommand('setContext', 'switchyard.hasAccounts', accounts.length > 0);
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
      if (!matched) {
        matched = await this.store.get(`fp-${identity.fingerprint}`);
      }

      if (matched) {
        // Matched a saved account — clear any pending toast
        this.pendingSnapshot = undefined;

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

        await this.view?.webview.postMessage({
          type: 'toast',
          message: `Save ${emailDisplay}?`,
          accountId: candidateId,
        });
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
   * Saves the detected unsaved session when the user clicks 'Save' on the toast.
   */
  public async handleSaveDetected(): Promise<void> {
    this.logger.info('Handling saveDetected request...');

    if (!this.pendingSnapshot && this.detector) {
      const activeCheck = await this.detector.detectActive();
      if (!('unsupported' in activeCheck)) {
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
    await this.store.setActive(meta.id);
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
