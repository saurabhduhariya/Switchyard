/**
 * VS Code webview API bridge.
 * In the real webview, acquireVsCodeApi() is available.
 * In standalone dev mode, we fall back to the mock host.
 */

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
  if (api) return api;
  try {
    if (typeof acquireVsCodeApi === 'function') {
      api = acquireVsCodeApi();
    }
  } catch {
    // Already acquired or in standalone dev mode
  }
  return api;
}

export function postToHost(msg: unknown): void {
  const vscode = getVsCodeApi();
  if (vscode) {
    vscode.postMessage(msg);
  } else {
    // In dev mode, dispatch a custom event so mockHost can pick it up
    window.dispatchEvent(new CustomEvent('switchyard:toHost', { detail: msg }));
  }
}
