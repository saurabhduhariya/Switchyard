import { mount } from 'svelte';
import App from './App.svelte';
import { getVsCodeApi } from './lib/vscode';

async function init() {
  const vscode = getVsCodeApi();
  if (!vscode) {
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
