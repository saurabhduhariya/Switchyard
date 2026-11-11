import { execFile } from 'node:child_process';
import { isWsl, toWindowsPath } from '../platform/wsl';

/**
 * Finds the main Electron process(es) of a capture window by its --user-data-dir.
 * The PID returned by spawn() is often a short-lived launcher wrapper, so it cannot be
 * trusted to tell whether the real window is still open.
 */
export function findCaptureMainPids(dir: string): Promise<number[]> {
  return new Promise((resolve) => {
    const done = (out: string) => {
      const pids = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => Number(l.split(/\s+/)[0]))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
      resolve(pids);
    };

    const runningOnWsl = isWsl();
    if (process.platform === 'win32' || runningOnWsl) {
      const targetDir = runningOnWsl ? toWindowsPath(dir) : dir;
      const escaped = targetDir.replace(/\\/g, '/').replace(/'/g, "''").toLowerCase();
      const script =
        // The flag is built from two pieces so this script's own command line never
        // contains the literal "--user-data-dir" and cannot match itself.
        `$flag = '--user-data' + '-dir'; ` +
        `$target = '${escaped}'; ` +
        `Get-CimInstance Win32_Process | Where-Object { ` +
        `  if (-not $_.CommandLine) { return $false } ` +
        `  $cmd = $_.CommandLine.Replace('\\', '/').ToLower(); ` +
        `  $cmd.Contains($flag) -and $cmd.Contains($target) -and -not $cmd.Contains('--type=') ` +
        `} | ForEach-Object { $_.ProcessId }`;
      const psBin = process.platform === 'win32' ? 'powershell' : 'powershell.exe';
      execFile(
        psBin,
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => (err ? resolve([]) : done(String(stdout)))
      );
      return;
    }

    execFile('ps', ['-eo', 'pid=,args='], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const lines = String(stdout)
        .split('\n')
        .filter(
          (l) => l.includes('--user-data-dir') && l.includes(dir) && !l.includes('--type=')
        );
      done(lines.join('\n'));
    });
  });
}

function terminateProcess(pid: number, force: boolean): void {
  try {
    if (process.platform === 'win32' || isWsl()) {
      const taskkillBin = process.platform === 'win32' ? 'taskkill' : 'taskkill.exe';
      const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
      execFile(taskkillBin, args, { windowsHide: true }, () => undefined);
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch {
    // already gone
  }
}

/**
 * Politely asks a process to close (lets Electron flush its state to disk).
 * Windows / WSL: taskkill without /F posts WM_CLOSE. Unix: SIGTERM.
 */
export function requestGracefulClose(pid: number): void {
  terminateProcess(pid, false);
}

/** Last resort: hard-kill the process tree. */
export function forceKill(pid: number): void {
  terminateProcess(pid, true);
}
