import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getWslWindowsUserHomes, isWsl, resolveActiveWslDistro } from './wsl';

export interface LaunchArgsOptions {
  userDataDir: string;
  extensionsDir?: string;
  folders?: string[];
  newWindow?: boolean;
  /** Extra, already-validated CLI flags (e.g. from the capture window settings). */
  extraArgs?: string[];
}

/**
 * Builds CLI argument list for launching an isolated Antigravity IDE instance.
 * Always returns an array to prevent shell escaping and space issues across platforms.
 */
export function buildLaunchArgs(options: LaunchArgsOptions): string[] {
  const args: string[] = ['--user-data-dir', options.userDataDir];

  if (options.extensionsDir) {
    args.push('--extensions-dir', options.extensionsDir);
  }

  if (options.newWindow !== false) {
    args.push('--new-window');
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }

  if (options.folders && options.folders.length > 0) {
    for (let i = 0; i < options.folders.length; i++) {
      const item = options.folders[i];
      if (!item) continue;
      if (item === '--folder-uri' || item === '--file-uri' || item === '--remote') {
        const next = options.folders[i + 1];
        if (next) {
          args.push(item, next);
          i++;
        }
      } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(item)) {
        args.push('--folder-uri', item);
      } else {
        args.push(item);
      }
    }
  }

  return args;
}

/**
 * Resolves the executable path of Antigravity IDE across platforms.
 * Respects user overrides, AppImage environments, process exec path, and standard install paths.
 */
export function findExecutable(customPath?: string): string {
  // 1. User-configured custom path
  if (customPath && customPath.trim().length > 0) {
    const trimmed = customPath.trim();
    if (fs.existsSync(trimmed)) {
      return trimmed;
    }
    throw new Error(`Configured executable path does not exist: ${trimmed}`);
  }

  // 2. Linux AppImage environment
  if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) {
    return process.env.APPIMAGE;
  }

  // 3. Platform-specific known installation candidates (prefer launcher scripts)
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'linux') {
    candidates.push(
      '/opt/antigravity-ide/antigravity-ide',
      '/opt/antigravity/antigravity',
      '/usr/bin/antigravity-ide',
      '/usr/local/bin/antigravity-ide',
      '/opt/antigravity-ide/bin/antigravity-ide',
      path.join(os.homedir(), '.local/bin/antigravity-ide')
    );
    if (isWsl()) {
      for (const winHome of getWslWindowsUserHomes()) {
        candidates.push(
          path.join(winHome, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
          path.join(winHome, 'AppData', 'Local', 'Programs', 'Antigravity', 'Antigravity.exe')
        );
      }
      candidates.push(
        '/mnt/c/Program Files/Antigravity IDE/Antigravity IDE.exe',
        '/mnt/c/Program Files/Antigravity/Antigravity.exe'
      );
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/MacOS/Electron',
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
      '/Applications/Antigravity IDE.app/Contents/MacOS/Electron',
      '/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE',
      path.join(os.homedir(), 'Applications/Antigravity.app/Contents/MacOS/Electron'),
      path.join(os.homedir(), 'Applications/Antigravity IDE.app/Contents/MacOS/Electron')
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';

    candidates.push(
      path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(programFiles, 'Antigravity', 'Antigravity.exe'),
      path.join(programFiles, 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(programFilesX86, 'Antigravity', 'Antigravity.exe')
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 4. Current process executable if running inside Antigravity/Electron
  const execPath = process.execPath;
  const isNodeBinary = path.basename(execPath).toLowerCase().startsWith('node');
  if (!isNodeBinary && fs.existsSync(execPath)) {
    const lower = execPath.toLowerCase();
    if (lower.includes('antigravity') || lower.includes('code') || lower.includes('electron')) {
      return execPath;
    }
  }

  // 5. Fallback binary name in PATH for Unix
  if (platform === 'linux') {
    return 'antigravity-ide';
  }

  throw new Error(
    'Could not locate Antigravity IDE executable. Please set "switchyard.executablePath" in settings.'
  );
}

/**
 * Discovers the shared extensions directory from the running extension's location or standard defaults.
 */
export function getSharedExtensionsDir(extensionUri?: { fsPath: string }): string | undefined {
  if (extensionUri?.fsPath) {
    const parentDir = path.dirname(extensionUri.fsPath);
    if (fs.existsSync(parentDir) && path.basename(parentDir) === 'extensions') {
      return parentDir;
    }
  }

  const home = os.homedir();
  const defaults = [
    path.join(home, '.antigravity-ide', 'extensions'),
    path.join(home, '.antigravity', 'extensions'),
    path.join(home, '.vscode', 'extensions'),
  ];

  for (const dir of defaults) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  return undefined;
}

/**
 * Checks whether a process PID is currently alive on the system.
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    return error.code === 'EPERM';
  }
}

/**
 * Finds the Electron Main Process PID.
 * The extension runs in the Extension Host (Node.js subprocess), but the real
 * Electron Main Process holds state.vscdb in memory. We need to wait for that
 * process to exit before modifying the database.
 * 
 * Strategy:
 * 1. process.ppid is the parent of the Extension Host (usually the Main Process)
 * 2. Fallback to process.pid if ppid is unavailable (shouldn't happen in Electron)
 */
export function getMainProcessPid(): number {
  const startPid = process.ppid || process.pid;
  try {
    if (process.platform === 'linux' || process.platform === 'darwin') {
      let current = startPid;
      for (let depth = 0; depth < 5; depth++) {
        const out = child_process.execFileSync('ps', ['-o', 'ppid=,args=', '-p', String(current)], {
          encoding: 'utf8',
          timeout: 1500,
        }).trim();
        if (!out) break;
        const match = out.match(/^(\d+)\s+(.*)$/);
        if (!match) break;
        const parentPid = Number(match[1]);
        const args = match[2] || '';
        if (!args.includes('--type=') && (args.includes('antigravity') || args.includes('electron'))) {
          return current;
        }
        if (!parentPid || parentPid <= 1 || parentPid === current) break;
        current = parentPid;
      }
      return current;
    }

    if (process.platform === 'win32') {
      const psScript = `
        $curr = ${startPid}
        for ($i = 0; $i -lt 5; $i++) {
          $p = Get-CimInstance Win32_Process -Filter "ProcessId = $curr" -ErrorAction SilentlyContinue
          if (-not $p) { break }
          $cmd = [string]$p.CommandLine
          if (-not $cmd.Contains('--type=') -and ($cmd -match 'antigravity|electron')) {
            Write-Output $curr
            exit 0
          }
          if (-not $p.ParentProcessId -or $p.ParentProcessId -le 4 -or $p.ParentProcessId -eq $curr) { break }
          $curr = $p.ParentProcessId
        }
        Write-Output $curr
      `;

      const out = child_process
        .execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 3000,
        })
        .trim();
      const parsed = Number(out);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch {
    // Fall back to the starting PID.
  }
  return startPid;
}

export interface WorkspaceUriLike {
  scheme?: string;
  authority?: string;
  path?: string;
  fsPath: string;
  toString?: (skipEncoding?: boolean) => string;
}

export interface WorkspaceRelaunchInput {
  overrideFolders?: string[];
  workspaceFolders?: ReadonlyArray<{ uri: WorkspaceUriLike }>;
  workspaceFile?: WorkspaceUriLike;
  remoteName?: string;
}

function formatRemoteUri(uri: WorkspaceUriLike): string {
  if (uri.scheme && uri.authority && uri.path) {
    const auth = decodeURIComponent(uri.authority);
    return `${uri.scheme}://${auth}${uri.path}`;
  }
  if (typeof uri.toString === 'function') {
    return uri.toString(true);
  }
  return uri.fsPath;
}

/**
 * Builds CLI arguments to reopen the current workspace (preserving WSL / SSH / DevContainer remote context).
 */
export function getWorkspaceRelaunchArgs(input: WorkspaceRelaunchInput): string[] {
  // 1. Explicit folder override (e.g. passed via options.folders)
  if (input.overrideFolders !== undefined) {
    const out: string[] = [];
    for (const folder of input.overrideFolders) {
      if (!folder) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(folder)) {
        out.push('--folder-uri', folder);
      } else if (
        isWsl() &&
        process.env.WSL_DISTRO_NAME &&
        folder.startsWith('/') &&
        !folder.startsWith('/mnt/')
      ) {
        out.push('--folder-uri', `vscode-remote://wsl+${process.env.WSL_DISTRO_NAME}${folder}`);
      } else {
        out.push(folder);
      }
    }
    return out;
  }

  const args: string[] = [];
  let detectedRemoteAuthority: string | undefined;

  // 2. Multi-root .code-workspace file if open
  if (
    input.workspaceFile &&
    input.workspaceFile.scheme &&
    input.workspaceFile.scheme !== 'untitled'
  ) {
    if (input.workspaceFile.scheme !== 'file') {
      if (input.workspaceFile.authority) {
        detectedRemoteAuthority = decodeURIComponent(input.workspaceFile.authority);
      }
      if (detectedRemoteAuthority) {
        args.push('--remote', detectedRemoteAuthority);
      }
      args.push('--file-uri', formatRemoteUri(input.workspaceFile));
      return args;
    }
  }

  // 3. Open workspace folders (local or vscode-remote://wsl+<distro>/...)
  if (input.workspaceFolders && input.workspaceFolders.length > 0) {
    for (const folder of input.workspaceFolders) {
      const uri = folder.uri;
      if (!uri) continue;

      if (uri.scheme && uri.scheme !== 'file') {
        if (uri.authority && !detectedRemoteAuthority) {
          detectedRemoteAuthority = decodeURIComponent(uri.authority);
          args.push('--remote', detectedRemoteAuthority);
        }
        args.push('--folder-uri', formatRemoteUri(uri));
      } else if (
        isWsl() &&
        process.env.WSL_DISTRO_NAME &&
        uri.fsPath.startsWith('/') &&
        !uri.fsPath.startsWith('/mnt/')
      ) {
        const wslAuth = `wsl+${process.env.WSL_DISTRO_NAME}`;
        if (!detectedRemoteAuthority) {
          detectedRemoteAuthority = wslAuth;
          args.push('--remote', wslAuth);
        }
        args.push('--folder-uri', `vscode-remote://${wslAuth}${uri.fsPath}`);
      } else if (uri.fsPath) {
        args.push(uri.fsPath);
      }
    }
    return args;
  }

  // 4. Empty WSL window (no folder open yet, e.g. ">< WSL: Ubuntu-24.04")
  if (input.remoteName === 'wsl' || isWsl()) {
    const distro = resolveActiveWslDistro();
    if (distro) {
      args.push('--remote', `wsl+${distro}`);
    }
  }

  return args;
}
