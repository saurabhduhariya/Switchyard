import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedIsWsl: boolean | undefined;
let cachedWslHomes: string[] | undefined;

/**
 * Reset cached WSL state for testing purposes.
 */
export function __resetWslCacheForTest(): void {
  cachedIsWsl = undefined;
  cachedWslHomes = undefined;
}

/**
 * Returns true when running inside a Linux WSL1/WSL2 environment on Windows.
 */
export function isWsl(): boolean {
  if (process.env.VITEST && !process.env.SWITCHYARD_TEST_WSL) {
    return false;
  }
  if (cachedIsWsl !== undefined) {
    return cachedIsWsl;
  }
  if (process.platform !== 'linux') {
    cachedIsWsl = false;
    return false;
  }
  try {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      cachedIsWsl = true;
      return true;
    }
    if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
      cachedIsWsl = true;
      return true;
    }
    if (fs.existsSync('/proc/version')) {
      const ver = fs.readFileSync('/proc/version', 'utf8');
      cachedIsWsl = /microsoft|wsl/i.test(ver);
      return cachedIsWsl;
    }
  } catch {
    // ignore
  }

  cachedIsWsl = false;
  return false;
}

/**
 * Converts a WSL POSIX path (/home/... or /mnt/c/...) to a Windows path (\\wsl.localhost\... or C:\...)
 * so Windows binaries like Antigravity.exe can open it.
 */
export function toWindowsPath(linuxPath: string): string {
  if (!linuxPath || !isWsl()) return linuxPath;
  try {
    const out = child_process
      .execFileSync('wslpath', ['-w', linuxPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      })
      .trim();
    if (out) return out;
  } catch {
    // fallback if path is /mnt/<drive>/...
    const m = linuxPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (m?.[1] && m[2] !== undefined) {
      return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
    }
  }
  return linuxPath;
}

/**
 * Returns candidate Windows user home directories mounted at /mnt/c/Users/<User> when running in WSL.
 */
export function getWslWindowsUserHomes(): string[] {
  if (!isWsl()) return [];
  if (cachedWslHomes !== undefined) {
    return cachedWslHomes;
  }

  const homes: string[] = [];

  // 1. Try querying Windows USERPROFILE via cmd.exe + wslpath -u
  try {
    const rawWinProfile = child_process
      .execFileSync('cmd.exe', ['/d', '/s', '/c', 'echo %USERPROFILE%'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 2500,
      })
      .trim();
    if (rawWinProfile && !rawWinProfile.includes('%USERPROFILE%')) {
      const posixPath = child_process
        .execFileSync('wslpath', ['-u', rawWinProfile], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000,
        })
        .trim();
      if (posixPath && fs.existsSync(posixPath)) {
        homes.push(posixPath);
      }
    }
  } catch {
    // ignore
  }

  // 2. Scan /mnt/c/Users/* as fallback
  const usersRoot = '/mnt/c/Users';
  if (fs.existsSync(usersRoot)) {
    try {
      for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)) continue;
        const full = path.posix ? path.posix.join(usersRoot, entry.name) : `${usersRoot}/${entry.name}`;
        if (!homes.includes(full)) {
          homes.push(full);
        }
      }
    } catch {
      // ignore
    }
  }

  cachedWslHomes = homes;
  return homes;
}

/**
 * Resolves the active WSL distribution name (e.g. "Ubuntu-24.04") when connected to a WSL remote window.
 */
export function resolveActiveWslDistro(): string | undefined {
  if (process.env.VITEST && !process.env.SWITCHYARD_TEST_WSL) {
    return undefined;
  }
  if (process.env.WSL_DISTRO_NAME) {
    return process.env.WSL_DISTRO_NAME;
  }
  if (process.platform === 'win32') {
    try {
      const out = child_process
        .execFileSync('wsl.exe', ['-e', 'sh', '-c', 'echo "$WSL_DISTRO_NAME"'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 2500,
        })
        .trim();
      if (out && !out.includes('$WSL_DISTRO_NAME')) {
        return out.split(/\r?\n/)[0]?.trim() || undefined;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}
