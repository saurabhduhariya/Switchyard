import * as vscode from 'vscode';
import { PanelProvider } from './ui/PanelProvider';

export function activate(context: vscode.ExtensionContext): void {
  const panelProvider = new PanelProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('switchyard.addAccount', () => {
      vscode.window.showInformationMessage('Switchyard: Add Account (Coming in Phase 4/7)');
    }),
    vscode.commands.registerCommand('switchyard.switchAccount', () => {
      vscode.window.showInformationMessage('Switchyard: Switch Account (Coming in Phase 5/6)');
    }),
    vscode.commands.registerCommand('switchyard.refresh', async () => {
      await panelProvider.push();
      vscode.window.showInformationMessage('Switchyard: Refreshed');
    }),
    vscode.commands.registerCommand('switchyard.restoreBackup', () => {
      vscode.window.showInformationMessage('Switchyard: Restore Backup (Coming in Phase 7)');
    })
  );
}

export function deactivate(): void {
  // Cleanup on deactivation
}
