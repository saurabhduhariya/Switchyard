<script lang="ts">
  interface VsCodeApi {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  }

  declare function acquireVsCodeApi(): VsCodeApi;

  let vscode: VsCodeApi | undefined;
  try {
    vscode = acquireVsCodeApi();
  } catch {
    // running in standalone browser dev mode
  }

  if (vscode) {
    vscode.postMessage({ type: 'ready' });
  }
</script>

<main class="container">
  <div class="header">
    <div class="brand">
      <span class="badge">Switchyard</span>
    </div>
  </div>

  <div class="content">
    <h2>Hello Switchyard</h2>
    <p class="subtitle">Multi-Account Switcher for Google Antigravity</p>
    <div class="status-card">
      <span class="status-indicator"></span>
      <span>Scaffold active · Phase 1 ready</span>
    </div>
  </div>
</main>

<style>
  :root {
    --gap: 8px;
    --radius: 6px;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-sideBar-background, #1e1e1e);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    user-select: none;
  }

  .container {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-badge-foreground, #ffffff);
    background: var(--vscode-badge-background, #4d4d4d);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground, #ffffff);
  }

  .subtitle {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888888);
  }

  .status-card {
    margin-top: 8px;
    padding: 10px;
    border-radius: var(--radius);
    background: var(--vscode-editor-background, #252526);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-testing-iconPassed, #4ec9b0);
    box-shadow: 0 0 6px var(--vscode-testing-iconPassed, #4ec9b0);
  }
</style>
