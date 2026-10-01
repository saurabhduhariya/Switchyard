import * as vscode from 'vscode';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';

export function activate(context: vscode.ExtensionContext): void {
  const panelProvider = new PanelProvider(context);
  const statusBar = new StatusBar();

  // Update status bar with mock data on activation
  statusBar.update(panelProvider.getAccounts(), panelProvider.getActiveId());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    statusBar
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('switchyard.addAccount', () => {
      vscode.window.showInformationMessage('Switchyard: Add Account (Coming in Phase 4/7)');
    }),

    vscode.commands.registerCommand('switchyard.switchAccount', async () => {
      const accounts = panelProvider.getAccounts();
      const activeId = panelProvider.getActiveId();

      if (accounts.length === 0) {
        vscode.window.showInformationMessage('Switchyard: No saved accounts. Use the sidebar to add one.');
        return;
      }

      const items = accounts.map((acc) => ({
        label: acc.id === activeId ? `$(check) ${acc.email}` : acc.email,
        description: acc.label || '',
        detail: acc.id === activeId ? 'Currently active' : undefined,
        id: acc.id,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an account to switch to',
        title: 'Switchyard – Switch Account',
      });

      if (picked && picked.id !== activeId) {
        vscode.window.showInformationMessage(
          `Switchyard: Would switch to ${picked.label} (mock — real switch comes in Phase 5/6)`
        );
      }
    }),

    vscode.commands.registerCommand('switchyard.refresh', async () => {
      await panelProvider.push();
      statusBar.update(panelProvider.getAccounts(), panelProvider.getActiveId());
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
