import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLaunchArgs,
  findExecutable,
  getSharedExtensionsDir,
  isProcessAlive,
} from '../../src/platform/ide';

describe('platform/ide', () => {
  describe('buildLaunchArgs', () => {
    it('builds standard profile launch arguments', () => {
      const args = buildLaunchArgs({
        userDataDir: '/tmp/profile/acc-1',
        extensionsDir: '/home/user/.antigravity/extensions',
        folders: ['/workspace/project-a'],
        newWindow: true,
      });

      expect(args).toEqual([
        '--user-data-dir',
        '/tmp/profile/acc-1',
        '--extensions-dir',
        '/home/user/.antigravity/extensions',
        '--new-window',
        '/workspace/project-a',
      ]);
    });

    it('handles multiple workspace folders', () => {
      const args = buildLaunchArgs({
        userDataDir: '/tmp/profile/acc-1',
        folders: ['/workspace/p1', '/workspace/p2'],
      });

      expect(args).toContain('--user-data-dir');
      expect(args).toContain('/workspace/p1');
      expect(args).toContain('/workspace/p2');
      expect(args).toContain('--new-window');
      expect(args).not.toContain('--extensions-dir');
    });

    it('respects newWindow: false', () => {
      const args = buildLaunchArgs({
        userDataDir: '/tmp/profile/acc-1',
        newWindow: false,
      });

      expect(args).toEqual(['--user-data-dir', '/tmp/profile/acc-1']);
    });
  });

  describe('findExecutable', () => {
    it('uses valid custom executable path', () => {
      const tmpFile = path.join(os.tmpdir(), `test-antigravity-${Date.now()}`);
      fs.writeFileSync(tmpFile, '#!/bin/sh\n', { mode: 0o755 });
      try {
        const exe = findExecutable(tmpFile);
        expect(exe).toBe(tmpFile);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('throws error when custom executable path does not exist', () => {
      expect(() => findExecutable('/non/existent/antigravity-ide-binary')).toThrow(
        /Configured executable path does not exist/
      );
    });

    it('resolves an executable on the current system or falls back gracefully', () => {
      const exe = findExecutable();
      expect(typeof exe).toBe('string');
      expect(exe.length).toBeGreaterThan(0);
    });
  });

  describe('getSharedExtensionsDir', () => {
    it('derives extensions directory from extensionUri if in an extensions folder', () => {
      const fakeExtPath = '/home/user/.antigravity/extensions/saurabh.ag-switchyard-0.1.0';
      const fakeExtensionsDir = '/home/user/.antigravity/extensions';

      // Create a temporary mock directory structure
      const tmpDir = path.join(os.tmpdir(), `test-ext-${Date.now()}`);
      const mockExtensionsDir = path.join(tmpDir, 'extensions');
      const mockExtDir = path.join(mockExtensionsDir, 'saurabh.ag-switchyard-0.1.0');
      fs.mkdirSync(mockExtDir, { recursive: true });

      try {
        const resolved = getSharedExtensionsDir({ fsPath: mockExtDir });
        expect(resolved).toBe(mockExtensionsDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('handles undefined extensionUri gracefully', () => {
      const resolved = getSharedExtensionsDir(undefined);
      // May be string or undefined depending on environment
      if (resolved) {
        expect(typeof resolved).toBe('string');
      }
    });
  });

  describe('isProcessAlive', () => {
    it('returns true for current process PID', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      expect(isProcessAlive(999999999)).toBe(false);
    });

    it('returns false for invalid PID', () => {
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(NaN)).toBe(false);
    });
  });
});
