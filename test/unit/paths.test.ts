import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findStateDb,
  getBackupsDir,
  getGlobalStorageDir,
  getProfilesDir,
  getStateDbBackupPath,
  getUserDataDirs,
} from '../../src/platform/paths';

describe('platform/paths', () => {
  it('returns candidate user data directories for Linux', () => {
    const home = '/home/testuser';
    const dirs = getUserDataDirs('linux', { XDG_CONFIG_HOME: '/custom/config' }, home);
    expect(dirs).toEqual([
      '/custom/config/Antigravity IDE',
      '/custom/config/Antigravity',
    ]);

    const defaultDirs = getUserDataDirs('linux', {}, home);
    expect(defaultDirs).toEqual([
      '/home/testuser/.config/Antigravity IDE',
      '/home/testuser/.config/Antigravity',
    ]);
  });

  it('returns candidate user data directories for macOS (darwin)', () => {
    const home = '/Users/testuser';
    const dirs = getUserDataDirs('darwin', {}, home);
    expect(dirs).toEqual([
      path.join(home, 'Library', 'Application Support', 'Antigravity IDE'),
      path.join(home, 'Library', 'Application Support', 'Antigravity'),
    ]);
  });

  it('returns candidate user data directories for Windows (win32)', () => {
    const home = 'C:\\Users\\testuser';
    const dirs = getUserDataDirs('win32', { APPDATA: 'C:\\Users\\testuser\\AppData\\Roaming' }, home);
    expect(dirs).toEqual([
      path.join('C:\\Users\\testuser\\AppData\\Roaming', 'Antigravity IDE'),
      path.join('C:\\Users\\testuser\\AppData\\Roaming', 'Antigravity'),
    ]);
  });

  it('finds state.vscdb by deriving from extension globalStorageUri path', () => {
    const fakeGlobalStorage = '/app/User/globalStorage/saurabh.ag-switchyard';
    const fakeStateDb = path.resolve('/app/User/globalStorage/state.vscdb');

    const fakeFs = {
      existsSync: (p: string) => path.resolve(p) === fakeStateDb,
    };

    const found = findStateDb({
      globalStorageUriPath: fakeGlobalStorage,
      fsModule: fakeFs,
    });

    expect(found).toBe(fakeStateDb);
  });

  it('finds state.vscdb by searching candidate user data directories', () => {
    const candidateDirs = ['/opt/Antigravity', '/home/user/.config/Antigravity IDE'];
    const targetDb = path.resolve('/home/user/.config/Antigravity IDE/User/globalStorage/state.vscdb');

    const fakeFs = {
      existsSync: (p: string) => path.resolve(p) === targetDb,
    };

    const found = findStateDb({
      candidateDirs,
      fsModule: fakeFs,
    });

    expect(found).toBe(targetDb);
  });

  it('returns undefined when state.vscdb is not found anywhere', () => {
    const fakeFs = {
      existsSync: () => false,
    };

    const found = findStateDb({
      globalStorageUriPath: '/fake/globalStorage/ext',
      candidateDirs: ['/fake/dir'],
      fsModule: fakeFs,
    });

    expect(found).toBeUndefined();
  });

  it('computes companion and storage directory paths correctly', () => {
    const dbPath = '/home/user/.config/Antigravity/User/globalStorage/state.vscdb';
    expect(getStateDbBackupPath(dbPath)).toBe(
      '/home/user/.config/Antigravity/User/globalStorage/state.vscdb.backup'
    );
    expect(getGlobalStorageDir(dbPath)).toBe(
      '/home/user/.config/Antigravity/User/globalStorage'
    );
    expect(getProfilesDir('/home/user/.config/Antigravity/User/globalStorage')).toBe(
      '/home/user/.config/Antigravity/User/globalStorage/profiles'
    );
    expect(getBackupsDir('/home/user/.config/Antigravity/User/globalStorage')).toBe(
      '/home/user/.config/Antigravity/User/globalStorage/backups'
    );
  });
});
