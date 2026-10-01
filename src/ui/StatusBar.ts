import * as vscode from 'vscode';
import type { AccountMeta } from '../shared/messages';

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
  public update(accounts: AccountMeta[], activeId?: string, maskEmails = false): void {
    const active = accounts.find((a) => a.id === activeId);
    if (active) {
      const displayEmail = maskEmails
        ? active.email.replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, '$1****$2')
        : active.email;
      this.item.text = `$(account) ${displayEmail}`;
      this.item.tooltip = active.label
        ? `Active Account: ${displayEmail} (${active.label}) • Click to switch`
        : `Active Account: ${displayEmail} • Click to switch`;
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
