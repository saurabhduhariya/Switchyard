import { mount } from 'svelte';
import App from './App.svelte';

// In standalone dev mode, load the mock host
async function init() {
  try {
    acquireVsCodeApi();
  } catch {
    // Not in VS Code — load mock host
    const { initMockHost } = await import('./lib/mockHost');
    initMockHost();
  }

  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Root #app container not found');
  }

  mount(App, { target });
}

init();
