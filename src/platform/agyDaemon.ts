import { readKeychainToken } from './keychain';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractEmailFromBuffer, extractPlanFromBuffer, formatPlanFromTier } from '../accounts/identity';
import {
  getWslDistrosOnWindows,
  getWslLinuxUserHomesOnWindows,
  getWslWindowsUserHomes,
  isWsl,
} from './wsl';

export interface AgyDaemonWslOptions {
  /** Include WSL distribution daemon dirs, caches, and processes when running on Windows. */
  includeWsl?: boolean;
  /** Prefer/restrict probing to WSL daemon endpoints and caches (for WSL Remote windows). */
  preferWsl?: boolean;
  /** Target WSL distribution name (e.g. "Ubuntu-24.04"). */
  wslDistro?: string;
  /** Restrict WSL enumeration on Windows to currently running distributions only. */
  wslRunningOnly?: boolean;
}

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

function joinWinUnc(baseUnc: string, ...segments: string[]): string {
  return [baseUnc.replace(/[\\/]+$/, ''), ...segments].join('\\');
}

function getWslDaemonDirsOnWindows(options?: AgyDaemonWslOptions): string[] {
  if (process.platform !== 'win32' || (!options?.includeWsl && !options?.preferWsl)) {
    return [];
  }
  const dirs: string[] = [];
  const homes = getWslLinuxUserHomesOnWindows({
    runningOnly: options.wslRunningOnly,
    targetDistro: options.wslDistro,
  });
  for (const h of homes) {
    dirs.push(
      joinWinUnc(h.uncHome, '.gemini', 'antigravity', 'daemon'),
      joinWinUnc(h.uncHome, '.gemini', 'daemon')
    );
  }
  return dirs;
}

/**
 * Returns candidate daemon directories where agy hub writes hub_<port>.json.
 */
function getAgyDaemonDirs(options?: AgyDaemonWslOptions): string[] {
  const home = os.homedir();
  const geminiHome = process.env.GEMINI_CLI_HOME || path.join(home, '.gemini');
  const localDirs = [
    path.join(geminiHome, 'antigravity', 'daemon'),
    path.join(home, '.gemini', 'antigravity', 'daemon'),
    path.join(home, '.gemini', 'daemon'),
  ];
  if (isWsl()) {
    for (const winHome of getWslWindowsUserHomes()) {
      localDirs.push(
        path.join(winHome, '.gemini', 'antigravity', 'daemon'),
        path.join(winHome, '.gemini', 'daemon')
      );
    }
  }
  const wslDirs = getWslDaemonDirsOnWindows(options);
  if (options?.preferWsl) {
    return wslDirs.length > 0 ? wslDirs : localDirs;
  }
  return [...localDirs, ...wslDirs];
}

/**
 * Sends a Connect-RPC HTTP/1.1 POST to /exa.language_server_pb.LanguageServerService/<method>
 * over loopback 127.0.0.1.
 */
function sendAgyConnectRpc<T>(
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

async function probeQuotaEndpoint(port: number, token: string): Promise<boolean> {
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

async function probeHubDaemonDirectories(
  dirs: string[],
  candidatePids: Set<string>,
  candidateTokens: Set<string>
): Promise<AgyHubEndpoint | undefined> {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const full = dir.includes('\\') && !dir.includes('/') ? `${dir}\\${f}` : path.join(dir, f);
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
  return undefined;
}

async function probeUnixProcessOutput(
  psOut: string,
  ssOut: string,
  candidatePids: Set<string>,
  candidateTokens: Set<string>
): Promise<AgyHubEndpoint | undefined> {
  const lines = psOut
    .split('\n')
    .filter((l) => l.includes('agy') || l.includes('language_server'));

  const processEntries: Array<{ pid: string; ports: number[] }> = [];

  for (const line of [...lines].reverse()) {
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

  return undefined;
}

async function discoverWslAgyHubEndpointOnWindows(
  options?: AgyDaemonWslOptions
): Promise<AgyHubEndpoint | undefined> {
  if (process.platform !== 'win32') return undefined;

  const wslPids = new Set<string>();
  const wslTokens = new Set<string>();

  const wslDirs = getWslDaemonDirsOnWindows(options);
  const fromHub = await probeHubDaemonDirectories(wslDirs, wslPids, wslTokens);
  if (fromHub) return fromHub;

  const distros = getWslDistrosOnWindows({
    runningOnly: options?.wslRunningOnly ?? true,
    targetDistro: options?.wslDistro,
  });
  for (const distro of distros) {
    try {
      const out = child_process.execFileSync(
        'wsl.exe',
        ['-d', distro, '-e', 'sh', '-c', 'ps aux; echo "===SS==="; ss -tlpn 2>/dev/null || true'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 3500 }
      );
      const [psOut = '', ssOut = ''] = out.split('===SS===');
      const found = await probeUnixProcessOutput(psOut, ssOut, wslPids, wslTokens);
      if (found) return found;
    } catch {
      // Ignore unreachable or stopped WSL distros.
    }
  }

  return undefined;
}

/**
 * Discovers the active agy hub or language server endpoint from:
 * 1. ~/.gemini/antigravity/daemon/hub_<port>.json (plus any ports owned by its PID)
 * 2. Running agy / language_server processes and their listening TCP ports
 */
export async function discoverAgyHubEndpoint(
  options?: AgyDaemonWslOptions
): Promise<AgyHubEndpoint | undefined> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return undefined;
  }

  if (process.platform === 'win32' && options?.preferWsl) {
    return discoverWslAgyHubEndpointOnWindows({ ...options, includeWsl: true });
  }

  const candidatePids = new Set<string>();
  const candidateTokens = new Set<string>();

  // 1. Inspect local ~/.gemini/antigravity/daemon/hub_<port>.json (newest first)
  const localEndpoint = await probeHubDaemonDirectories(
    getAgyDaemonDirs({ includeWsl: false, preferWsl: false }),
    candidatePids,
    candidateTokens
  );
  if (localEndpoint) {
    return localEndpoint;
  }

  // 2. Scan running processes for `agy` or `language_server`.
  try {
    if (process.platform === 'win32' || isWsl()) {
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
        netstatOut = child_process.execSync(
          process.platform === 'win32' ? 'netstat -ano -p tcp' : 'netstat.exe -ano -p tcp',
          {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true,
            timeout: 3000,
          }
        );
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
            if (parts.length >= 5 && parts[parts.length - 1] === pid && parts[1]) {
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

      const found = await probeUnixProcessOutput(psOut, ssOut, candidatePids, candidateTokens);
      if (found) return found;
    }
  } catch {
    // Ignore process discovery errors.
  }

  if (process.platform === 'win32' && options?.includeWsl) {
    return discoverWslAgyHubEndpointOnWindows(options);
  }

  return undefined;
}

/**
 * Queries AuthGetStatus and GetUserStatus from the running agy hub daemon,
 * and falls back to scanning ~/.gemini/antigravity files if needed.
 */
export async function queryAgyLiveAuthStatus(
  options?: AgyDaemonWslOptions
): Promise<AgyLiveAuthStatus | undefined> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return undefined;
  }

  let email: string | undefined;
  let name: string | undefined;
  let plan: string | undefined;
  let authenticated = false;
  let rpcRespondedSignedOut = false;
  const combinedRaw: Record<string, unknown> = {};

  const endpoint = await discoverAgyHubEndpoint(options);
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
        } else if (
          statusObj.authenticated === false ||
          statusObj.isLoggedIn === false ||
          statusObj.loggedIn === false ||
          statusObj.hasToken === false ||
          statusObj.state === 'UNAUTHENTICATED' ||
          statusObj.status === 'UNAUTHENTICATED'
        ) {
          rpcRespondedSignedOut = true;
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
            rpcRespondedSignedOut = false;
          }
        }
        if (!plan) {
          plan = extractPlanFromBuffer(Buffer.from(str, 'utf8'));
        }
      }
    } catch {
      // Ignore errors from GetUserStatus.
    }

    if (authenticated || email) {
      rpcRespondedSignedOut = false;
    }
  }

  // 3. Fallback: scan ~/.gemini/antigravity only (not Gemini CLI's ~/.gemini/google_accounts.json)
  // when RPC did not explicitly report an unauthenticated state.
  if (!email && !rpcRespondedSignedOut) {
    const wslHomes =
      process.platform === 'win32' && (options?.includeWsl || options?.preferWsl)
        ? getWslLinuxUserHomesOnWindows({
            runningOnly: options.wslRunningOnly,
            targetDistro: options.wslDistro,
          })
        : [];
    const candidateFiles: string[] = [];
    if (!(process.platform === 'win32' && options?.preferWsl && wslHomes.length > 0)) {
      const home = os.homedir();
      candidateFiles.push(
        path.join(home, '.gemini', 'antigravity', 'user_status.json'),
        path.join(home, '.gemini', 'antigravity', 'auth.json'),
        path.join(home, '.gemini', 'antigravity', 'accounts.json')
      );
    }
    for (const wh of wslHomes) {
      candidateFiles.push(
        joinWinUnc(wh.uncHome, '.gemini', 'antigravity', 'user_status.json'),
        joinWinUnc(wh.uncHome, '.gemini', 'antigravity', 'auth.json'),
        joinWinUnc(wh.uncHome, '.gemini', 'antigravity', 'accounts.json')
      );
    }
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

  if (!authenticated && !email && !plan && !rpcRespondedSignedOut) {
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
export async function logoutAgyDaemon(options?: AgyDaemonWslOptions): Promise<boolean> {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return true;
  }

  const endpoint = await discoverAgyHubEndpoint(options);
  if (!endpoint) return false;
  try {
    await sendAgyConnectRpc(endpoint.port, endpoint.token, 'AuthLogout', {});
    return true;
  } catch {
    return false;
  }
}

const AGY_CACHE_FILES = [
  'user_status.json',
  'auth.json',
  'accounts.json',
  'quota.json',
  'user_status_cache.json',
  'agyhub_summaries_proto.pb',
] as const;

function cleanupDaemonDir(dir: string, killRecordedPid: boolean): void {
  if (!fs.existsSync(dir)) return;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!/^hub_\d+\.json$/i.test(file)) continue;
      const full = dir.includes('\\') && !dir.includes('/') ? `${dir}\\${file}` : path.join(dir, file);
      if (killRecordedPid) {
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

/**
 * Terminates all running agy hub daemon processes and cleans up hub_<port>.json files
 * so that Antigravity spawns a fresh agy hub reading the new OS Keychain credentials.
 */
export function killAgyHubDaemon(options?: AgyDaemonWslOptions): void {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
    return;
  }

  // 1. Delete local hub_*.json files and kill their recorded PIDs.
  for (const dir of getAgyDaemonDirs({ includeWsl: false, preferWsl: false })) {
    cleanupDaemonDir(dir, !dir.startsWith('/mnt/'));
  }

  // Also remove cached user_status.json so agy hub fetches fresh identity on restart
  const homes = [os.homedir(), ...(isWsl() ? getWslWindowsUserHomes() : [])];
  for (const h of homes) {
    for (const cachedFile of AGY_CACHE_FILES) {
      try {
        fs.rmSync(path.join(h, '.gemini', 'antigravity', cachedFile), { force: true });
        fs.rmSync(path.join(h, '.gemini', cachedFile), { force: true });
      } catch {
        // ignore
      }
    }
  }

  // 2. Kill any lingering agy hub process on Windows and/or Linux.
  if (process.platform === 'win32' || isWsl()) {
    try {
      const psKill = "Get-CimInstance Win32_Process -Filter \"Name like '%agy%'\" | Where-Object { $_.CommandLine -like '*--hub*' -or $_.CommandLine -like '* hub*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      const b64 = Buffer.from(psKill, 'utf16le').toString('base64');
      child_process.execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
        { stdio: 'ignore', windowsHide: true, timeout: 5000 }
      );
    } catch {
      // ignore
    }
  }
  if (process.platform !== 'win32') {
    try {
      child_process.execFileSync('pkill', ['-9', '-f', 'agy.*(?:--hub| hub)'], {
        stdio: 'ignore',
        timeout: 2000,
      });
    } catch {
      // pkill exits 1 when no process matched; ignore.
    }
  }

  // 3. When requested from Windows UI host (e.g. switch-helper), also terminate WSL agy --hub & clear WSL caches.
  if (process.platform === 'win32' && options?.includeWsl) {
    for (const wslDir of getWslDaemonDirsOnWindows(options)) {
      // Never pass Linux PIDs from WSL hub_*.json to Windows process.kill().
      cleanupDaemonDir(wslDir, false);
    }
    for (const wh of getWslLinuxUserHomesOnWindows({
      runningOnly: options.wslRunningOnly,
      targetDistro: options.wslDistro,
    })) {
      for (const cachedFile of AGY_CACHE_FILES) {
        try {
          fs.rmSync(joinWinUnc(wh.uncHome, '.gemini', 'antigravity', cachedFile), { force: true });
          fs.rmSync(joinWinUnc(wh.uncHome, '.gemini', cachedFile), { force: true });
        } catch {
          // ignore
        }
      }
    }

    const wslDistros = getWslDistrosOnWindows({
      runningOnly: options.wslRunningOnly,
      targetDistro: options.wslDistro,
    });
    for (const distro of wslDistros) {
      try {
        child_process.execFileSync(
          'wsl.exe',
          [
            '-d',
            distro,
            '-e',
            'sh',
            '-c',
            "pkill -9 -f 'agy.*(--hub| hub)' 2>/dev/null || true; rm -f \"$HOME/.gemini/antigravity/daemon/hub_\"*.json \"$HOME/.gemini/antigravity/user_status.json\" \"$HOME/.gemini/antigravity/agyhub_summaries_proto.pb\" 2>/dev/null || true",
          ],
          { stdio: 'ignore', windowsHide: true, timeout: 4000 }
        );
      } catch {
        // ignore stopped/unreachable distros
      }
    }
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
  if (isWsl()) {
    for (const winHome of getWslWindowsUserHomes()) {
      candidates.push(
        path.join(winHome, '.gemini', 'bin', 'agy.exe'),
        path.join(winHome, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
        path.join(winHome, 'AppData', 'Local', 'Programs', 'Antigravity', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe')
      );
    }
    candidates.push(
      '/mnt/c/Program Files/Antigravity IDE/resources/app/extensions/agy/bin/agy.exe',
      '/mnt/c/Program Files/Antigravity/resources/app/extensions/agy/bin/agy.exe'
    );
  }

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

/**
 * Returns true when running on Antigravity IDE 2.6.0+ (OS Keychain token, agy daemon dir, or bundled agy extension exists).
 */
export function isAntigravity26OrNewer(appRoot?: string): boolean {
  try {
    if (readKeychainToken()) {
      return true;
    }
    if (appRoot) {
      if (
        fs.existsSync(path.join(appRoot, 'extensions', 'agy')) ||
        fs.existsSync(path.join(appRoot, 'extensions', 'google-antigravity'))
      ) {
        return true;
      }
    }
    if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_DAEMON) {
      return false;
    }
    for (const dir of getAgyDaemonDirs()) {
      if (fs.existsSync(dir)) {
        return true;
      }
    }
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const binCandidates = [
      path.join(home, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'),
      '/opt/antigravity-ide/resources/app/extensions/agy/bin/agy',
      '/opt/antigravity/resources/app/extensions/agy/bin/agy',
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
      path.join(programFiles, 'Antigravity IDE', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
      path.join(programFiles, 'Antigravity', 'resources', 'app', 'extensions', 'agy', 'bin', 'agy.exe'),
    ];
    return binCandidates.some((b) => fs.existsSync(b));
  } catch {
    return false;
  }
}
