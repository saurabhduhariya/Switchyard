import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    window: {
      showInformationMessage: vi.fn(),
      createStatusBarItem: vi.fn(() => ({
        show: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    commands: {
      executeCommand: vi.fn(),
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
  };
});

import * as vscode from 'vscode';
import { isCompanionMode, setupCompanionMode, createCompanionStatusBar } from '../../src/capture/companion';
import { CAPTURE_CLOSE_REQUEST_FILE, CAPTURE_MARKER_FILE } from '../../src/constants';
import { Logger } from '../../src/util/logger';

describe('capture/companion', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-companion-test-'));
    logger = new Logger({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as any);
    vi.clearAllMocks();
  });

  it('detects companion mode when globalStorageUri is in switchyard-capture and marker exists', () => {
    const captureDir = path.join(tmpDir, 'switchyard-capture', 'session-1');
    const storageDir = path.join(captureDir, 'User', 'globalStorage', 'saurabhduhariya.ag-switchyard');
    fs.mkdirSync(storageDir, { recursive: true });

    // Marker file not present yet
    expect(isCompanionMode({ fsPath: storageDir } as any)).toBe(false);

    // Write marker file
    fs.writeFileSync(path.join(captureDir, CAPTURE_MARKER_FILE), JSON.stringify({ sessionId: 'session-1' }));
    expect(isCompanionMode({ fsPath: storageDir } as any)).toBe(true);
  });

  it('returns false for regular paths not containing switchyard-capture', () => {
    const regularStorage = path.join(tmpDir, 'regular', 'globalStorage');
    fs.mkdirSync(regularStorage, { recursive: true });
    expect(isCompanionMode({ fsPath: regularStorage } as any)).toBe(false);
  });

  it('setupCompanionMode shows info message and watches for close-request', async () => {
    const captureDir = path.join(tmpDir, 'switchyard-capture', 'session-2');
    const storageDir = path.join(captureDir, 'User', 'globalStorage', 'saurabhduhariya.ag-switchyard');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(path.join(captureDir, CAPTURE_MARKER_FILE), JSON.stringify({ sessionId: 'session-2' }));

    const mockContext = {
      globalStorageUri: { fsPath: storageDir },
      subscriptions: [],
    } as any;

    const disposable = setupCompanionMode(mockContext, logger);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Sign in here'),
      expect.any(Object)
    );

    // Create close-request file
    const closeFile = path.join(captureDir, CAPTURE_CLOSE_REQUEST_FILE);
    fs.writeFileSync(closeFile, '');

    // Wait a brief tick for the interval check
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.quit');
    disposable.dispose();
  });

  it('createCompanionStatusBar returns a status bar item', () => {
    const item = createCompanionStatusBar();
    expect(item).toBeDefined();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
  });
});
