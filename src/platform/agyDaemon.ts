import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatPlanFromTier } from '../accounts/identity';

export interface AgyHubEndpoint {
  port: number;
  token: string;
  pid?: number;
  hubFile?: string;
}

export interface AgyLiveAuthStatus {
  authenticated: boolean;
  email?: string;
  name?: string;
  plan?: string;
  rawStatus?: Record<string, unknown>;
}

/**
 * Returns candidate daemon directories where agy --hub writes hub_<port>.json.
 */
export function getAgyDaemonDirs(): string[] {
  const home = os.homedir();
  const geminiHome = process.env.GEMINI_CLI_HOME || path.join(home, '.gemini');
  return [
    path.join(geminiHome, 'antigravity', 'daemon'),
    path.join(home, '.gemini', 'antigravity', 'daemon'),
    path.join(home, '.gemini', 'daemon'),
  ];
}

/**
 * Sends a Connect-RPC HTTP/1.1 POST to /exa.language_server_pb.LanguageServerService/<method>
 * over loopback 127.0.0.1.
 */
export function sendAgyConnectRpc<T>(
  port: number,
  token: string,
  method: string,
  bodyObj: Record<string, unknown> = {},
  timeoutMs = 2500
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const body = JSON.stringify(bodyObj);
      const headers = [
        `POST /exa.language_server_pb.LanguageServerService/${method} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Content-Type: application/json',
        'Accept: application/json',
        'Connect-Protocol-Version: 1',
      ];
      if (token) {
        headers.push(`x-codeium-csrf-token: ${token}`);
      }
      headers.push(`Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close', '', body);
      socket.write(headers.join('\r\n'));
    });

    let raw = '';
    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });

    socket.on('end', () => {
      try {
        const headerEndIdx = raw.indexOf('\r\n\r\n');
        if (headerEndIdx === -1) {
          throw new Error('Malformed HTTP response from agy daemon');
        }
        const head = raw.slice(0, headerEndIdx);
        let payload = raw.slice(headerEndIdx + 4);

        if (!head.includes('200 OK')) {
          throw new Error(`HTTP error from agy daemon: ${head.split('\r\n')[0]}`);
        }

        if (head.toLowerCase().includes('transfer-encoding: chunked')) {
          let decoded = '';
          let rem = payload;
          while (rem.length > 0) {
            const lineEnd = rem.indexOf('\r\n');
            if (lineEnd === -1) break;
            const size = parseInt(rem.slice(0, lineEnd).trim(), 16);
            if (isNaN(size) || size === 0) break;
            decoded += rem.slice(lineEnd + 2, lineEnd + 2 + size);
            rem = rem.slice(lineEnd + 2 + size + 2);
          }
          payload = decoded;
        }

        resolve(JSON.parse(payload || '{}') as T);
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', reject);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`agy daemon RPC timeout on ${method}`));
    });
  });
}

/**
 * Discovers the active agy --hub endpoint from ~/.gemini/antigravity/daemon/hub_<port>.json
 * or from the running process table.
 */
export async function discoverAgyHubEndpoint(): Promise<AgyHubEndpoint | undefined> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return undefined;
  }
  // 1. Inspect ~/.gemini/antigravity/daemon/hub_<port>.json (newest first)
  for (const dir of getAgyDaemonDirs()) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^hub_\d+\.json$/i.test(f))
        .map((f) => {
          const full = path.join(dir, f);
          const stat = fs.statSync(full);
          return { file: f, full, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of files) {
        const namePortMatch = entry.file.match(/hub_(\d+)\.json/i);
        let port = namePortMatch ? parseInt(namePortMatch[1]!, 10) : undefined;
        let token = '';
        let pid: number | undefined;

        try {
          const raw = JSON.parse(fs.readFileSync(entry.full, 'utf8')) as Record<string, unknown>;
          if (typeof raw.port === 'number') port = raw.port;
          else if (typeof raw.httpPort === 'number') port = raw.httpPort;
          else if (typeof raw.hubPort === 'number') port = raw.hubPort;

          if (typeof raw.csrfToken === 'string') token = raw.csrfToken;
          else if (typeof raw.csrf_token === 'string') token = raw.csrf_token;
          else if (typeof raw.token === 'string') token = raw.token;

          if (typeof raw.pid === 'number') pid = raw.pid;
        } catch {
          // Use port from filename
        }

        if (port && !isNaN(port)) {
          // Verify the port is alive
          try {
            await sendAgyConnectRpc(port, token, 'AuthGetStatus', {}, 1200);
            return { port, token, pid, hubFile: entry.full };
          } catch {
            try {
              await sendAgyConnectRpc(port, token, 'GetUserStatus', {}, 1200);
              return { port, token, pid, hubFile: entry.full };
            } catch {
              // Stale hub_<port>.json; try next
            }
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  // 2. Fallback: scan running processes for agy --hub or language_server
  try {
    if (process.platform !== 'win32') {
      const psOut = child_process.execSync('ps aux', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = psOut
        .split('\n')
        .filter((l) => l.includes('agy') || l.includes('language_server'));

      for (const line of lines) {
        const pidMatch = line.trim().match(/^\S+\s+(\d+)/);
        if (!pidMatch) continue;
        const pid = pidMatch[1]!;

        const tokenMatch = line.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
        const token = tokenMatch?.[1] ?? '';

        const ports: number[] = [];
        const portArgMatch = line.match(/--(?:hub-port|hub_port|extension_server_port|port)[=\s]+(\d+)/i);
        if (portArgMatch?.[1]) ports.push(parseInt(portArgMatch[1], 10));

        if (process.platform === 'linux') {
          try {
            const ssOut = child_process.execSync('ss -tlpn', {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'ignore'],
            });
            const regex = new RegExp(`(?:127\\.0\\.0\\.1|\\[::1\\]|\\*):(\\d+).*?pid=${pid}\\b`, 'g');
            for (const m of ssOut.matchAll(regex)) {
              if (m[1]) ports.push(parseInt(m[1], 10));
            }
          } catch {
            // ignore
          }
        }

        for (const port of ports) {
          try {
            await sendAgyConnectRpc(port, token, 'AuthGetStatus', {}, 1000);
            return { port, token, pid: Number(pid) };
          } catch {
            try {
              await sendAgyConnectRpc(port, token, 'GetUserStatus', {}, 1000);
              return { port, token, pid: Number(pid) };
            } catch {
              // try next port
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Queries AuthGetStatus and GetUserStatus from the running agy --hub daemon.
 */
export async function queryAgyLiveAuthStatus(): Promise<AgyLiveAuthStatus | undefined> {
  const endpoint = await discoverAgyHubEndpoint();
  if (!endpoint) return undefined;

  let email: string | undefined;
  let name: string | undefined;
  let plan: string | undefined;
  let authenticated = false;
  const combinedRaw: Record<string, unknown> = {};

  // 1. Call AuthGetStatus
  try {
    const authRes = await sendAgyConnectRpc<Record<string, any>>(
      endpoint.port,
      endpoint.token,
      'AuthGetStatus'
    );
    combinedRaw.authGetStatus = authRes;
    const statusObj = authRes?.status || authRes?.authStatus || authRes;
    if (statusObj && typeof statusObj === 'object') {
      if (typeof statusObj.email === 'string' && statusObj.email.includes('@')) {
        email = statusObj.email;
        authenticated = true;
      }
      if (typeof statusObj.userEmail === 'string' && statusObj.userEmail.includes('@')) {
        email = statusObj.userEmail;
        authenticated = true;
      }
      if (
        statusObj.authenticated === true ||
        statusObj.isLoggedIn === true ||
        statusObj.loggedIn === true ||
        statusObj.hasToken === true ||
        statusObj.state === 'AUTHENTICATED' ||
        statusObj.status === 'AUTHENTICATED'
      ) {
        authenticated = true;
      }
      if (typeof statusObj.name === 'string') {
        name = statusObj.name;
      }
    }
  } catch {
    // Fallback to GetUserStatus
  }

  // 2. Call GetUserStatus for email & plan tier
  try {
    const userRes = await sendAgyConnectRpc<Record<string, any>>(
      endpoint.port,
      endpoint.token,
      'GetUserStatus'
    );
    combinedRaw.getUserStatus = userRes;
    const us = userRes?.userStatus || userRes;
    if (us && typeof us === 'object') {
      if (!email && typeof us.email === 'string' && us.email.includes('@')) {
        email = us.email;
        authenticated = true;
      }
      if (!name && typeof us.name === 'string') {
        name = us.name;
      }
      if (us.userTier && (us.userTier.id || us.userTier.name)) {
        plan = formatPlanFromTier({ id: us.userTier.id, name: us.userTier.name });
      } else if (us.planStatus?.planInfo?.planName) {
        plan = formatPlanFromTier({ name: us.planStatus.planInfo.planName });
      }
      // Scan serialized userStatus for email if nested
      if (!email) {
        const str = JSON.stringify(us);
        const match = str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match?.[1]) {
          email = match[1];
          authenticated = true;
        }
      }
    }
  } catch {
    // ignore
  }

  return {
    authenticated,
    email,
    name,
    plan,
    rawStatus: combinedRaw,
  };
}

/**
 * Logs out the running agy --hub daemon via ConnectRPC AuthLogout.
 */
export async function logoutAgyDaemon(): Promise<boolean> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return true;
  }
  const endpoint = await discoverAgyHubEndpoint();
  if (!endpoint) return false;
  try {
    await sendAgyConnectRpc(endpoint.port, endpoint.token, 'AuthLogout', {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminates all running agy --hub daemon processes and cleans up hub_<port>.json files
 * so that Antigravity spawns a fresh agy --hub reading the new OS Keychain credentials.
 */
export function killAgyHubDaemon(): void {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return;
  }
  // 1. Delete hub_*.json files and kill their recorded PIDs
  for (const dir of getAgyDaemonDirs()) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!/^hub_\d+\.json$/i.test(file)) continue;
        const full = path.join(dir, file);
        try {
          const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as { pid?: number };
          if (typeof parsed.pid === 'number' && parsed.pid > 0) {
            try {
              process.kill(parsed.pid, 'SIGTERM');
            } catch {
              // already dead
            }
          }
        } catch {
          // ignore
        }
        try {
          fs.rmSync(full, { force: true });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Kill any lingering `agy --hub` process
  try {
    if (process.platform === 'win32') {
      child_process.execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*agy*' -and $_.CommandLine -like '*--hub*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 3000 }
      );
    } else {
      child_process.execFileSync('pkill', ['-f', 'agy.*--hub'], {
        stdio: 'ignore',
        timeout: 2000,
      });
    }
  } catch {
    // pkill exits 1 when no process matched; ignore
  }
}
