import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import { isWsl, toWindowsPath, getWslWindowsUserHomes, __resetWslCacheForTest } from '../../src/platform/wsl';
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

      vi.mocked(fs.existsSync).mockReturnValue(true);
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
});
