import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isWsl, toWindowsPath, getWslWindowsUserHomes, __resetWslCacheForTest, resolveActiveWslDistro } from '../../src/platform/wsl';
import { isAntigravity26OrNewer } from '../../src/platform/agyDaemon';
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
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
    execFile: vi.fn(actual.execFile),
  };
});

describe('WSL2 Platform Interoperability', () => {
  const origEnv = { ...process.env };
  const origPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
    __resetWslCacheForTest();
    process.env = { ...origEnv, SWITCHYARD_TEST_WSL: '1' };
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
      process.env.SWITCHYARD_TEST_WSL = '1';
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
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
        else delete process.env.SWITCHYARD_TEST_WSL;
        __resetWslCacheForTest();
      }
    });

    it('findCaptureMainPids and requestGracefulClose use Windows tooling when running in WSL', async () => {
      const origFlag = process.env.SWITCHYARD_TEST_WSL;
      process.env.SWITCHYARD_TEST_WSL = '1';
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
        if (origFlag !== undefined) process.env.SWITCHYARD_TEST_WSL = origFlag;
        else delete process.env.SWITCHYARD_TEST_WSL;
        __resetWslCacheForTest();
      }
    });
  });
});
