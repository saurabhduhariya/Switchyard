import * as child_process from 'node:child_process';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from '../constants';

export interface DecodedKeyringToken {
  raw: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiry?: string;
  json?: Record<string, unknown>;
}

/**
 * Decodes a zalando/go-keyring payload ("go-keyring-base64:<base64>" or raw JSON).
 */
export function decodeKeyringValue(raw: string): DecodedKeyringToken | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let jsonStr = trimmed;
  if (trimmed.startsWith('go-keyring-base64:')) {
    const b64 = trimmed.slice('go-keyring-base64:'.length).trim();
    try {
      jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return { raw: trimmed };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const tokenObj =
        (typeof parsed.token === 'object' && parsed.token !== null
          ? (parsed.token as Record<string, unknown>)
          : parsed);

      return {
        raw: trimmed,
        accessToken:
          typeof tokenObj.access_token === 'string'
            ? tokenObj.access_token
            : typeof tokenObj.accessToken === 'string'
              ? tokenObj.accessToken
              : undefined,
        refreshToken:
          typeof tokenObj.refresh_token === 'string'
            ? tokenObj.refresh_token
            : typeof tokenObj.refreshToken === 'string'
              ? tokenObj.refreshToken
              : undefined,
        idToken:
          typeof tokenObj.id_token === 'string'
            ? tokenObj.id_token
            : typeof tokenObj.idToken === 'string'
              ? tokenObj.idToken
              : undefined,
        expiry: typeof tokenObj.expiry === 'string' ? tokenObj.expiry : undefined,
        json: parsed,
      };
    }
  } catch {
    // Not JSON; still return raw string
  }

  return { raw: trimmed };
}

let inMemoryTestKeychain: string | undefined;

export function __setTestKeychainToken(token?: string): void {
  inMemoryTestKeychain = token;
}

/**
 * Reads the active Antigravity credential from the OS Keychain (service: gemini, username: antigravity).
 */
export function readKeychainToken(): string | undefined {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    return inMemoryTestKeychain;
  }
  try {
    if (process.platform === 'linux') {
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
        return undefined;
      }
      return undefined;
    }

    if (process.platform === 'darwin') {
      const out = child_process.execFileSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      );
      return out.trim() || undefined;
    }

    if (process.platform === 'win32') {
      const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
try {
    $cred = $vault.Retrieve('${KEYCHAIN_SERVICE}', '${KEYCHAIN_ACCOUNT}')
    $cred.RetrievePassword()
    Write-Output $cred.Password
} catch {
    exit 1
}
`;
      const out = child_process.execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 4000 }
      );
      return out.trim() || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Writes the raw credential (e.g. "go-keyring-base64:...") into the OS Keychain
 * under service="gemini", username="antigravity".
 */
export function writeKeychainToken(rawSecret: string): boolean {
  if (!rawSecret || !rawSecret.trim()) return false;
  const secret = rawSecret.trim();

  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    inMemoryTestKeychain = secret;
    return true;
  }

  try {
    if (process.platform === 'linux') {
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
      child_process.execFileSync('python3', ['-c', pyScript], {
        input: secret,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 3000,
      });
      return true;
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
      child_process.execFileSync(
        'cmdkey',
        [`/generic:${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`, `/user:${KEYCHAIN_ACCOUNT}`, `/pass:${secret}`],
        { stdio: 'ignore', windowsHide: true, timeout: 3000 }
      );
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Deletes the active credential from the OS Keychain (service: gemini, username: antigravity).
 */
export function clearKeychainToken(): boolean {
  if (process.env.VITEST && !process.env.SWITCHYARD_LIVE_KEYCHAIN) {
    inMemoryTestKeychain = undefined;
    return true;
  }

  try {
    if (process.platform === 'linux') {
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
        child_process.execFileSync('python3', ['-c', pyScript], { stdio: 'ignore', timeout: 3000 });
        return true;
      }
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
      child_process.execFileSync(
        'cmdkey',
        [`/delete:${KEYCHAIN_SERVICE}:${KEYCHAIN_ACCOUNT}`],
        { stdio: 'ignore', windowsHide: true, timeout: 3000 }
      );
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
