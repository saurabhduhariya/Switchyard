import * as vscode from 'vscode';
import * as crypto from 'node:crypto';

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

    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      switch (msg.type) {
        case 'ready':
          void this.push();
          break;
      }
    });
  }

  public async push(): Promise<void> {
    await this.view?.webview.postMessage({
      type: 'state',
      accounts: [],
      activeId: undefined,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));

    return /* html */`<!doctype html>
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
