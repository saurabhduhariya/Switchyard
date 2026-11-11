import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildLaunchArgs } from './ide';
import { toWindowsPath } from './wsl';

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

export interface SpawnIsolatedWindowOptions {
  exe: string;
  userDataDir: string;
  extensionsDir?: string;
  folders?: string[];
  newWindow?: boolean;
  extraArgs?: string[];
  spawner?: ProcessSpawner;
}

/**
 * Spawns an isolated Antigravity IDE window with clean environment.
 * Shared by ProfileEngine and CaptureManager.
 *
 * @returns The spawned child process
 */
export function spawnIsolatedWindow(
  options: SpawnIsolatedWindowOptions
): ChildProcess {
  const {
    exe,
    userDataDir,
    extensionsDir,
    folders = [],
    newWindow = true,
    extraArgs = [],
    spawner = spawn,
  } = options;

  const isWinExeOnWsl = process.platform === 'linux' && exe.toLowerCase().endsWith('.exe');

  const translatedFolders = isWinExeOnWsl
    ? folders.map((f) =>
        f.startsWith('--') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(f) ? f : toWindowsPath(f)
      )
    : folders;

  // Build CLI arguments
  const args = buildLaunchArgs({
    userDataDir: isWinExeOnWsl ? toWindowsPath(userDataDir) : userDataDir,
    extensionsDir: extensionsDir && isWinExeOnWsl ? toWindowsPath(extensionsDir) : extensionsDir,
    folders: translatedFolders,
    newWindow,
    extraArgs,
  });

  // Clean environment: strip all VSCODE_*, ELECTRON_*, ANTIGRAVITY_* variables
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(cleanEnv)) {
    if (
      key.startsWith('VSCODE_') ||
      key.startsWith('ELECTRON_') ||
      key.startsWith('ANTIGRAVITY_')
    ) {
      delete cleanEnv[key];
    }
  }
  if (isWinExeOnWsl) {
    delete cleanEnv.WSL_INTEROP;
    delete cleanEnv.NODE_OPTIONS;
  }

  // Spawn detached process
  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv as NodeJS.ProcessEnv,
  };
  if (isWinExeOnWsl || process.platform === 'win32') {
    spawnOpts.windowsHide = false;
    const exeDir = path.dirname(exe);
    if (fs.existsSync(exeDir)) {
      spawnOpts.cwd = exeDir;
    }
  }

  const child = spawner(exe, args, spawnOpts);
  child.on?.('error', () => {
    // Prevent uncaught async spawn errors from crashing the extension host
  });

  child.unref();

  return child;
}
