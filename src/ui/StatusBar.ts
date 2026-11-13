import * as vscode from 'vscode';
import type { AccountMeta } from '../shared/messages';
import { accountDisplayName } from '../shared/accountName';

/**
 * Status bar item showing the current active account email.
 */
export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50
    );
    this.item.command = 'switchyard.switchAccount';
    this.item.tooltip = 'Click to switch account';
    this.item.name = 'Switchyard Account';
  }

  /** Update the status bar with the currently active account. */
  /** `hideEmails` shows the account's label (never its email) instead. */
  public update(accounts: AccountMeta[], activeId?: string, hideEmails = false): void {
    const active = accounts.find((a) => a.id === activeId);
    if (active) {
      if (hideEmails) {
        const name = accountDisplayName(active, true);
        this.item.text = `$(account) ${name}`;
        this.item.tooltip = `Active Account: ${name} • Click to switch`;
      } else {
        this.item.text = `$(account) ${active.email}`;
        this.item.tooltip = active.label
          ? `Active Account: ${active.email} (${active.label}) • Click to switch`
          : `Active Account: ${active.email} • Click to switch`;
      }
      this.item.show();
    } else if (accounts.length === 0) {
      this.item.hide();
    } else {
      this.item.text = '$(account) No active account';
      this.item.tooltip = 'Switchyard: Click to select an active account';
      this.item.show();
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}
