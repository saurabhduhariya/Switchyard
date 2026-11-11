import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hasSignedOutSentinel } from '../accounts/identity';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from '../constants';
import {
  getWslLinuxUserHomesOnWindows,
  getWslWindowsUserHomes,
  isWsl,
  type WslLinuxUserHome,
} from './wsl';

const WIN32_CRED_CSHARP = `
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }

  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

  [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] uint flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, uint type, int flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
  public static extern bool CredFree([In] IntPtr cred);

  public static string ReadSecret(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return null;
      byte[] bytes = new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);

      // zalando/go-keyring (danieljoos/wincred) writes raw UTF-8 bytes; cmdkey writes UTF-16LE. Support both:
      if (bytes.Length >= 4 && bytes[1] == 0 && bytes[3] == 0) {
        return Encoding.Unicode.GetString(bytes);
      }
      return Encoding.UTF8.GetString(bytes);
    } finally {
      CredFree(ptr);
    }
  }

  public static bool WriteSecret(string target, string user, string secret) {
    byte[] bytes = Encoding.UTF8.GetBytes(secret);
    CREDENTIAL cred = new CREDENTIAL();
    cred.Flags = 0;
    cred.Type = 1; // CRED_TYPE_GENERIC
    cred.TargetName = Marshal.StringToCoTaskMemUni(target);
    cred.UserName = Marshal.StringToCoTaskMemUni(user);
    cred.CredentialBlobSize = (uint)bytes.Length;
    cred.CredentialBlob = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, cred.CredentialBlob, bytes.Length);
    cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE (matches danieljoos/wincred)
    try {
      return CredWrite(ref cred, 0);
    } finally {
      Marshal.FreeCoTaskMem(cred.TargetName);
      Marshal.FreeCoTaskMem(cred.UserName);
      Marshal.FreeCoTaskMem(cred.CredentialBlob);
    }
  }

  public static bool DeleteSecret(string target) {
    return CredDelete(target, 1, 0);
  }
}
`;

export interface DecodedKeyringToken {
  raw: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiry?: string;
  json?: Record<string, unknown>;
}

const TRIVIAL_NON_TOKEN_LITERALS = new Set(['null', 'undefined', 'false', 'true', '{}', '[]', 'signedout']);

/**
 * Decodes a zalando/go-keyring payload ("go-keyring-base64:<base64>" or raw JSON).
 * Rejects empty placeholders, signed-out sentinels, and JSON objects with no OAuth tokens.
 */
export function decodeKeyringValue(raw: string): DecodedKeyringToken | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || TRIVIAL_NON_TOKEN_LITERALS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  if (hasSignedOutSentinel(trimmed)) {
    return undefined;
  }

  let jsonStr = trimmed;
  let isGoKeyring = false;
  if (trimmed.startsWith('go-keyring-base64:')) {
    isGoKeyring = true;
    const b64 = trimmed.slice('go-keyring-base64:'.length).trim();
    if (!b64) return undefined;
    try {
      const decodedBuf = Buffer.from(b64, 'base64');
      if (decodedBuf.length === 0) return undefined;
      jsonStr = decodedBuf.toString('utf8').trim();
      if (!jsonStr || TRIVIAL_NON_TOKEN_LITERALS.has(jsonStr.toLowerCase())) {
        return undefined;
      }
      if (hasSignedOutSentinel(jsonStr)) {
        return undefined;
      }
    } catch {
      return { raw: trimmed };
    }
  }

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    const tokenObj =
      typeof obj.token === 'object' && obj.token !== null
        ? (obj.token as Record<string, unknown>)
        : obj;

    const accessToken =
      typeof tokenObj.access_token === 'string' && tokenObj.access_token.trim()
        ? tokenObj.access_token
        : typeof tokenObj.accessToken === 'string' && tokenObj.accessToken.trim()
          ? tokenObj.accessToken
          : undefined;
    const refreshToken =
      typeof tokenObj.refresh_token === 'string' && tokenObj.refresh_token.trim()
        ? tokenObj.refresh_token
        : typeof tokenObj.refreshToken === 'string' && tokenObj.refreshToken.trim()
          ? tokenObj.refreshToken
          : undefined;
    const idToken =
      typeof tokenObj.id_token === 'string' && tokenObj.id_token.trim()
        ? tokenObj.id_token
        : typeof tokenObj.idToken === 'string' && tokenObj.idToken.trim()
          ? tokenObj.idToken
          : undefined;
    const expiry = typeof tokenObj.expiry === 'string' ? tokenObj.expiry : undefined;

    if (
      String(obj.state || '').toLowerCase() === 'signedout' ||
      (!accessToken && !refreshToken && !idToken)
    ) {
      return undefined;
    }

    return {
      raw: trimmed,
      accessToken,
      refreshToken,
      idToken,
      expiry,
      json: obj,
    };
  } catch {
    // Non-JSON payload (e.g. go-keyring-base64 protobuf bytes)
    if (!isGoKeyring && TRIVIAL_NON_TOKEN_LITERALS.has(jsonStr.toLowerCase())) {
      return undefined;
    }
  }

  return { raw: trimmed };
}

let inMemoryTestKeychain: string | undefined;

export function __setTestKeychainToken(token?: string): void {
  inMemoryTestKeychain = token;
}

export interface KeychainWslOptions {
  /** Also read/write/clear WSL distro standalone token files when running on Windows. */
  includeWsl?: boolean;
  /** Prefer WSL standalone token over Windows Credential Manager for WSL Remote windows. */
  preferWsl?: boolean;
  /** Target WSL distribution name (e.g. "Ubuntu-24.04"). */
  wslDistro?: string;
  /** Restrict WSL enumeration on Windows to currently running distributions only. */
  wslRunningOnly?: boolean;
  /** Restrict standalone lookup to WSL paths only. */
  wslOnly?: boolean;
}

function joinWinUncPath(baseUnc: string, ...segments: string[]): string {
  const cleanBase = baseUnc.replace(/[\\/]+$/, '');
  return [cleanBase, ...segments].join('\\');
}

function getWslTokenTargetsOnWindows(options?: KeychainWslOptions): Array<{
  distro: string;
  tokenPath: string;
}> {
  if (process.platform !== 'win32') return [];
  if (!options?.includeWsl && !options?.preferWsl && !options?.wslOnly) return [];
  const homes: WslLinuxUserHome[] = getWslLinuxUserHomesOnWindows({
    runningOnly: options.wslRunningOnly,
    targetDistro: options.wslDistro,
  });
  return homes.map((h) => ({
    distro: h.distro,
    tokenPath: joinWinUncPath(h.uncHome, '.gemini', 'jetski-standalone-oauth-token'),
  }));
}

function writeWslStandaloneViaCli(distro: string, payload: string): boolean {
  try {
    child_process.execFileSync(
      'wsl.exe',
      [
        '-d',
        distro,
        '-e',
        'sh',
        '-c',
        'umask 077 && mkdir -p "$HOME/.gemini" && cat > "$HOME/.gemini/jetski-standalone-oauth-token"',
      ],
      {
        input: payload,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        timeout: 4000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

function clearWslStandaloneViaCli(distro: string): boolean {
  try {
    child_process.execFileSync(
      'wsl.exe',
      ['-d', distro, '-e', 'sh', '-c', 'rm -f "$HOME/.gemini/jetski-standalone-oauth-token"'],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        timeout: 4000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns candidate paths for jetski-standalone-oauth-token across candidate user homes.
 */
export function getStandaloneTokenPaths(options?: KeychainWslOptions): string[] {
  const paths: string[] = [];

  if (!options?.wslOnly) {
    const primaryHome = os.homedir();
    const primaryToken = path.join(primaryHome, '.gemini', 'jetski-standalone-oauth-token');
    paths.push(primaryToken);

    if (process.env.GEMINI_CLI_HOME) {
      const cliToken = path.join(process.env.GEMINI_CLI_HOME, 'jetski-standalone-oauth-token');
      if (!paths.includes(cliToken)) {
        paths.push(cliToken);
      }
    }

    if (isWsl()) {
      for (const winHome of getWslWindowsUserHomes()) {
        const winToken = path.join(winHome, '.gemini', 'jetski-standalone-oauth-token');
        if (!paths.includes(winToken)) {
          paths.push(winToken);
        }
      }
    }
  } else if (isWsl()) {
    paths.push(path.join(os.homedir(), '.gemini', 'jetski-standalone-oauth-token'));
  }

  for (const target of getWslTokenTargetsOnWindows(options)) {
    if (!paths.includes(target.tokenPath)) {
      paths.push(target.tokenPath);
    }
  }

  return paths;
}

/**
 * Reads jetski-standalone-oauth-token from WSL user home(s) only (on Windows UNC or inside WSL Linux).
 */
export function readWslStandaloneToken(options?: KeychainWslOptions): string | undefined {
  return readStandaloneToken({ ...options, includeWsl: true, wslOnly: true });
}

function readStandaloneToken(options?: KeychainWslOptions): string | undefined {
  for (const tokenPath of getStandaloneTokenPaths(options)) {
    try {
      if (fs.existsSync(tokenPath)) {
        const content = fs.readFileSync(tokenPath, 'utf8').trim();
        if (content) {
          return content;
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function writeStandaloneToken(
  rawSecret: string,
  targetEmail?: string,
  options?: KeychainWslOptions
): void {
  let jsonStr = rawSecret.trim();
  if (jsonStr.startsWith('go-keyring-base64:')) {
    try {
      jsonStr = Buffer.from(jsonStr.slice('go-keyring-base64:'.length).trim(), 'base64').toString('utf8');
    } catch {
      // keep jsonStr
    }
  }

  let formattedJson: string | undefined;
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, any>;
    if (parsed && typeof parsed === 'object') {
      if (targetEmail && !parsed.id_token_email) {
        parsed.id_token_email = targetEmail;
      }
      if (!parsed.token && (parsed.access_token || parsed.accessToken || parsed.refreshToken || parsed.refresh_token)) {
        const wrapped = {
          token: {
            access_token: parsed.access_token || parsed.accessToken,
            token_type: parsed.token_type || parsed.tokenType || 'Bearer',
            refresh_token: parsed.refresh_token || parsed.refreshToken,
            expiry: parsed.expiry,
            expires_in: parsed.expires_in || parsed.expiresIn || 3599,
          },
          auth_method: 'consumer',
          id_token_email: targetEmail,
        };
        formattedJson = JSON.stringify(wrapped, null, 2);
      } else {
        formattedJson = JSON.stringify(parsed, null, 2);
      }
    }
  } catch {
    formattedJson = jsonStr;
  }

  const payloadToWrite = formattedJson || jsonStr;
  const wslTargets = getWslTokenTargetsOnWindows(options);
  const wslPathToDistro = new Map(wslTargets.map((t) => [t.tokenPath, t.distro]));

  for (const tokenPath of getStandaloneTokenPaths(options)) {
    try {
      const dir = tokenPath.includes('\\') && !tokenPath.includes('/')
        ? tokenPath.slice(0, tokenPath.lastIndexOf('\\'))
        : path.dirname(tokenPath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tokenPath, payloadToWrite, { mode: 0o600 });
    } catch {
      const wslDistro = wslPathToDistro.get(tokenPath);
      if (wslDistro) {
        writeWslStandaloneViaCli(wslDistro, payloadToWrite);
      }
    }
  }
}

function clearStandaloneToken(options?: KeychainWslOptions): void {
  const wslTargets = getWslTokenTargetsOnWindows(options);
  const wslPathToDistro = new Map(wslTargets.map((t) => [t.tokenPath, t.distro]));

  for (const tokenPath of getStandaloneTokenPaths(options)) {
    try {
      if (fs.existsSync(tokenPath)) {
        fs.rmSync(tokenPath, { force: true });
      }
    } catch {
      const wslDistro = wslPathToDistro.get(tokenPath);
      if (wslDistro) {
        clearWslStandaloneViaCli(wslDistro);
      }
    }
  }
}

function readWindowsCredential(): string | undefined {
  try {
    const target = `${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`;
    const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${WIN32_CRED_CSHARP}
'@
$val = [WinCred]::ReadSecret('${target}')
if (-not $val) { $val = [WinCred]::ReadSecret('${KEYCHAIN_SERVICE}') }
if ($val) { [Console]::Out.Write($val); exit 0 }
exit 1
`;
    const out = child_process.execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 15000,
      }
    );
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeWindowsCredential(secret: string): boolean {
  try {
    const target = `${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`;
    const psScript = `
$ErrorActionPreference = 'Stop'
$secret = [Console]::In.ReadToEnd().Trim()
Add-Type -TypeDefinition @'
${WIN32_CRED_CSHARP}
'@
if (-not [WinCred]::WriteSecret('${target}', '${KEYCHAIN_ACCOUNT}', $secret)) {
  exit 1
}
`;
    child_process.execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        input: secret,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        timeout: 15000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

function deleteWindowsCredential(): boolean {
  try {
    const target = `${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`;
    const psScript = `
Add-Type -TypeDefinition @'
${WIN32_CRED_CSHARP}
'@
[void][WinCred]::DeleteSecret('${target}')
[void][WinCred]::DeleteSecret('${KEYCHAIN_SERVICE}')
`;
    child_process.execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { stdio: 'ignore', windowsHide: true, timeout: 15000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the active Antigravity credential from the OS Keychain (service: gemini, username: antigravity).
 */
export function readKeychainToken(options?: KeychainWslOptions): string | undefined {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    return inMemoryTestKeychain;
  }
  try {
    if (process.platform === 'linux') {
      // When WSL remote context explicitly prefers WSL's file-based standalone token, check it before Windows CredMan.
      if (isWsl() && options?.preferWsl) {
        const wslToken = readStandaloneToken({ wslOnly: true });
        if (wslToken) return wslToken;
        return undefined;
      }

      // If running inside WSL, check Windows Credential Manager first via powershell.exe
      if (isWsl()) {
        const winToken = readWindowsCredential();
        if (winToken) return winToken;
      }

      // 1. Primary: secret-tool (libsecret CLI)
      try {
        const out = child_process.execFileSync(
          'secret-tool',
          ['lookup', 'service', KEYCHAIN_SERVICE, 'username', KEYCHAIN_ACCOUNT],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
        );
        if (out && out.trim()) return out.trim();
      } catch {
        // Fallback to python3 secretstorage if secret-tool is not installed
      }

      // 2. Fallback: python3 with secretstorage / gi.repository.Secret
      const pyScript = `
import sys
try:
    import secretstorage
    bus = secretstorage.dbus_init()
    col = secretstorage.get_default_collection(bus)
    items = col.search_items({'service': '${KEYCHAIN_SERVICE}', 'username': '${KEYCHAIN_ACCOUNT}'})
    for item in items:
        sys.stdout.write(item.get_secret().decode('utf-8'))
        sys.exit(0)
except Exception:
    pass
sys.exit(1)
`;
      try {
        const out = child_process.execFileSync('python3', ['-c', pyScript], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        });
        if (out && out.trim()) return out.trim();
      } catch {
        // ignore
      }

      // 3. Fallback: jetski-standalone-oauth-token file (standard on headless Linux / agy hub)
      const standalone = readStandaloneToken(options);
      if (standalone) return standalone;

      return undefined;
    }

    if (process.platform === 'darwin') {
      try {
        const out = child_process.execFileSync(
          'security',
          ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
        );
        if (out && out.trim()) return out.trim();
      } catch {
        // ignore
      }
      return readStandaloneToken(options);
    }

    if (process.platform === 'win32') {
      if (options?.preferWsl) {
        const wslTargets = getWslTokenTargetsOnWindows({ ...options, wslOnly: true });
        if (wslTargets.length > 0) {
          // WSL `agy` always uses file-based token storage and never reads Windows Credential Manager.
          return readWslStandaloneToken(options);
        }
      }
      const winToken = readWindowsCredential();
      if (winToken) return winToken;
      return readStandaloneToken(options);
    }
  } catch {
    return readStandaloneToken(options);
  }
  return readStandaloneToken(options);
}

function hasLinuxSessionBus(): boolean {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) return true;
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    return fs.existsSync(`/run/user/${uid}/bus`);
  } catch {
    return false;
  }
}

function storeLinuxSecretService(secret: string): boolean {
  try {
    child_process.execFileSync(
      'secret-tool',
      [
        'store',
        `--label=${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`,
        'service',
        KEYCHAIN_SERVICE,
        'username',
        KEYCHAIN_ACCOUNT,
      ],
      {
        input: secret,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 3000,
      }
    );
    return true;
  } catch {
    // Fallback to python3 secretstorage
  }

  const pyScript = `
import sys, secretstorage
secret = sys.stdin.read().encode('utf-8')
bus = secretstorage.dbus_init()
col = secretstorage.get_default_collection(bus)
col.create_item('${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}', {'service': '${KEYCHAIN_SERVICE}', 'username': '${KEYCHAIN_ACCOUNT}'}, secret, replace=True)
`;
  try {
    child_process.execFileSync('python3', ['-c', pyScript], {
      input: secret,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

function clearLinuxSecretService(): boolean {
  try {
    child_process.execFileSync(
      'secret-tool',
      ['clear', 'service', KEYCHAIN_SERVICE, 'username', KEYCHAIN_ACCOUNT],
      { stdio: 'ignore', timeout: 3000 }
    );
    return true;
  } catch {
    const pyScript = `
import secretstorage
bus = secretstorage.dbus_init()
col = secretstorage.get_default_collection(bus)
for item in col.search_items({'service': '${KEYCHAIN_SERVICE}', 'username': '${KEYCHAIN_ACCOUNT}'}):
    item.delete()
`;
    try {
      child_process.execFileSync('python3', ['-c', pyScript], { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Writes the raw credential (e.g. "go-keyring-base64:...") into the OS Keychain
 * under service="gemini", username="antigravity" and to jetski-standalone-oauth-token.
 */
export function writeKeychainToken(
  rawSecret: string,
  targetEmail?: string,
  options?: KeychainWslOptions
): boolean {
  if (!rawSecret || !rawSecret.trim()) return false;
  const secret = rawSecret.trim();

  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    inMemoryTestKeychain = secret;
    return true;
  }

  // Always sync to jetski-standalone-oauth-token across candidate user homes
  writeStandaloneToken(secret, targetEmail, options);

  try {
    if (process.platform === 'linux') {
      if (isWsl()) {
        // Windows host Credential Manager is authoritative for Windows Antigravity IDE;
        // do not let a missing/present Linux keyring mask a Windows write failure.
        const wroteWin = writeWindowsCredential(secret);
        if (hasLinuxSessionBus()) {
          storeLinuxSecretService(secret);
        }
        return wroteWin;
      }

      if (storeLinuxSecretService(secret)) {
        return true;
      }
      return Boolean(readStandaloneToken(options));
    }

    if (process.platform === 'darwin') {
      child_process.execFileSync(
        'security',
        ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', secret],
        { stdio: 'ignore', timeout: 3000 }
      );
      return true;
    }

    if (process.platform === 'win32') {
      if (options?.wslOnly) {
        return Boolean(readWslStandaloneToken(options));
      }
      return writeWindowsCredential(secret);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Deletes the active credential from the OS Keychain (service: gemini, username: antigravity)
 * and removes jetski-standalone-oauth-token.
 */
export function clearKeychainToken(options?: KeychainWslOptions): boolean {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    inMemoryTestKeychain = undefined;
    return true;
  }

  clearStandaloneToken(options);

  try {
    if (process.platform === 'linux') {
      if (isWsl()) {
        const clearedWin = deleteWindowsCredential();
        if (hasLinuxSessionBus()) {
          clearLinuxSecretService();
        }
        return clearedWin;
      }

      clearLinuxSecretService();
      return true;
    }

    if (process.platform === 'darwin') {
      child_process.execFileSync(
        'security',
        ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
        { stdio: 'ignore', timeout: 3000 }
      );
      return true;
    }

    if (process.platform === 'win32') {
      return deleteWindowsCredential();
    }
  } catch {
    return false;
  }
  return false;
}
