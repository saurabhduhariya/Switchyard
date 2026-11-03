import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractEmailFromBuffer, extractPlanFromBuffer, formatPlanFromTier } from '../accounts/identity';

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
  rawStatus: Record<string, unknown>;
}

/**
 * Returns candidate daemon directories where agy hub writes hub_<port>.json.
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
  timeoutMs = 2000
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
            if (isNaN(size) || size <= 0) break;
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

export async function probeQuotaEndpoint(port: number, token: string): Promise<boolean> {
  try {
    const qRes = await sendAgyConnectRpc<Record<string, any>>(
      port,
      token,
      'RetrieveUserQuotaSummary',
      {},
      1000
    );
    if (qRes.response?.groups && Array.isArray(qRes.response.groups) && qRes.response.groups.length > 0) {
      return true;
    }
  } catch {
    // try GetUserStatus next
  }

  try {
    const uRes = await sendAgyConnectRpc<Record<string, any>>(port, token, 'GetUserStatus', {}, 1000);
    if (uRes.userStatus && Object.keys(uRes.userStatus).length > 0) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

async function probeEndpoint(port: number, token: string): Promise<boolean> {
  if (await probeQuotaEndpoint(port, token)) {
    return true;
  }
  try {
    const aRes = await sendAgyConnectRpc<Record<string, any>>(port, token, 'AuthGetStatus', {}, 1000);
    if (aRes && Object.keys(aRes).length > 0) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Discovers the active agy hub or language server endpoint from:
 * 1. ~/.gemini/antigravity/daemon/hub_<port>.json (plus any ports owned by its PID)
 * 2. Running agy / language_server processes and their listening TCP ports
 */
export async function discoverAgyHubEndpoint(): Promise<AgyHubEndpoint | undefined> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return undefined;
  }

  const candidatePids = new Set<string>();
  const candidateTokens = new Set<string>();

  // 1. Inspect ~/.gemini/antigravity/daemon/hub_<port>.json (newest first)
  for (const dir of getAgyDaemonDirs()) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const full = path.join(dir, f);
          const stat = fs.statSync(full);
          return { file: f, full, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of files) {
        const namePortMatch = entry.file.match(/hub_(\d+)\.json/i);
        const portsToTry: number[] = [];
        if (namePortMatch?.[1]) {
          portsToTry.push(parseInt(namePortMatch[1], 10));
        }
        let token = '';
        let pid: number | undefined;

        try {
          const raw = JSON.parse(fs.readFileSync(entry.full, 'utf8')) as Record<string, unknown>;
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'number' && /port/i.test(k) && v > 0 && v < 65536) {
              if (!portsToTry.includes(v)) portsToTry.push(v);
            } else if (typeof v === 'string' && /port/i.test(k) && /^\d+$/.test(v)) {
              const p = parseInt(v, 10);
              if (!portsToTry.includes(p)) portsToTry.push(p);
            } else if (typeof v === 'string' && /csrf|token|secret|key/i.test(k) && v.length > 0) {
              token = v;
              candidateTokens.add(v);
            } else if (typeof v === 'number' && /^pid$/i.test(k)) {
              pid = v;
              candidatePids.add(String(v));
            }
          }
        } catch {
          // Ignore malformed JSON files.
        }

        const tokensToTry = token ? [token, ...candidateTokens, ''] : [...candidateTokens, ''];
        for (const port of portsToTry) {
          for (const tok of tokensToTry) {
            if (await probeQuotaEndpoint(port, tok)) {
              return { port, token: tok, pid, hubFile: entry.full };
            }
          }
        }
        for (const port of portsToTry) {
          for (const tok of tokensToTry) {
            if (await probeEndpoint(port, tok)) {
              return { port, token: tok, pid, hubFile: entry.full };
            }
          }
        }
      }
    } catch {
      // Ignore directory read errors.
    }
  }

  // 2. Scan running processes for `agy` or `language_server`.
  try {
    if (process.platform === 'win32') {
      const psScript = `
        $procs = Get-CimInstance Win32_Process | Where-Object {
          $_.Name -like '*language_server*' -or $_.Name -like '*agy*'
        } | Select-Object ProcessId, CommandLine
        @($procs) | ConvertTo-Json -Compress
      `;

      const psOut = child_process.execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, timeout: 3500 }
      );

      let netstatOut = '';
      try {
        netstatOut = child_process.execSync('netstat -ano -p tcp', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
          timeout: 3000,
        });
      } catch {
        // Ignore netstat errors.
      }

      const parsed = JSON.parse(psOut.trim() || '[]');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const processEntries: Array<{ pid: string; ports: number[] }> = [];

      for (const item of [...items].reverse()) {
        const pid = item.ProcessId ? String(item.ProcessId) : undefined;
        const cmd = typeof item.CommandLine === 'string' ? item.CommandLine : '';
        if (!pid) continue;
        candidatePids.add(pid);

        const tokenMatch = cmd.match(/(?:--csrf_token|csrf-token|token)[=\s]+([A-Za-z0-9_-]+)/i);
        if (tokenMatch?.[1]) {
          candidateTokens.add(tokenMatch[1]);
        }

        const ports: number[] = [];
        for (const m of cmd.matchAll(/(?:--hub-port|hub_port|extension_server_port|server_port|port)[=\s]+(\d+)/gi)) {
          if (m[1]) ports.push(parseInt(m[1], 10));
        }

        if (netstatOut) {
          for (const line of netstatOut.split('\n')) {
            if (!line.includes('LISTENING')) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[parts.length - 1] === pid) {
              const portMatch = parts[1].match(/:(\d+)$/);
              if (portMatch?.[1]) {
                const p = parseInt(portMatch[1], 10);
                if (!isNaN(p) && !ports.includes(p)) ports.push(p);
              }
            }
          }
        }

        processEntries.push({ pid, ports });
      }

      const allTokensToTry = [...candidateTokens, ''];

      for (const entry of processEntries) {
        for (const port of entry.ports) {
          for (const tok of allTokensToTry) {
            if (await probeQuotaEndpoint(port, tok)) {
              return { port, token: tok, pid: Number(entry.pid) };
            }
          }
        }
      }

      for (const entry of processEntries) {
        for (const port of entry.ports) {
          for (const tok of allTokensToTry) {
            if (await probeEndpoint(port, tok)) {
              return { port, token: tok, pid: Number(entry.pid) };
            }
          }
        }
      }
    } else {
      const psOut = child_process.execSync('ps aux', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = psOut
        .split('\n')
        .filter((l) => l.includes('agy') || l.includes('language_server'));

      let ssOut = '';
      if (process.platform === 'linux') {
        try {
          ssOut = child_process.execSync('ss -tlpn', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch {
          // Ignore errors from ss.
        }
      }

      const processEntries: Array<{ pid: string; ports: number[] }> = [];

      for (const line of lines) {
        const pidMatch = line.trim().match(/^\S+\s+(\d+)/);
        if (!pidMatch?.[1]) continue;
        const pid = pidMatch[1];
        candidatePids.add(pid);

        const tokenMatch = line.match(/(?:--csrf_token|csrf-token|token)[=\s]+([A-Za-z0-9_-]+)/i);
        if (tokenMatch?.[1]) {
          candidateTokens.add(tokenMatch[1]);
        }

        const ports: number[] = [];
        for (const m of line.matchAll(/(?:--hub-port|hub_port|extension_server_port|server_port|port)[=\s]+(\d+)/gi)) {
          if (m[1]) ports.push(parseInt(m[1], 10));
        }

        if (ssOut) {
          const regex = new RegExp(`(?:127\\.0\\.0\\.1|\\[::1\\]|\\*|0\\.0\\.0\\.0):(\\d+).*?pid=${pid}\\b`, 'g');
          for (const m of ssOut.matchAll(regex)) {
            if (m[1]) {
              const p = parseInt(m[1], 10);
              if (!ports.includes(p)) ports.push(p);
            }
          }
        }

        processEntries.push({ pid, ports });
      }

      const allTokensToTry = [...candidateTokens, ''];

      // Pass 1: prefer endpoints that serve live quota/userStatus
      for (const entry of processEntries) {
        for (const port of entry.ports) {
          for (const tok of allTokensToTry) {
            if (await probeQuotaEndpoint(port, tok)) {
              return { port, token: tok, pid: Number(entry.pid) };
            }
          }
        }
      }

      // Pass 2: accept AuthGetStatus endpoints
      for (const entry of processEntries) {
        for (const port of entry.ports) {
          for (const tok of allTokensToTry) {
            if (await probeEndpoint(port, tok)) {
              return { port, token: tok, pid: Number(entry.pid) };
            }
          }
        }
      }

      // Also check any ports belonging to PIDs found in hub_<port>.json.
      if (ssOut && candidatePids.size > 0) {
        for (const pid of candidatePids) {
          const regex = new RegExp(`(?:127\\.0\\.0\\.1|\\[::1\\]|\\*|0\\.0\\.0\\.0):(\\d+).*?pid=${pid}\\b`, 'g');
          for (const m of ssOut.matchAll(regex)) {
            if (!m[1]) continue;
            const port = parseInt(m[1], 10);
            for (const tok of allTokensToTry) {
              if (await probeQuotaEndpoint(port, tok)) {
                return { port, token: tok, pid: Number(pid) };
              }
            }
            for (const tok of allTokensToTry) {
              if (await probeEndpoint(port, tok)) {
                return { port, token: tok, pid: Number(pid) };
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore process discovery errors.
  }

  return undefined;
}

/**
 * Queries AuthGetStatus and GetUserStatus from the running agy hub daemon,
 * and falls back to scanning ~/.gemini/antigravity files if needed.
 */
export async function queryAgyLiveAuthStatus(): Promise<AgyLiveAuthStatus | undefined> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return undefined;
  }

  let email: string | undefined;
  let name: string | undefined;
  let plan: string | undefined;
  let authenticated = false;
  const combinedRaw: Record<string, unknown> = {};

  const endpoint = await discoverAgyHubEndpoint();
  if (endpoint) {
    // 1. Call AuthGetStatus.
    try {
      const authRes = await sendAgyConnectRpc<Record<string, any>>(
        endpoint.port,
        endpoint.token,
        'AuthGetStatus'
      );
      combinedRaw.authGetStatus = authRes;
      const str = JSON.stringify(authRes || {});
      const extractedEmail = extractEmailFromBuffer(Buffer.from(str, 'utf8'));
      if (extractedEmail) {
        email = extractedEmail;
        authenticated = true;
      }
      const statusObj = authRes.status || authRes.authStatus || authRes.response || authRes;
      if (statusObj && typeof statusObj === 'object') {
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
      // Fall back to GetUserStatus.
    }

    // 2. Call GetUserStatus for email and plan tier.
    try {
      const userRes = await sendAgyConnectRpc<Record<string, any>>(
        endpoint.port,
        endpoint.token,
        'GetUserStatus'
      );
      combinedRaw.getUserStatus = userRes;
      const us = userRes.userStatus || userRes.response?.userStatus || userRes;
      if (us && typeof us === 'object') {
        if (!name && typeof us.name === 'string') {
          name = us.name;
        }
        if (us.userTier && (us.userTier.id || us.userTier.name)) {
          plan = formatPlanFromTier({ id: us.userTier.id, name: us.userTier.name });
        } else if (us.planStatus?.planInfo?.planName) {
          plan = formatPlanFromTier({ name: us.planStatus.planInfo.planName });
        }
        const str = JSON.stringify(us);
        if (!email) {
          const extracted = extractEmailFromBuffer(Buffer.from(str, 'utf8'));
          if (extracted) {
            email = extracted;
            authenticated = true;
          }
        }
        if (!plan) {
          plan = extractPlanFromBuffer(Buffer.from(str, 'utf8'));
        }
      }
    } catch {
      // Ignore errors from GetUserStatus.
    }
  }

  // 3. Fallback: scan ~/.gemini/antigravity for cached user info / email if RPC didn't return email.
  if (!email) {
    const home = os.homedir();
    const candidateFiles = [
      path.join(home, '.gemini', 'antigravity', 'user_status.json'),
      path.join(home, '.gemini', 'antigravity', 'auth.json'),
      path.join(home, '.gemini', 'antigravity', 'accounts.json'),
      path.join(home, '.gemini', 'google_accounts.json'),
    ];
    for (const file of candidateFiles) {
      if (!fs.existsSync(file)) continue;
      try {
        const buf = fs.readFileSync(file);
        const found = extractEmailFromBuffer(buf);
        if (found) {
          email = found;
          authenticated = true;
          if (!plan) plan = extractPlanFromBuffer(buf);
          break;
        }
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  if (!authenticated && !email && !plan && Object.keys(combinedRaw).length === 0) {
    return undefined;
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
 * Logs out the running agy hub daemon via ConnectRPC AuthLogout.
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
 * Terminates all running agy hub daemon processes and cleans up hub_<port>.json files
 * so that Antigravity spawns a fresh agy hub reading the new OS Keychain credentials.
 */
export function killAgyHubDaemon(): void {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return;
  }

  // 1. Delete hub_*.json files and kill their recorded PIDs.
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
              // The process may already be dead.
            }
          }
        } catch {
          // Ignore malformed JSON files.
        }
        try {
          fs.rmSync(full, { force: true });
        } catch {
          // Ignore file cleanup errors.
        }
      }
    } catch {
      // Ignore directory read errors.
    }
  }

  // 2. Kill any lingering `agy hub` process.
  try {
    if (process.platform === 'win32') {
      child_process.execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*agy*' -and ($_.CommandLine -like '*--hub*' -or $_.CommandLine -like '* hub*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 3000 }
      );
    } else {
      child_process.execFileSync('pkill', ['-f', 'agy.*(?:--hub| hub)'], {
        stdio: 'ignore',
        timeout: 2000,
      });
    }
  } catch {
    // pkill exits 1 when no process matched; ignore.
  }
}

/**
 * Spawns `~/.gemini/bin/agy --hub --app_data_dir=antigravity` in the background if not running,
 * so that after restoring Window 1's keychain token the hub daemon is immediately ready for quota queries.
 */
export function ensureAgyHubDaemonRunning(): void {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return;
  }

  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  const candidates = [
    path.join(home, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'),
    '/opt/antigravity-ide/resources/app/extensions/agy/bin/agy',
    '/opt/antigravity/resources/app/extensions/agy/bin/agy',
    path.join(localAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
    path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
    path.join(programFiles, 'Antigravity IDE', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
    path.join(programFiles, 'Antigravity', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
  ];

  for (const bin of candidates) {
    if (fs.existsSync(bin)) {
      try {
        const child = child_process.spawn(bin, ['--hub', '--app_data_dir=antigravity'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } catch {
        // ignore
      }
      return;
    }
  }
}

