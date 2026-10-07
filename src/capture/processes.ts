import { execFile } from 'node:child_process';

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

    if (process.platform === 'win32') {
      const escaped = dir.replace(/'/g, "''");
      const script =
        // The flag is built from two pieces so this script's own command line never
        // contains the literal "--user-data-dir" and cannot match itself.
        `$flag = '--user-data' + '-dir'; ` +
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ` +
        `$_.CommandLine.Contains($flag) -and $_.CommandLine.Contains('${escaped}') -and ` +
        `-not $_.CommandLine.Contains('--type=') } | ForEach-Object { $_.ProcessId }`;
      execFile(
        'powershell',
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

/**
 * Politely asks a process to close (lets Electron flush its state to disk).
 * Windows: taskkill without /F posts WM_CLOSE. Unix: SIGTERM.
 */
export function requestGracefulClose(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid)], { windowsHide: true }, () => undefined);
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // already gone
  }
}

/** Last resort: hard-kill the process tree. */
export function forceKill(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // already gone
  }
}
