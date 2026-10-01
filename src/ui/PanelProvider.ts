import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { AccountMeta, ToHost, ToWebview } from '../shared/messages';

/** Hard-coded fake accounts for Phase 2 round-trip testing. */
const MOCK_ACCOUNTS: AccountMeta[] = [
  {
    id: 'acc-1',
    email: 'saurabhduhariya2007@gmail.com',
    label: 'Personal',
    plan: 'Pro',
    addedAt: Date.now() - 30 * 86_400_000,
    lastUsedAt: Date.now() - 2 * 3_600_000,
  },
  {
    id: 'acc-2',
    email: 'saurabh@company.dev',
    label: 'Work',
    plan: 'Enterprise',
    addedAt: Date.now() - 20 * 86_400_000,
    lastUsedAt: Date.now() - 86_400_000,
  },
  {
    id: 'acc-3',
    email: 'freelance.saurabh@outlook.com',
    addedAt: Date.now() - 10 * 86_400_000,
    lastUsedAt: Date.now() - 5 * 86_400_000,
  },
];

let currentActiveId = 'acc-1';

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agSwitchyard.panel';
  private view?: vscode.WebviewView;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((msg: ToHost) => {
      switch (msg.type) {
        case 'ready':
          void this.push();
          break;

        case 'switch':
          void this.handleSwitch(msg.id);
          break;

        case 'add':
          vscode.window.showInformationMessage(
            'Switchyard: "Add Account" will be implemented in Phase 4.'
          );
          break;

        case 'rename':
          vscode.window.showInformationMessage(
            `Switchyard: Renamed ${msg.id} → "${msg.label}" (mock)`
          );
          break;

        case 'remove':
          vscode.window.showInformationMessage(
            `Switchyard: Remove ${msg.id} (mock, not implemented yet)`
          );
          break;

        case 'openSettings':
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'switchyard'
          );
          break;

        case 'revealProfile':
          vscode.window.showInformationMessage(
            `Switchyard: Reveal profile for ${msg.id} (mock)`
          );
          break;
      }
    });
  }

  /** Push state to webview. */
  public async push(): Promise<void> {
    const msg: ToWebview = {
      type: 'state',
      accounts: MOCK_ACCOUNTS,
      activeId: currentActiveId,
    };
    await this.view?.webview.postMessage(msg);
  }

  /** Return mock accounts for Quick Pick. */
  public getAccounts(): AccountMeta[] {
    return MOCK_ACCOUNTS;
  }

  public getActiveId(): string {
    return currentActiveId;
  }

  /** Simulate switching: show busy overlay for 2s, then update state. */
  private async handleSwitch(id: string): Promise<void> {
    const account = MOCK_ACCOUNTS.find((a) => a.id === id);
    const label = account?.email ?? id;

    const busyMsg: ToWebview = {
      type: 'busy',
      message: `Switching to ${label}…`,
    };
    await this.view?.webview.postMessage(busyMsg);

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    currentActiveId = id;
    await this.push();

    vscode.window.showInformationMessage(`Switchyard: Switched to ${label} (mock)`);
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
