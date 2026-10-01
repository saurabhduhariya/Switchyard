/**
 * Dev-mode mock host.
 * Emulates the extension host by listening for custom events
 * from the webview and responding with postMessage-like dispatches.
 * Only loads in standalone browser dev mode (when acquireVsCodeApi is absent).
 */

import type { AccountMeta, ToWebview } from '../../../src/shared/messages';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const MOCK_ACCOUNTS: AccountMeta[] = [
  {
    id: 'acc-1',
    email: 'saurabhduhariya2007@gmail.com',
    label: 'Personal',
    plan: 'Pro',
    addedAt: NOW - 30 * DAY,
    lastUsedAt: NOW - 2 * HOUR,
  },
  {
    id: 'acc-2',
    email: 'saurabh@company.dev',
    label: 'Work',
    plan: 'Enterprise',
    addedAt: NOW - 20 * DAY,
    lastUsedAt: NOW - 1 * DAY,
  },
  {
    id: 'acc-3',
    email: 'freelance.saurabh@outlook.com',
    addedAt: NOW - 10 * DAY,
    lastUsedAt: NOW - 5 * DAY,
  },
];

function generateManyAccounts(count: number): AccountMeta[] {
  const base = [...MOCK_ACCOUNTS];
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'proton.me', 'company.io'];
  const names = ['alice', 'bob', 'charlie', 'diana', 'eve', 'frank', 'grace', 'heidi', 'ivan'];
  for (let i = base.length; i < count; i++) {
    base.push({
      id: `acc-${i + 1}`,
      email: `${names[i % names.length]}${i}@${domains[i % domains.length]}`,
      label: i % 3 === 0 ? `Project ${i}` : undefined,
      addedAt: NOW - (count - i) * DAY,
      lastUsedAt: NOW - i * HOUR,
    });
  }
  return base;
}

type ScenarioKey = '0' | '1' | '3' | '12' | 'error';

const SCENARIOS: Record<ScenarioKey, { accounts: AccountMeta[]; activeId?: string }> = {
  '0': { accounts: [], activeId: undefined },
  '1': { accounts: MOCK_ACCOUNTS.slice(0, 1), activeId: 'acc-1' },
  '3': { accounts: MOCK_ACCOUNTS, activeId: 'acc-1' },
  '12': { accounts: generateManyAccounts(12), activeId: 'acc-1' },
  error: { accounts: MOCK_ACCOUNTS, activeId: 'acc-1' },
};

function post(data: ToWebview) {
  window.postMessage(data, '*');
}

let currentScenario: ScenarioKey = '3';
let currentActiveId = SCENARIOS[currentScenario].activeId;

function sendState() {
  const s = SCENARIOS[currentScenario];
  post({ type: 'state', accounts: s.accounts, activeId: currentActiveId });
}

export function initMockHost(): void {
  // Listen for messages from the webview
  window.addEventListener('switchyard:toHost', ((e: CustomEvent) => {
    const msg = e.detail;
    switch (msg.type) {
      case 'ready':
        setTimeout(sendState, 300);
        break;

      case 'switch': {
        post({ type: 'busy', message: `Switching to ${msg.id}…` });
        setTimeout(() => {
          currentActiveId = msg.id;
          sendState();
        }, 1500);
        break;
      }

      case 'add':
        post({
          type: 'toast',
          message: 'New login detected!',
          accountId: 'acc-new',
        });
        break;

      case 'rename':
        console.log('[MockHost] Rename:', msg.id, '→', msg.label);
        sendState();
        break;

      case 'remove':
        console.log('[MockHost] Remove:', msg.id);
        sendState();
        break;

      case 'openSettings':
        console.log('[MockHost] Open Settings');
        break;

      case 'revealProfile':
        console.log('[MockHost] Reveal profile for:', msg.id);
        break;
    }
  }) as EventListener);

  // Inject scenario switcher UI
  const bar = document.createElement('div');
  bar.id = 'mock-devbar';
  bar.innerHTML = `
    <style>
      #mock-devbar {
        position: fixed; bottom: 0; left: 0; right: 0;
        padding: 6px 12px; display: flex; gap: 6px; align-items: center;
        background: #1a1a2e; border-top: 1px solid #333;
        font-size: 11px; font-family: monospace; color: #888; z-index: 9999;
      }
      #mock-devbar button {
        padding: 3px 8px; border: 1px solid #444; background: #222;
        color: #aaa; border-radius: 3px; cursor: pointer; font-size: 10px;
      }
      #mock-devbar button:hover { background: #333; color: #fff; }
      #mock-devbar button.active { border-color: #3794ff; color: #3794ff; }
      #mock-devbar .sep { color: #333; }
      #mock-devbar select {
        padding: 2px 4px; border: 1px solid #444; background: #222;
        color: #aaa; border-radius: 3px; font-size: 10px;
      }
    </style>
    <span>DEV</span>
    <span class="sep">|</span>
    <span>Accounts:</span>
    <button data-s="0">0</button>
    <button data-s="1">1</button>
    <button data-s="3" class="active">3</button>
    <button data-s="12">12</button>
    <span class="sep">|</span>
    <button data-s="error">Error</button>
    <span class="sep">|</span>
    <span>Theme:</span>
    <select id="mock-theme">
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="hc">High Contrast</option>
    </select>
  `;
  document.body.appendChild(bar);

  // Scenario buttons
  bar.querySelectorAll<HTMLButtonElement>('button[data-s]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.s as ScenarioKey;
      bar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentScenario = s;
      currentActiveId = SCENARIOS[s].activeId;

      if (s === 'error') {
        post({ type: 'error', message: 'Failed to read state.vscdb — file may be locked by another process.' });
      } else {
        sendState();
      }
    });
  });

  // Theme switcher
  const themeSelect = document.getElementById('mock-theme') as HTMLSelectElement;
  const themes: Record<string, Record<string, string>> = {
    dark: {
      '--vscode-foreground': '#cccccc',
      '--vscode-sideBar-background': '#1e1e1e',
      '--vscode-editor-background': '#252526',
      '--vscode-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--vscode-font-size': '13px',
      '--vscode-widget-border': 'rgba(255,255,255,0.08)',
      '--vscode-badge-background': '#4d4d4d',
      '--vscode-badge-foreground': '#ffffff',
      '--vscode-button-background': '#0e639c',
      '--vscode-button-foreground': '#ffffff',
      '--vscode-button-hoverBackground': '#1177bb',
      '--vscode-focusBorder': '#007fd4',
      '--vscode-descriptionForeground': '#888888',
      '--vscode-list-hoverBackground': '#2a2d2e',
      '--vscode-textLink-foreground': '#3794ff',
      '--vscode-errorForeground': '#f48771',
      '--vscode-testing-iconPassed': '#4ec9b0',
      '--vscode-menu-background': '#2d2d2d',
      '--vscode-menu-foreground': '#cccccc',
      '--vscode-menu-border': 'rgba(255,255,255,0.12)',
      '--vscode-menu-selectionBackground': '#094771',
      '--vscode-menu-selectionForeground': '#ffffff',
      '--vscode-input-background': '#3c3c3c',
      '--vscode-input-foreground': '#cccccc',
      '--vscode-inputBorder': '#3c3c3c',
      '--vscode-toolbar-hoverBackground': 'rgba(255,255,255,0.1)',
    },
    light: {
      '--vscode-foreground': '#333333',
      '--vscode-sideBar-background': '#f3f3f3',
      '--vscode-editor-background': '#ffffff',
      '--vscode-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--vscode-font-size': '13px',
      '--vscode-widget-border': 'rgba(0,0,0,0.12)',
      '--vscode-badge-background': '#c4c4c4',
      '--vscode-badge-foreground': '#333333',
      '--vscode-button-background': '#007acc',
      '--vscode-button-foreground': '#ffffff',
      '--vscode-button-hoverBackground': '#0062a3',
      '--vscode-focusBorder': '#0090f1',
      '--vscode-descriptionForeground': '#717171',
      '--vscode-list-hoverBackground': '#e8e8e8',
      '--vscode-textLink-foreground': '#006ab1',
      '--vscode-errorForeground': '#e51400',
      '--vscode-testing-iconPassed': '#388a34',
      '--vscode-menu-background': '#ffffff',
      '--vscode-menu-foreground': '#333333',
      '--vscode-menu-border': 'rgba(0,0,0,0.12)',
      '--vscode-menu-selectionBackground': '#0060c0',
      '--vscode-menu-selectionForeground': '#ffffff',
      '--vscode-input-background': '#ffffff',
      '--vscode-input-foreground': '#333333',
      '--vscode-inputBorder': '#cecece',
      '--vscode-toolbar-hoverBackground': 'rgba(0,0,0,0.06)',
    },
    hc: {
      '--vscode-foreground': '#ffffff',
      '--vscode-sideBar-background': '#000000',
      '--vscode-editor-background': '#000000',
      '--vscode-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--vscode-font-size': '13px',
      '--vscode-widget-border': '#6fc3df',
      '--vscode-badge-background': '#000000',
      '--vscode-badge-foreground': '#ffffff',
      '--vscode-button-background': '#ffffff',
      '--vscode-button-foreground': '#000000',
      '--vscode-button-hoverBackground': '#ffffff',
      '--vscode-focusBorder': '#f38518',
      '--vscode-descriptionForeground': '#ffffff',
      '--vscode-list-hoverBackground': '#0a0d13',
      '--vscode-textLink-foreground': '#3794ff',
      '--vscode-errorForeground': '#f48771',
      '--vscode-testing-iconPassed': '#4ec9b0',
      '--vscode-menu-background': '#000000',
      '--vscode-menu-foreground': '#ffffff',
      '--vscode-menu-border': '#6fc3df',
      '--vscode-menu-selectionBackground': '#ffffff',
      '--vscode-menu-selectionForeground': '#000000',
      '--vscode-input-background': '#000000',
      '--vscode-input-foreground': '#ffffff',
      '--vscode-inputBorder': '#6fc3df',
      '--vscode-toolbar-hoverBackground': 'rgba(255,255,255,0.15)',
    },
  };

  themeSelect.addEventListener('change', () => {
    const vars = themes[themeSelect.value];
    const root = document.documentElement;
    for (const [key, val] of Object.entries(vars)) {
      root.style.setProperty(key, val);
    }
  });
}
