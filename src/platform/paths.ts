import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Returns candidate user data directories for Antigravity IDE across platforms.
 * Checks both "Antigravity IDE" and "Antigravity" naming variations.
 */
export function getUserDataDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir()
): string[] {
  const dirs: string[] = [];

  switch (platform) {
    case 'darwin': {
      const appSupport = path.join(homeDir, 'Library', 'Application Support');
      dirs.push(path.join(appSupport, 'Antigravity IDE'));
      dirs.push(path.join(appSupport, 'Antigravity'));
      break;
    }
    case 'win32': {
      const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      dirs.push(path.join(appData, 'Antigravity IDE'));
      dirs.push(path.join(appData, 'Antigravity'));
      break;
    }
    case 'linux':
    default: {
      const configHome = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
      dirs.push(path.join(configHome, 'Antigravity IDE'));
      dirs.push(path.join(configHome, 'Antigravity'));
      break;
    }
  }

  return dirs;
}

export interface FindStateDbOptions {
  globalStorageUriPath?: string;
  candidateDirs?: string[];
  fsModule?: Pick<typeof fs, 'existsSync'>;
}

/**
 * Finds the state.vscdb database path.
 * Prefers deriving from the extension's own globalStorage directory (which sits next to state.vscdb),
 * with fallback to candidate OS user data directories.
 */
export function findStateDb(options: FindStateDbOptions = {}): string | undefined {
  const fsImpl = options.fsModule || fs;

  // 1. Try deriving from extension's globalStorageUri path
  if (options.globalStorageUriPath) {
    const parentDir = path.dirname(options.globalStorageUriPath);
    const candidatePath = path.join(parentDir, 'state.vscdb');
    if (fsImpl.existsSync(candidatePath)) {
      return path.resolve(candidatePath);
    }

    const directSibling = path.join(options.globalStorageUriPath, '..', 'state.vscdb');
    if (fsImpl.existsSync(directSibling)) {
      return path.resolve(directSibling);
    }
  }

  // 2. Try candidate user data dirs
  const candidateDirs = options.candidateDirs || getUserDataDirs();
  for (const dir of candidateDirs) {
    const candidatePath = path.join(dir, 'User', 'globalStorage', 'state.vscdb');
    if (fsImpl.existsSync(candidatePath)) {
      return path.resolve(candidatePath);
    }
  }

  return undefined;
}

export function getStateDbBackupPath(stateDbPath: string): string {
  return `${stateDbPath}.backup`;
}

export function getGlobalStorageDir(stateDbPath: string): string {
  return path.dirname(stateDbPath);
}

export function getProfilesDir(globalStorageDir: string): string {
  return path.join(globalStorageDir, 'profiles');
}

export function getBackupsDir(globalStorageDir: string): string {
  return path.join(globalStorageDir, 'backups');
}

export function getCaptureRoot(globalStorageDir: string): string {
  return path.join(path.dirname(globalStorageDir), 'switchyard-capture');
}

export function getCaptureDir(globalStorageDir: string, sessionId: string): string {
  return path.join(getCaptureRoot(globalStorageDir), sessionId);
}
