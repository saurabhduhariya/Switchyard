import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CAPTURE_CLOSE_REQUEST_FILE, CAPTURE_MARKER_FILE } from '../constants';
import { Logger } from '../util/logger';

/**
 * Detects if the current instance is running in companion mode (capture window).
 * A companion instance is identified by having its globalStorageUri under a capture directory.
 */
export function isCompanionMode(globalStorageUri: vscode.Uri): boolean {
  const globalStoragePath = globalStorageUri.fsPath;

  // Check if the path contains 'switchyard-capture'
  if (!globalStoragePath.includes('switchyard-capture')) {
    return false;
  }

  // Verify marker file exists
  const captureDir = findCaptureDir(globalStoragePath);
  if (!captureDir) {
    return false;
  }

  const markerPath = path.join(captureDir, CAPTURE_MARKER_FILE);
  return fs.existsSync(markerPath);
}

/**
 * Finds the capture directory root from a globalStorage path.
 */
function findCaptureDir(globalStoragePath: string): string | undefined {
  let current = globalStoragePath;
  const maxDepth = 10;

  for (let i = 0; i < maxDepth; i++) {
    const markerPath = path.join(current, CAPTURE_MARKER_FILE);
    if (fs.existsSync(markerPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break; // Reached root
    }
    current = parent;
  }

  return undefined;
}

/**
 * Sets up companion mode behavior for the capture window.
 * - Shows minimal UI message
 * - Watches for close-request file and quits when detected
 */
export function setupCompanionMode(
  context: vscode.ExtensionContext,
  logger: Logger
): vscode.Disposable {
  logger.info('Running in companion mode (capture window)');

  const globalStoragePath = context.globalStorageUri.fsPath;
  const captureDir = findCaptureDir(globalStoragePath);

  if (!captureDir) {
    logger.error('Companion mode: Could not locate capture directory');
    return { dispose: () => {} };
  }

  // Show guidance message
  void vscode.window.showInformationMessage(
    'Sign in here, then return to your main window to save the account.',
    { modal: false }
  );

  // Watch for close-request file
  const closeRequestPath = path.join(captureDir, CAPTURE_CLOSE_REQUEST_FILE);
  let pollTimer: NodeJS.Timeout | undefined;
  let disposed = false;

  const checkCloseRequest = () => {
    if (disposed) {
      return;
    }

    if (fs.existsSync(closeRequestPath)) {
      logger.info('Close request detected, quitting capture window');
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      void vscode.commands.executeCommand('workbench.action.quit');
    }
  };

  // Poll every 500ms for close request
  pollTimer = setInterval(checkCloseRequest, 500);

  // Also initial check
  checkCloseRequest();

  return {
    dispose: () => {
      disposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    },
  };
}

/**
 * Returns a no-op status bar item for companion mode.
 * Prevents the regular status bar from showing.
 */
export function createCompanionStatusBar(): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.text = '$(account) Switchyard Capture';
  statusBar.tooltip = 'Sign in to add this account to your main window';
  statusBar.show();
  return statusBar;
}
