import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '../../src/constants';
import { readKeys, writeKeys } from '../../src/db/StateDb';
import { SwitchJob, SwitchResultFile } from '../../src/switch/job';
import { runHelper, waitForExit } from '../../src/switch/helper/switch-helper';

describe('switch/helper/switch-helper', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-helper-test-'));
    dbPath = path.join(tmpDir, 'state.vscdb');
    backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
  });

  describe('waitForExit', () => {
    it('resolves quickly if PID is not alive', async () => {
      // PID -1 or non-existent PID (999999999) is not alive
      await expect(
        waitForExit(999999999, { timeoutMs: 1000, pollIntervalMs: 50, settleDelayMs: 10 })
      ).resolves.toBeUndefined();
    });

    it('times out if PID remains alive', async () => {
      // process.pid is always alive
      await expect(
        waitForExit(process.pid, { timeoutMs: 200, pollIntervalMs: 50, settleDelayMs: 0 })
      ).rejects.toThrow(/Timed out waiting for IDE process/);
    });
  });

  describe('runHelper end-to-end', () => {
    it('successfully swaps tokens, verifies fingerprint, and writes resultFile', async () => {
      // 1. Seed initial database with Account A
      const initialAuth = 'initial-auth-token-a';
      await writeKeys(dbPath, {
        [KEYS.oauth]: initialAuth,
        [KEYS.userStatus]: 'status-a',
      });

      // 2. Prepare Account B target values
      const targetAuth = 'target-auth-token-b';
      const targetFingerprint = crypto
        .createHash('sha256')
        .update(targetAuth)
        .digest('hex')
        .slice(0, 12);

      const jobPath = path.join(tmpDir, 'test-job.json');
      const resultFile = path.join(tmpDir, 'test-result.json');

      const job: SwitchJob = {
        version: 1,
        parentPid: 0, // dead PID so waitForExit skips
        dbPath,
        targetEmail: 'user-b@example.com',
        targetFingerprint,
        values: {
          [KEYS.oauth]: targetAuth,
          [KEYS.userStatus]: 'status-b',
        },
        backupDir,
        relaunch: {
          exe: '', // empty so relaunch is skipped
          args: [],
        },
        resultFile,
      };

      fs.writeFileSync(jobPath, JSON.stringify(job), { mode: 0o600 });

      // 3. Run helper
      const result = await runHelper(jobPath);

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.switchedAt).toBeDefined();

      // 4. Verify job file was deleted
      expect(fs.existsSync(jobPath)).toBe(false);

      // 5. Verify result file was written
      expect(fs.existsSync(resultFile)).toBe(true);
      const writtenResult = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as SwitchResultFile;
      expect(writtenResult.ok).toBe(true);

      // 6. Verify DB now contains Account B
      const verified = await readKeys(dbPath, [KEYS.oauth, KEYS.userStatus]);
      expect(verified[KEYS.oauth]).toBe(targetAuth);
      expect(verified[KEYS.userStatus]).toBe('status-b');
    });

    it('rolls back to original DB when fingerprint verification fails', async () => {
      // 1. Seed initial database with Account A
      const initialAuth = 'initial-auth-original';
      await writeKeys(dbPath, {
        [KEYS.oauth]: initialAuth,
      });

      // 2. Prepare job with mismatching expected fingerprint
      const jobPath = path.join(tmpDir, 'mismatch-job.json');
      const resultFile = path.join(tmpDir, 'mismatch-result.json');

      const job: SwitchJob = {
        version: 1,
        parentPid: 0,
        dbPath,
        targetEmail: 'user-fail@example.com',
        targetFingerprint: 'expected-mismatch-1234',
        values: {
          [KEYS.oauth]: 'some-other-token',
        },
        backupDir,
        relaunch: { exe: '', args: [] },
        resultFile,
      };

      fs.writeFileSync(jobPath, JSON.stringify(job), { mode: 0o600 });

      // 3. Run helper
      const result = await runHelper(jobPath);

      // Should fail and report error
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Verification failed/);

      // 4. Verify DB was rolled back to original Account A
      const verified = await readKeys(dbPath, [KEYS.oauth]);
      expect(verified[KEYS.oauth]).toBe(initialAuth);

      // 5. Verify result file reflects failure
      const writtenResult = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as SwitchResultFile;
      expect(writtenResult.ok).toBe(false);
      expect(writtenResult.error).toMatch(/Verification failed/);
    });

    it('handles non-existent job file gracefully', async () => {
      const result = await runHelper('/non/existent/path/job.json');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Job file not found/);
    });
  });
});
