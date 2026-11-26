import * as vscode from 'vscode';
import type { AccountMeta } from '../shared/messages';
import {
  buildStatusBarPresentation,
  TRUSTED_STATUS_BAR_COMMANDS,
  type StatusBarBuildOptions,
  type StatusBarSeverity,
} from '../shared/statusBarModel';

function createItem(
  id: string,
  priority: number,
  name: string,
  command: string
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, priority);
  item.name = name;
  item.command = command;
  return item;
}

function severityBackground(severity: StatusBarSeverity): vscode.ThemeColor | undefined {
  if (severity === 'none' || typeof vscode.ThemeColor !== 'function') return undefined;
  return new vscode.ThemeColor(
    severity === 'error' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground'
  );
}

function makeTooltip(markdown: string): string | vscode.MarkdownString {
  if (!markdown || typeof vscode.MarkdownString !== 'function') return markdown;
  const md = new vscode.MarkdownString(markdown, true);
  md.isTrusted = { enabledCommands: [...TRUSTED_STATUS_BAR_COMMANDS] };
  return md;
}

/**
 * Dual status bar controller showing active account and configurable quota telemetry.
 */
export class StatusBar implements vscode.Disposable {
  private readonly accountItem: vscode.StatusBarItem;
  private readonly quotaItem: vscode.StatusBarItem;

  constructor() {
    this.accountItem = createItem(
      'switchyard.statusBar.account',
      50,
      'Switchyard Account',
      'switchyard.switchAccount'
    );
    this.quotaItem = createItem(
      'switchyard.statusBar.quota',
      49,
      'Switchyard Quota',
      'agSwitchyard.panel.focus'
    );
  }

  public update(
    accounts: AccountMeta[],
    activeId?: string,
    hideEmails = false,
    options: StatusBarBuildOptions = {}
  ): void {
    const view = buildStatusBarPresentation(accounts, activeId, hideEmails, options);
    const tooltip = makeTooltip(view.tooltipMarkdown);

    if (view.accountItem.visible) {
      this.accountItem.text = view.accountItem.text;
      this.accountItem.tooltip = tooltip;
      this.accountItem.backgroundColor = severityBackground(view.accountItem.severity);
      this.accountItem.show();
    } else {
      this.accountItem.backgroundColor = undefined;
      this.accountItem.hide();
    }

    if (view.quotaItem.visible) {
      this.quotaItem.text = view.quotaItem.text;
      this.quotaItem.tooltip = tooltip;
      this.quotaItem.command = view.quotaItem.command;
      this.quotaItem.backgroundColor = severityBackground(view.quotaItem.severity);
      this.quotaItem.show();
    } else {
      this.quotaItem.backgroundColor = undefined;
      this.quotaItem.hide();
    }
  }

  public dispose(): void {
    this.accountItem.dispose();
    this.quotaItem.dispose();
  }
}
