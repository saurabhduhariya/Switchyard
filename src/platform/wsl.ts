import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedIsWsl: boolean | undefined;
let cachedWslHomes: string[] | undefined;

export interface WslLinuxUserHome {
  distro: string;
  linuxHome: string;
  uncHome: string;
}

const cachedWslDistroHomes = new Map<string, WslLinuxUserHome | null>();

/**
 * Reset cached WSL state for testing purposes.
 */
export function __resetWslCacheForTest(): void {
  cachedIsWsl = undefined;
  cachedWslHomes = undefined;
  cachedWslDistroHomes.clear();
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

function decodeWslCliOutput(raw: Buffer | string): string {
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else {
    const hasBom = raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe;
    const hasNul = raw.includes(0);
    text = raw.toString(hasBom || hasNul ? 'utf16le' : 'utf8');
  }
  return text.replace(/^\uFEFF/, '').replace(/\0/g, '');
}

/**
 * Extracts a WSL distro name from a VS Code remote authority such as `wsl+Ubuntu-24.04` or `wsl%2BUbuntu-24.04`.
 */
export function extractWslDistroFromRemoteAuthority(authority?: string): string | undefined {
  if (!authority) return undefined;
  let decoded = authority;
  try {
    decoded = decodeURIComponent(authority);
  } catch {
    // keep raw authority if malformed percent encoding
  }
  const match = decoded.match(/^wsl\+(.+)$/i);
  const distro = match?.[1]?.trim();
  return distro || undefined;
}

/**
 * Lists WSL distributions visible from Windows via `wsl.exe -l -q`.
 */
export function getWslDistrosOnWindows(options?: {
  runningOnly?: boolean;
  targetDistro?: string;
}): string[] {
  if (process.env.VITEST && !process.env.SWITCHYARD_TEST_WSL) {
    return [];
  }
  if (process.platform !== 'win32') {
    return [];
  }

  const distros: string[] = [];
  const addDistro = (name?: string): void => {
    const trimmed = name?.trim();
    if (!trimmed || /^docker-desktop(-data)?$/i.test(trimmed) || trimmed.includes('\0')) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (!distros.some((d) => d.toLowerCase() === lower)) {
      distros.push(trimmed);
    }
  };

  addDistro(options?.targetDistro || process.env.SWITCHYARD_WSL_DISTRO);

  try {
    const args = options?.runningOnly ? ['-l', '--running', '-q'] : ['-l', '-q'];
    const raw = child_process.execFileSync('wsl.exe', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 2500,
    });
    for (const line of decodeWslCliOutput(raw).split(/\r?\n/)) {
      addDistro(line);
    }
  } catch {
    // ignore wsl.exe enumeration errors
  }

  return distros;
}

function buildWslUncPath(distro: string, linuxPath: string): string {
  const rel = linuxPath.replace(/^\/+/, '').replace(/\//g, '\\');
  return rel ? `\\\\wsl.localhost\\${distro}\\${rel}` : `\\\\wsl.localhost\\${distro}`;
}

/**
 * Resolves the Linux home directory and its `\\wsl.localhost\...` UNC equivalent for a WSL distro on Windows.
 */
export function resolveWslDistroLinuxHome(distro: string): WslLinuxUserHome | undefined {
  if (process.env.VITEST && !process.env.SWITCHYARD_TEST_WSL) {
    return undefined;
  }
  if (process.platform !== 'win32' || !distro) {
    return undefined;
  }

  const cached = cachedWslDistroHomes.get(distro);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  try {
    const raw = child_process.execFileSync(
      'wsl.exe',
      ['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 2500,
      }
    );
    const linuxHome = decodeWslCliOutput(raw).split(/\r?\n/)[0]?.trim();
    if (linuxHome && linuxHome.startsWith('/')) {
      const resolved: WslLinuxUserHome = {
        distro,
        linuxHome,
        uncHome: buildWslUncPath(distro, linuxHome),
      };
      cachedWslDistroHomes.set(distro, resolved);
      return resolved;
    }
  } catch {
    // fall back to scanning \\wsl.localhost\<distro>\home
  }

  try {
    const uncHomeRoot = buildWslUncPath(distro, '/home');
    if (fs.existsSync(uncHomeRoot)) {
      const entries = fs.readdirSync(uncHomeRoot, { withFileTypes: true });
      const userDirs = entries
        .filter((e) => e.isDirectory() && e.name !== 'lost+found')
        .map((e) => e.name);
      const preferred =
        userDirs.find((name) => fs.existsSync(`${uncHomeRoot}\\${name}\\.gemini`)) ??
        (userDirs.length === 1 ? userDirs[0] : undefined);
      if (preferred) {
        const resolved: WslLinuxUserHome = {
          distro,
          linuxHome: `/home/${preferred}`,
          uncHome: `${uncHomeRoot}\\${preferred}`,
        };
        cachedWslDistroHomes.set(distro, resolved);
        return resolved;
      }
    }
  } catch {
    // ignore UNC enumeration errors
  }

  cachedWslDistroHomes.set(distro, null);
  return undefined;
}

/**
 * Returns WSL Linux user home descriptors (`{ distro, linuxHome, uncHome }`) reachable from Windows.
 */
export function getWslLinuxUserHomesOnWindows(options?: {
  runningOnly?: boolean;
  targetDistro?: string;
}): WslLinuxUserHome[] {
  const homes: WslLinuxUserHome[] = [];
  const seenUnc = new Set<string>();
  for (const distro of getWslDistrosOnWindows(options)) {
    const home = resolveWslDistroLinuxHome(distro);
    const uncKey = home?.uncHome.toLowerCase();
    if (home && uncKey && !seenUnc.has(uncKey)) {
      seenUnc.add(uncKey);
      homes.push(home);
    }
  }
  return homes;
}

export interface WorkspaceRemoteLike {
  remoteName?: string;
  workspaceFile?: { authority?: string };
  workspaceFolders?: ReadonlyArray<{ uri: { authority?: string } }>;
}

/**
 * Resolves whether the current VS Code window targets a WSL remote and extracts the distro name if present.
 */
export function resolveWslContextFromWorkspace(input: WorkspaceRemoteLike): {
  isWslRemote: boolean;
  wslDistro?: string;
} {
  let wslDistro = extractWslDistroFromRemoteAuthority(input.workspaceFile?.authority);
  if (!wslDistro && input.workspaceFolders) {
    for (const folder of input.workspaceFolders) {
      wslDistro = extractWslDistroFromRemoteAuthority(folder.uri?.authority);
      if (wslDistro) break;
    }
  }
  const isWslRemote = input.remoteName === 'wsl' || Boolean(wslDistro) || isWsl();
  if (isWslRemote && !wslDistro) {
    wslDistro = resolveActiveWslDistro();
  }
  return { isWslRemote, wslDistro };
}

/**
 * Safely extracts WSL remote context from a VS Code API namespace object
 * without hard-failing if a test mock omits `env` or `workspace`.
 */
export function resolveWslContextFromVscode(vscodeApi: {
  env?: { remoteName?: string };
  workspace?: {
    workspaceFile?: { authority?: string };
    workspaceFolders?: ReadonlyArray<{ uri: { authority?: string } }>;
  };
}): { isWslRemote: boolean; wslDistro?: string } {
  let remoteName: string | undefined;
  let workspaceFile: { authority?: string } | undefined;
  let workspaceFolders: ReadonlyArray<{ uri: { authority?: string } }> | undefined;
  try {
    remoteName = vscodeApi.env?.remoteName;
  } catch {
    // Partial vscode test mocks may omit env
  }
  try {
    workspaceFile = vscodeApi.workspace?.workspaceFile;
    workspaceFolders = vscodeApi.workspace?.workspaceFolders;
  } catch {
    // Partial vscode test mocks may omit workspace
  }
  return resolveWslContextFromWorkspace({ remoteName, workspaceFile, workspaceFolders });
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
  if (process.env.SWITCHYARD_WSL_DISTRO) {
    return process.env.SWITCHYARD_WSL_DISTRO;
  }
  if (process.platform === 'win32') {
    const running = getWslDistrosOnWindows({ runningOnly: true });
    if (running[0]) {
      return running[0];
    }
    try {
      const raw = child_process
        .execFileSync('wsl.exe', ['-e', 'sh', '-c', 'echo "$WSL_DISTRO_NAME"'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 2500,
        });
      const out = decodeWslCliOutput(raw).trim();
      if (out && !out.includes('$WSL_DISTRO_NAME')) {
        return out.split(/\r?\n/)[0]?.trim() || undefined;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}
