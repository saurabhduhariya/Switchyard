import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isWsl,
  toWindowsPath,
  getWslWindowsUserHomes,
  __resetWslCacheForTest,
  resolveActiveWslDistro,
  extractWslDistroFromRemoteAuthority,
  getWslDistrosOnWindows,
  resolveWslDistroLinuxHome,
  getWslLinuxUserHomesOnWindows,
  resolveWslContextFromWorkspace,
} from '../../src/platform/wsl';
import { isAntigravity26OrNewer, killAgyHubDaemon } from '../../src/platform/agyDaemon';
import {
  clearKeychainToken,
  getStandaloneTokenPaths,
  readKeychainToken,
  writeKeychainToken,
} from '../../src/platform/keychain';
import { runHelper } from '../../src/switch/helper/switch-helper';
import { KEYS } from '../../src/constants';
import { writeSyntheticDb } from '../fixtures/makeDb';
import { getWorkspaceRelaunchArgs } from '../../src/platform/ide';
import { getUserDataDirs } from '../../src/platform/paths';
import { spawnIsolatedWindow } from '../../src/platform/launch';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    rmSync: vi.fn(actual.rmSync),
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
    execFile: vi.fn(actual.execFile),
    execSync: vi.fn(actual.execSync),
  };
});

describe('WSL2 Platform Interoperability', () => {
  const origEnv = { ...process.env };
  const origPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
    __resetWslCacheForTest();
    process.env = { ...origEnv, SWITCHYARD_TEST_WSL: '1' };
    delete process.env.SWITCHYARD_WSL_DISTRO;
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSL_INTEROP;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    __resetWslCacheForTest();
  });

  describe('isWsl()', () => {
    it('returns false when process.platform is not linux', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(isWsl()).toBe(false);

      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      __resetWslCacheForTest();
      expect(isWsl()).toBe(false);

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('returns true when WSL_DISTRO_NAME environment variable is present', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu-22.04';
      expect(isWsl()).toBe(true);
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('returns true when /proc/sys/fs/binfmt_misc/WSLInterop exists', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSL_INTEROP;

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/proc/sys/fs/binfmt_misc/WSLInterop';
      });

      expect(isWsl()).toBe(true);
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('returns true when /proc/version contains microsoft or wsl', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSL_INTEROP;

      vi.mocked(fs.existsSync).mockImplementation((p) => p === '/proc/version');
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === '/proc/version') {
          return 'Linux version 5.15.153.1-microsoft-standard-WSL2 (oe-user@oe-host) ...';
        }
        return '';
      });

      expect(isWsl()).toBe(true);
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('returns false on standard native Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSL_INTEROP;

      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(isWsl()).toBe(false);
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });
  });

  describe('toWindowsPath()', () => {
    it('returns original path when not in WSL', () => {
      delete process.env.SWITCHYARD_TEST_WSL;
      expect(toWindowsPath('/home/user/workspace')).toBe('/home/user/workspace');
    });

    it('converts path via regex fallback for /mnt/<drive>/...', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(child_process.execFileSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      const converted = toWindowsPath('/mnt/c/Users/Saurabh/AppData/Roaming');
      expect(converted).toBe('C:\\Users\\Saurabh\\AppData\\Roaming');

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('converts path via wslpath when available', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'wslpath' && Array.isArray(args) && args[0] === '-w') {
          return '\\\\wsl.localhost\\Ubuntu\\home\\user\\data\n' as unknown as Buffer;
        }
        throw new Error('unexpected call');
      });

      const converted = toWindowsPath('/home/user/data');
      expect(converted).toBe('\\\\wsl.localhost\\Ubuntu\\home\\user\\data');

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });
  });

  describe('getWslWindowsUserHomes()', () => {
    it('returns empty array when not in WSL', () => {
      delete process.env.SWITCHYARD_TEST_WSL;
      expect(getWslWindowsUserHomes()).toEqual([]);
    });

    it('discovers user profile from cmd.exe USERPROFILE and caches it', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(fs.existsSync).mockImplementation((p) => p === '/mnt/c/Users/Saurabh');
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'cmd.exe') {
          return 'C:\\Users\\Saurabh\r\n' as unknown as Buffer;
        }
        if (cmd === 'wslpath' && Array.isArray(args) && args[0] === '-u') {
          return '/mnt/c/Users/Saurabh\n' as unknown as Buffer;
        }
        throw new Error('unexpected call');
      });

      const homes = getWslWindowsUserHomes();
      expect(homes).toEqual(['/mnt/c/Users/Saurabh']);

      // Call again to verify cache hit
      const homesCached = getWslWindowsUserHomes();
      expect(homesCached).toEqual(['/mnt/c/Users/Saurabh']);

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('falls back to scanning /mnt/c/Users directory', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(child_process.execFileSync).mockImplementation(() => {
        throw new Error('cmd.exe failed');
      });

      vi.mocked(fs.existsSync).mockImplementation((p) => p === '/mnt/c/Users');
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p === '/mnt/c/Users') {
          return [
            { name: 'Public', isDirectory: () => true },
            { name: 'Default', isDirectory: () => true },
            { name: 'Saurabh', isDirectory: () => true },
            { name: 'desktop.ini', isDirectory: () => false },
          ] as unknown as fs.Dirent[];
        }
        return [];
      });

      const homes = getWslWindowsUserHomes();
      expect(homes).toEqual(['/mnt/c/Users/Saurabh']);

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });
  });

  describe('Integration with paths.ts and launch.ts in WSL', () => {
    it('getUserDataDirs includes Windows host AppData roaming paths in WSL', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(child_process.execFileSync).mockImplementation((cmd) => {
        if (cmd === 'cmd.exe') return 'C:\\Users\\Saurabh\n' as unknown as Buffer;
        if (cmd === 'wslpath') return '/mnt/c/Users/Saurabh\n' as unknown as Buffer;
        throw new Error('not handled');
      });

      const dirs = getUserDataDirs('linux', process.env, '/home/user');
      expect(dirs).toContain('/mnt/c/Users/Saurabh/AppData/Roaming/Antigravity IDE');
      expect(dirs).toContain('/mnt/c/Users/Saurabh/AppData/Roaming/Antigravity');

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('spawnIsolatedWindow translates paths to Windows when exe is a Windows .exe from WSL', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'wslpath' && Array.isArray(args) && args[0] === '-w') {
          const linuxP = args[1] as string;
          return linuxP.replace('/mnt/c/', 'C:\\').replace(/\//g, '\\') as unknown as Buffer;
        }
        throw new Error('command not found');
      });

      let capturedArgs: string[] = [];
      const dummySpawner = vi.fn((_cmd, args) => {
        capturedArgs = args;
        return {
          pid: 9999,
          unref: vi.fn(),
        } as unknown as child_process.ChildProcess;
      });

      spawnIsolatedWindow({
        exe: '/mnt/c/Program Files/Antigravity/Antigravity.exe',
        userDataDir: '/mnt/c/Users/Saurabh/AppData/Local/Temp/capture-123',
        folders: ['/mnt/c/Projects/MyApp'],
        spawner: dummySpawner,
      });

      expect(dummySpawner).toHaveBeenCalled();
      const idx = capturedArgs.indexOf('--user-data-dir');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(capturedArgs[idx + 1]).toBe('C:\\Users\\Saurabh\\AppData\\Local\\Temp\\capture-123');

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });
  });

  describe('AuthDetector with undefined dbPath', () => {
    it('initializes and does not throw when dbPath is undefined', async () => {
      const { AuthDetector } = await import('../../src/accounts/AuthDetector');
      const detector = new AuthDetector(undefined);
      expect(detector.databasePath).toBeUndefined();

      const result = await detector.detectActive();
      expect(result).toHaveProperty('unsupported', true);
    });
  });

  describe('resolveActiveWslDistro()', () => {
    it('returns undefined during normal vitest runs', () => {
      delete process.env.SWITCHYARD_TEST_WSL;
      expect(resolveActiveWslDistro()).toBeUndefined();
    });

    it('returns WSL_DISTRO_NAME when SWITCHYARD_TEST_WSL is set', () => {
      const origFlag = process.env.SWITCHYARD_TEST_WSL;
      const origDistro = process.env.WSL_DISTRO_NAME;
      process.env.SWITCHYARD_TEST_WSL = '1';
      process.env.WSL_DISTRO_NAME = 'Ubuntu-24.04';

      
      expect(resolveActiveWslDistro()).toBe('Ubuntu-24.04');

      if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
      else delete process.env.SWITCHYARD_TEST_WSL;
      if (origDistro !== undefined) process.env.WSL_DISTRO_NAME = origDistro;
      else delete process.env.WSL_DISTRO_NAME;
    });
  });

  describe('isAntigravity26OrNewer()', () => {
    it('returns true when bundled agy extension exists under appRoot', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('extensions') && String(p).includes('agy'));
      expect(isAntigravity26OrNewer('/mock/app/root')).toBe(true);
    });
  });

  describe('getWorkspaceRelaunchArgs()', () => {
    it('preserves vscode-remote:// folder URIs and sets --remote authority', () => {
      
      const args = getWorkspaceRelaunchArgs({
        workspaceFolders: [
          {
            uri: {
              scheme: 'vscode-remote',
              authority: 'wsl%2BUbuntu-24.04',
              path: '/home/user/project',
              fsPath: '/home/user/project',
            },
          },
        ],
      });

      expect(args).toContain('--remote');
      expect(args).toContain('wsl+Ubuntu-24.04');
      expect(args).toContain('--folder-uri');
      expect(args).toContain('vscode-remote://wsl+Ubuntu-24.04/home/user/project');
    });

    it('passes overrideFolders verbatim with --folder-uri if already a URI', () => {
      
      const args = getWorkspaceRelaunchArgs({
        overrideFolders: ['vscode-remote://wsl+Ubuntu-24.04/home/user/test'],
      });

      expect(args).toEqual(['--folder-uri', 'vscode-remote://wsl+Ubuntu-24.04/home/user/test']);
    });

    it('preserves WSL remote context for /mnt/c/... workspace folders and workspaceFile', () => {
      const origFlag = process.env.SWITCHYARD_TEST_WSL;
      const origDistro = process.env.WSL_DISTRO_NAME;
      process.env.SWITCHYARD_TEST_WSL = '1';
      process.env.WSL_DISTRO_NAME = 'Ubuntu-24.04';
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === '/proc/version');
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/proc/version') return 'Linux version 6.6.0-microsoft-standard-WSL2';
        return '';
      });

      try {
        const folderArgs = getWorkspaceRelaunchArgs({
          remoteName: 'wsl',
          workspaceFolders: [
            {
              uri: {
                scheme: 'file',
                fsPath: '/mnt/c/Users/Hp/OneDrive/Documents/Switchyard/Switchyard',
              },
            },
          ],
        });
        expect(folderArgs).toEqual([
          '--remote',
          'wsl+Ubuntu-24.04',
          '--folder-uri',
          'vscode-remote://wsl+Ubuntu-24.04/mnt/c/Users/Hp/OneDrive/Documents/Switchyard/Switchyard',
        ]);

        const fileArgs = getWorkspaceRelaunchArgs({
          remoteName: 'wsl',
          workspaceFile: {
            scheme: 'file',
            fsPath: '/mnt/c/Users/Hp/my workspace/app.code-workspace',
          },
        });
        expect(fileArgs).toEqual([
          '--remote',
          'wsl+Ubuntu-24.04',
          '--file-uri',
          'vscode-remote://wsl+Ubuntu-24.04/mnt/c/Users/Hp/my%20workspace/app.code-workspace',
        ]);

        const overrideArgs = getWorkspaceRelaunchArgs({
          remoteName: 'wsl',
          overrideFolders: ['/mnt/c/work/repo'],
        });
        expect(overrideArgs).toEqual([
          '--remote',
          'wsl+Ubuntu-24.04',
          '--folder-uri',
          'vscode-remote://wsl+Ubuntu-24.04/mnt/c/work/repo',
        ]);
      } finally {
        if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
        else delete process.env.SWITCHYARD_TEST_WSL;
        if (origDistro !== undefined) process.env.WSL_DISTRO_NAME = origDistro;
        else delete process.env.WSL_DISTRO_NAME;
      }
    });

    it('getSharedExtensionsDir prefers Windows extensions dir over WSL server dir when running in WSL', async () => {
      const origFlag = process.env.SWITCHYARD_TEST_WSL;
      const origDistro = process.env.WSL_DISTRO_NAME;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.SWITCHYARD_TEST_WSL = '1';
      process.env.WSL_DISTRO_NAME = 'Ubuntu-24.04';
      __resetWslCacheForTest();

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-wsl-ext-'));
      const winHome = path.join(tmpRoot, 'winhome');
      const winExtDir = path.join(winHome, '.antigravity-ide', 'extensions');
      const winSwitchyardExt = path.join(winExtDir, 'saurabhduhariya.ag-switchyard-0.3.0-universal');
      const serverExtDir = path.join(tmpRoot, 'wslhome', '.antigravity-ide-server', 'extensions');
      const serverSwitchyardExt = path.join(serverExtDir, 'saurabhduhariya.ag-switchyard-0.3.0-universal');
      fs.mkdirSync(winSwitchyardExt, { recursive: true });
      fs.mkdirSync(serverSwitchyardExt, { recursive: true });

      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      vi.mocked(fs.existsSync).mockImplementation(realFs.existsSync);
      vi.mocked(fs.readdirSync).mockImplementation(realFs.readdirSync);

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'cmd.exe' && Array.isArray(args) && args.includes('echo %USERPROFILE%')) {
          return 'C:\\Users\\TestWin' as unknown as Buffer;
        }
        if (cmd === 'wslpath' && Array.isArray(args) && args[0] === '-u') {
          return winHome as unknown as Buffer;
        }
        throw new Error('unexpected command');
      });

      try {
        const { getSharedExtensionsDir } = await import('../../src/platform/ide');
        const resolved = getSharedExtensionsDir({ fsPath: serverSwitchyardExt });
        expect(resolved).toBe(winExtDir);
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
        else delete process.env.SWITCHYARD_TEST_WSL;
        if (origDistro !== undefined) process.env.WSL_DISTRO_NAME = origDistro;
        else delete process.env.WSL_DISTRO_NAME;
        __resetWslCacheForTest();
      }
    });

    it('findCaptureMainPids and requestGracefulClose use Windows tooling when running in WSL', async () => {
      const origFlag = process.env.SWITCHYARD_TEST_WSL;
      const origDistro = process.env.WSL_DISTRO_NAME;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.SWITCHYARD_TEST_WSL = '1';
      process.env.WSL_DISTRO_NAME = 'Ubuntu-24.04';
      __resetWslCacheForTest();

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'wslpath' && Array.isArray(args) && args[0] === '-w') {
          return 'C:\\Users\\Hp\\AppData\\Roaming\\Antigravity IDE\\User\\switchyard-capture\\cap-1' as unknown as Buffer;
        }
        throw new Error('unexpected command');
      });

      const calls: Array<{ cmd: string; args: string[] }> = [];
      vi.mocked(child_process.execFile).mockImplementation(((cmd: string, args: string[], _opts: any, cb?: any) => {
        calls.push({ cmd, args });
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (cmd.startsWith('powershell')) {
          callback?.(null, '8812\r\n', '');
        } else {
          callback?.(null, '', '');
        }
        return {} as child_process.ChildProcess;
      }) as any);

      try {
        const { findCaptureMainPids, requestGracefulClose } = await import('../../src/capture/processes');
        const pids = await findCaptureMainPids('/mnt/c/Users/Hp/AppData/Roaming/Antigravity IDE/User/switchyard-capture/cap-1');
        expect(pids).toEqual([8812]);
        expect(calls[0]?.cmd).toBe('powershell.exe');
        expect(calls[0]?.args.join(' ')).toContain('c:/users/hp/appdata/roaming/antigravity ide/user/switchyard-capture/cap-1');

        requestGracefulClose(8812);
        expect(calls[1]?.cmd).toBe('taskkill.exe');
        expect(calls[1]?.args).toEqual(['/PID', '8812', '/T']);
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
        else delete process.env.SWITCHYARD_TEST_WSL;
        if (origDistro !== undefined) process.env.WSL_DISTRO_NAME = origDistro;
        else delete process.env.WSL_DISTRO_NAME;
        __resetWslCacheForTest();
      }
    });
  });

  describe('Windows UI host -> WSL2 remote sync', () => {
    afterEach(async () => {
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const realOs = await vi.importActual<typeof import('node:os')>('node:os');
      const realCp = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      vi.mocked(fs.existsSync).mockImplementation(realFs.existsSync);
      vi.mocked(fs.readFileSync).mockImplementation(realFs.readFileSync);
      vi.mocked(fs.readdirSync).mockImplementation(realFs.readdirSync);
      vi.mocked(fs.writeFileSync).mockImplementation(realFs.writeFileSync);
      vi.mocked(fs.mkdirSync).mockImplementation(realFs.mkdirSync);
      vi.mocked(fs.rmSync).mockImplementation(realFs.rmSync);
      vi.mocked(os.homedir).mockImplementation(realOs.homedir);
      vi.mocked(child_process.execFileSync).mockImplementation(realCp.execFileSync);
      vi.mocked(child_process.execFile).mockImplementation(realCp.execFile);
      vi.mocked(child_process.execSync).mockImplementation(realCp.execSync);
    });

    it('extracts WSL distro names from encoded and plain remote authorities and workspace metadata', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        expect(extractWslDistroFromRemoteAuthority('wsl+Ubuntu-24.04')).toBe('Ubuntu-24.04');
        expect(extractWslDistroFromRemoteAuthority('wsl%2BUbuntu-24.04')).toBe('Ubuntu-24.04');
        expect(extractWslDistroFromRemoteAuthority('ssh-remote+box')).toBeUndefined();
        expect(extractWslDistroFromRemoteAuthority(undefined)).toBeUndefined();

        expect(
          resolveWslContextFromWorkspace({
            remoteName: 'wsl',
            workspaceFolders: [{ uri: { authority: 'wsl%2BUbuntu-24.04' } }],
          })
        ).toEqual({ isWslRemote: true, wslDistro: 'Ubuntu-24.04' });

        expect(
          resolveWslContextFromWorkspace({
            remoteName: undefined,
            workspaceFolders: [{ uri: { authority: '' } }],
          })
        ).toEqual({ isWslRemote: false, wslDistro: undefined });
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('enumerates Windows WSL distros from UTF-16LE output and resolves UNC Linux homes', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      __resetWslCacheForTest();

      const utf16List = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('docker-desktop\r\nUbuntu-24.04\r\ndocker-desktop-data\r\n', 'utf16le'),
      ]);

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        if (cmd === 'wsl.exe' && Array.isArray(args) && args.includes('-l')) {
          return utf16List as unknown as Buffer;
        }
        if (
          cmd === 'wsl.exe' &&
          Array.isArray(args) &&
          args[0] === '-d' &&
          args[1] === 'Ubuntu-24.04'
        ) {
          return Buffer.from('/home/ubuntu', 'utf8') as unknown as Buffer;
        }
        throw new Error(`unexpected command: ${String(cmd)} ${JSON.stringify(args)}`);
      });

      try {
        expect(getWslDistrosOnWindows({ runningOnly: true })).toEqual(['Ubuntu-24.04']);
        expect(
          getWslDistrosOnWindows({ runningOnly: true, targetDistro: 'ubuntu-24.04' })
        ).toEqual(['ubuntu-24.04']);
        expect(resolveWslDistroLinuxHome('Ubuntu-24.04')).toEqual({
          distro: 'Ubuntu-24.04',
          linuxHome: '/home/ubuntu',
          uncHome: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu',
        });
        expect(getWslLinuxUserHomesOnWindows({ runningOnly: true })).toEqual([
          {
            distro: 'Ubuntu-24.04',
            linuxHome: '/home/ubuntu',
            uncHome: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu',
          },
        ]);
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('isolates CaptureManager default keychain/daemon calls from WSL while includeWsl syncs both', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.SWITCHYARD_LIVE_KEYCHAIN = '1';
      process.env.SWITCHYARD_LIVE_DAEMON = '1';
      const fakeWinHome = 'C:\\Users\\TestWin';
      vi.mocked(os.homedir).mockReturnValue(fakeWinHome);
      process.env.GEMINI_CLI_HOME = `${fakeWinHome}\\.gemini`;
      __resetWslCacheForTest();

      const writtenFiles = new Map<string, string>();
      const removedFiles: string[] = [];
      const wslExecCalls: string[][] = [];
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        if (writtenFiles.has(s)) return true;
        return s.endsWith('\\.gemini') || s.endsWith('\\.gemini\\antigravity\\daemon');
      });
      vi.mocked(fs.readFileSync).mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (writtenFiles.has(s)) return writtenFiles.get(s)!;
        if (s.endsWith('hub_42975.json')) return '{"pid":1705}';
        return '';
      }) as typeof fs.readFileSync);
      vi.mocked(fs.readdirSync).mockImplementation(((p: fs.PathLike) => {
        if (String(p) === '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\antigravity\\daemon') {
          return ['hub_42975.json'] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as typeof fs.readdirSync);
      vi.mocked(fs.writeFileSync).mockImplementation((p, data) => {
        writtenFiles.set(String(p), String(data));
      });
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      vi.mocked(fs.rmSync).mockImplementation((p) => {
        removedFiles.push(String(p));
        writtenFiles.delete(String(p));
      });

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        const argList = Array.isArray(args) ? args.map(String) : [];
        if (cmd === 'wsl.exe') {
          wslExecCalls.push(argList);
          if (argList.includes('-l')) return 'Ubuntu-24.04\r\n' as unknown as Buffer;
          if (argList.includes('printf %s "$HOME"')) return '/home/ubuntu' as unknown as Buffer;
          return '' as unknown as Buffer;
        }
        return '' as unknown as Buffer;
      });

      try {
        const winOnlyPaths = getStandaloneTokenPaths();
        expect(winOnlyPaths.some((p) => p.includes('wsl.localhost'))).toBe(false);

        const withWslPaths = getStandaloneTokenPaths({ includeWsl: true, wslDistro: 'Ubuntu-24.04' });
        expect(withWslPaths).toContain(
          '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token'
        );

        // Default CaptureManager-style calls must NOT touch WSL token or WSL daemon
        writeKeychainToken('{"id_token_email":"win@example.com","token":{"access_token":"w1"}}', 'win@example.com');
        expect(
          writtenFiles.has(
            '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token'
          )
        ).toBe(false);
        killAgyHubDaemon();
        expect(wslExecCalls.some((a) => a.some((s) => s.includes('pkill')))).toBe(false);

        // Switch-style includeWsl writes WSL standalone token and kills WSL agy --hub
        const payload = JSON.stringify({
          id_token_email: 'target@example.com',
          token: { access_token: 't1', refresh_token: 'r1' },
        });
        writeKeychainToken(payload, 'target@example.com', { includeWsl: true, wslDistro: 'Ubuntu-24.04' });
        expect(
          writtenFiles.get(
            '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token'
          )
        ).toContain('target@example.com');

        killAgyHubDaemon({ includeWsl: true, wslDistro: 'Ubuntu-24.04' });
        expect(
          removedFiles.some((p) =>
            p.endsWith('\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\antigravity\\daemon\\hub_42975.json') ||
            p === '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\antigravity\\daemon\\hub_42975.json'
          )
        ).toBe(true);
        expect(
          wslExecCalls.some((a) => a.some((s) => s.includes('pkill -9 -f')))
        ).toBe(true);

        // preferWsl reads WSL standalone token directly instead of Windows CredMan
        expect(
          readKeychainToken({ includeWsl: true, preferWsl: true, wslDistro: 'Ubuntu-24.04' })
        ).toContain('target@example.com');

        clearKeychainToken({ includeWsl: true, wslDistro: 'Ubuntu-24.04' });
        expect(
          removedFiles.includes(
            '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token'
          )
        ).toBe(true);
      } finally {
        killSpy.mockRestore();
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('AuthDetector prefers WSL standalone token on Windows WSL Remote and detects WSL sign-out', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.SWITCHYARD_LIVE_KEYCHAIN = '1';
      __resetWslCacheForTest();

      const wslTokenPath =
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token';
      let hasWslToken = true;
      const wslPayload = JSON.stringify({
        id_token_email: 'wsl-settings@example.com',
        token: { access_token: 'wsl-acc', refresh_token: 'wsl-ref' },
      });

      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-wsl-auth-'));
      const fakeWinHome = path.join(tmpRoot, 'winhome');
      realFs.mkdirSync(fakeWinHome, { recursive: true });
      vi.mocked(os.homedir).mockReturnValue(fakeWinHome);
      process.env.GEMINI_CLI_HOME = path.join(fakeWinHome, '.gemini');
      const dbPath = path.join(tmpRoot, 'state.vscdb');
      await writeSyntheticDb(dbPath, {});

      const isAllowedTestPath = (target: string): boolean =>
        target.startsWith(tmpRoot) || target.startsWith(path.join(os.tmpdir(), 'switchyard-'));

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        if (s === wslTokenPath) return hasWslToken;
        if (!isAllowedTestPath(s)) return false;
        return realFs.existsSync(p);
      });
      vi.mocked(fs.readFileSync).mockImplementation(((p: fs.PathOrFileDescriptor, opts?: any) => {
        const s = String(p);
        if (s === wslTokenPath) return wslPayload;
        if (!isAllowedTestPath(s) && !s.includes('sql.js')) {
          throw new Error(`Unexpected test read outside tmpRoot: ${s}`);
        }
        return realFs.readFileSync(p, opts);
      }) as typeof fs.readFileSync);

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        const argList = Array.isArray(args) ? args.map(String) : [];
        if (cmd === 'wsl.exe') {
          if (argList.includes('-l')) return 'Ubuntu-24.04\r\n' as unknown as Buffer;
          if (argList.includes('printf %s "$HOME"')) return '/home/ubuntu' as unknown as Buffer;
        }
        if (cmd === 'powershell.exe') {
          // Simulate stale Windows CredMan holding a different user
          return JSON.stringify({
            id_token_email: 'stale-windows@example.com',
            token: { access_token: 'win-acc', refresh_token: 'win-ref' },
          }) as unknown as Buffer;
        }
        return '' as unknown as Buffer;
      });

      try {
        const { AuthDetector } = await import('../../src/accounts/AuthDetector');
        const detector = new AuthDetector(dbPath, {
          isWslRemote: true,
          wslDistro: 'Ubuntu-24.04',
        });

        const detected = await detector.detectActive();
        expect('identity' in detected).toBe(true);
        if ('identity' in detected) {
          expect(detected.identity.email).toBe('wsl-settings@example.com');
        }

        // If WSL standalone token is removed (signed out in WSL), do not fall back to stale Windows CredMan
        hasWslToken = false;
        const signedOut = await detector.detectActive();
        expect('unsupported' in signedOut).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        realFs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('switch-helper syncs WSL standalone token and kills WSL daemon when job.includeWsl is true', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.SWITCHYARD_LIVE_KEYCHAIN = '1';
      process.env.SWITCHYARD_LIVE_DAEMON = '1';
      __resetWslCacheForTest();

      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-wsl-helper-'));
      const fakeWinHome = path.join(tmpRoot, 'winhome');
      realFs.mkdirSync(fakeWinHome, { recursive: true });
      vi.mocked(os.homedir).mockReturnValue(fakeWinHome);
      process.env.GEMINI_CLI_HOME = path.join(fakeWinHome, '.gemini');
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

      const dbPath = path.join(tmpRoot, 'state.vscdb');
      const backupDir = path.join(tmpRoot, 'backups');
      realFs.mkdirSync(backupDir, { recursive: true });
      await writeSyntheticDb(dbPath, {});

      const wslTokenPath =
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.gemini\\jetski-standalone-oauth-token';
      const targetToken = JSON.stringify({
        id_token_email: 'switched@example.com',
        token: { access_token: 'sw-acc', refresh_token: 'sw-ref' },
      });
      const virtualWslFiles = new Map<string, string>();
      const wslCliCommands: string[][] = [];

      const isAllowedHelperPath = (target: string): boolean =>
        target.startsWith(tmpRoot) || target.startsWith(path.join(os.tmpdir(), 'switchyard-'));

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        if (s.startsWith('\\\\wsl.localhost\\')) {
          return virtualWslFiles.has(s) || s.endsWith('\\.gemini');
        }
        if (!isAllowedHelperPath(s)) return false;
        return realFs.existsSync(p);
      });
      vi.mocked(fs.readFileSync).mockImplementation(((p: fs.PathOrFileDescriptor, opts?: any) => {
        const s = String(p);
        if (virtualWslFiles.has(s)) return virtualWslFiles.get(s)!;
        if (!isAllowedHelperPath(s) && !s.includes('sql.js')) {
          throw new Error(`Unexpected test read outside tmpRoot: ${s}`);
        }
        return realFs.readFileSync(p, opts);
      }) as typeof fs.readFileSync);
      vi.mocked(fs.readdirSync).mockImplementation(((p: fs.PathLike, opts?: any) => {
        const s = String(p);
        if (s.startsWith('\\\\wsl.localhost\\') || !isAllowedHelperPath(s)) {
          return [] as unknown as fs.Dirent[];
        }
        return realFs.readdirSync(p, opts);
      }) as typeof fs.readdirSync);
      vi.mocked(fs.writeFileSync).mockImplementation((p, data, opts) => {
        const s = String(p);
        if (s.startsWith('\\\\wsl.localhost\\')) {
          virtualWslFiles.set(s, String(data));
          return;
        }
        if (!isAllowedHelperPath(s)) {
          throw new Error(`Unexpected test write outside tmpRoot: ${s}`);
        }
        realFs.writeFileSync(p, data as any, opts);
      });
      vi.mocked(fs.mkdirSync).mockImplementation(((p: fs.PathLike, opts?: any) => {
        const s = String(p);
        if (s.startsWith('\\\\wsl.localhost\\')) return undefined;
        if (!isAllowedHelperPath(s)) {
          throw new Error(`Unexpected test mkdir outside tmpRoot: ${s}`);
        }
        return realFs.mkdirSync(p, opts);
      }) as typeof fs.mkdirSync);
      vi.mocked(fs.rmSync).mockImplementation((p, opts) => {
        const s = String(p);
        if (s.startsWith('\\\\wsl.localhost\\')) {
          virtualWslFiles.delete(s);
          return;
        }
        if (!isAllowedHelperPath(s)) {
          throw new Error(`Unexpected test rm outside tmpRoot: ${s}`);
        }
        realFs.rmSync(p, opts);
      });

      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args) => {
        const argList = Array.isArray(args) ? args.map(String) : [];
        if (cmd === 'wsl.exe') {
          wslCliCommands.push(argList);
          if (argList.includes('-l')) return 'Ubuntu-24.04\r\n' as unknown as Buffer;
          if (argList.includes('printf %s "$HOME"')) return '/home/ubuntu' as unknown as Buffer;
          return '' as unknown as Buffer;
        }
        if (cmd === 'powershell.exe') {
          if (argList.join(' ').includes('CredRead')) {
            return targetToken as unknown as Buffer;
          }
          return '' as unknown as Buffer;
        }
        return '' as unknown as Buffer;
      });

      const jobPath = path.join(tmpRoot, 'job.json');
      const resultFile = path.join(tmpRoot, 'result.json');
      const logFile = path.join(tmpRoot, 'switch-helper.log');
      const { fingerprint } = await import('../../src/accounts/identity');

      realFs.writeFileSync(
        jobPath,
        JSON.stringify({
          version: 1,
          parentPid: 0,
          dbPath,
          targetEmail: 'switched@example.com',
          targetFingerprint: fingerprint(targetToken),
          keychainToken: targetToken,
          values: {},
          backupDir,
          relaunch: { exe: '', args: [] },
          resultFile,
          logFile,
          includeWsl: true,
          wslDistro: 'Ubuntu-24.04',
        })
      );

      try {
        const res = await runHelper(jobPath);
        expect(res.ok).toBe(true);
        expect(virtualWslFiles.get(wslTokenPath)).toContain('switched@example.com');
        expect(wslCliCommands.some((a) => a.some((s) => s.includes('pkill -9 -f')))).toBe(true);
        expect(realFs.readFileSync(logFile, 'utf8')).toContain('WSL standalone token synced=true');
      } finally {
        killSpy.mockRestore();
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        realFs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('never writes or deletes standalone token files on disk during VITEST when SWITCHYARD_LIVE_KEYCHAIN is unset', () => {
      delete process.env.SWITCHYARD_LIVE_KEYCHAIN;
      vi.mocked(fs.writeFileSync).mockClear();
      vi.mocked(fs.rmSync).mockClear();

      expect(writeKeychainToken('{"access_token":"in-memory-only"}', 'test@example.com')).toBe(true);
      expect(readKeychainToken()).toBe('{"access_token":"in-memory-only"}');
      expect(clearKeychainToken()).toBe(true);
      expect(readKeychainToken()).toBeUndefined();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });
});
