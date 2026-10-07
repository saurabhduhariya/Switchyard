import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import { buildLaunchArgs } from './ide';

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
    spawner = spawn,
  } = options;

  // Build CLI arguments
  const args = buildLaunchArgs({
    userDataDir,
    extensionsDir,
    folders,
    newWindow,
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

  // Spawn detached process
  const child = spawner(exe, args, {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv as NodeJS.ProcessEnv,
  });

  child.unref();

  return child;
}
