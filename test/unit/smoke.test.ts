import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Phase 1 Scaffold Smoke Tests', () => {
  it('sql-wasm.wasm is present in dist', () => {
    const wasmPath = path.resolve(__dirname, '../../dist/sql-wasm.wasm');
    expect(fs.existsSync(wasmPath)).toBe(true);
  });

  it('webview bundle assets are present', () => {
    const jsPath = path.resolve(__dirname, '../../dist/webview/main.js');
    const cssPath = path.resolve(__dirname, '../../dist/webview/main.css');
    expect(fs.existsSync(jsPath)).toBe(true);
    expect(fs.existsSync(cssPath)).toBe(true);
  });

  it('extension bundle is present', () => {
    const extPath = path.resolve(__dirname, '../../dist/extension.js');
    const helperPath = path.resolve(__dirname, '../../dist/switch-helper.js');
    expect(fs.existsSync(extPath)).toBe(true);
    expect(fs.existsSync(helperPath)).toBe(true);
  });
});
