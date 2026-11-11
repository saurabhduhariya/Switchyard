import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fingerprint } from '../../accounts/identity';
import { KEYS } from '../../constants';
import { createBackup, restoreBackup } from '../../db/backup';
import { deleteKeys, readKeys, writeKeys } from '../../db/StateDb';
import { killAgyHubDaemon } from '../../platform/agyDaemon';
import { isProcessAlive } from '../../platform/ide';
import { clearKeychainToken, readKeychainToken, writeKeychainToken } from '../../platform/keychain';
import { SwitchJob, SwitchResultFile } from '../job';

export interface WaitForExitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  settleDelayMs?: number;
}

/**
 * Waits for a process PID to terminate.
 * Polls isProcessAlive every pollIntervalMs until dead.
 * No artificial settle delay - we rely on SQLite lock checking instead.
 */
export async function waitForExit(
  pid: number,
  options: WaitForExitOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const settleDelayMs = options.settleDelayMs ?? 500;

  const start = Date.now();
  while (isProcessAlive(pid)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for IDE process (PID ${pid}) to exit after ${timeoutMs}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (settleDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  }
}

const MAX_LOG_BYTES = 512 * 1024;

function appendHelperLog(logFile: string | undefined, level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  if (!logFile) return;
  try {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      const st = fs.statSync(logFile);
      if (st.size > MAX_LOG_BYTES) {
        fs.truncateSync(logFile, 0);
      }
    } catch {
      // file does not exist yet
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${message}\n`, {
      mode: 0o600,
    });
  } catch {
    // Best-effort logging must never break token swapping
  }
}

/**
 * Runs the detached token-swap helper process.
 */
export async function runHelper(jobPathArg?: string): Promise<SwitchResultFile> {
  const jobPath = jobPathArg || process.argv[2];
  if (!jobPath || !fs.existsSync(jobPath)) {
    const err = `Switchyard Helper: Job file not found: ${jobPath}`;
    console.error(err);
    return { ok: false, error: err };
  }

  let job: SwitchJob;
  try {
    const raw = fs.readFileSync(jobPath, 'utf8');
    job = JSON.parse(raw) as SwitchJob;
  } catch (err: unknown) {
    const msg = `Switchyard Helper: Failed to parse job file: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    return { ok: false, error: msg };
  }

  const log = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => {
    appendHelperLog(job.logFile, level, message);
    if (level === 'ERROR') {
      console.error(message);
    } else if (level === 'WARN') {
      console.warn(message);
    }
  };

  log(
    'INFO',
    `Helper started (pid=${process.pid}, parentPid=${job.parentPid}, target=${job.targetEmail || '<sign-out>'}, dbPath=${job.dbPath}, resultFile=${job.resultFile})`
  );

  const result: SwitchResultFile = { ok: false };
  let backupInfo: Awaited<ReturnType<typeof createBackup>> | undefined;
  const previousKeychainToken = readKeychainToken();

  try {
    // 1. Wait for parent IDE process to terminate + settle
    if (job.parentPid && job.parentPid > 0) {
      await waitForExit(job.parentPid, { settleDelayMs: 400 });
      log('INFO', `Parent IDE process ${job.parentPid} exited`);
    }

    // 2. Kill the detached agy --hub daemon so it doesn't keep the old account in memory
    killAgyHubDaemon();
    log('INFO', 'Cleared agy hub daemon/cache');

    // 3. Create full backup of state.vscdb if present
    if (job.dbPath && fs.existsSync(job.dbPath)) {
      backupInfo = await createBackup(job.dbPath, job.backupDir);
      log('INFO', `Created backup ${backupInfo.id}`);
    }

    // 4. v2.6.0+ OS Keychain swap or clear
    if (job.clearKeychain || !job.keychainToken) {
      const cleared = clearKeychainToken();
      log('INFO', `Cleared OS keychain token (ok=${cleared})`);
    } else if (job.keychainToken) {
      const wrote = writeKeychainToken(job.keychainToken, job.targetEmail);
      log('INFO', `Wrote OS keychain token (ok=${wrote})`);
      if (!wrote) {
        throw new Error(
          'Failed to write OAuth token to OS Keychain (service: gemini, username: antigravity).'
        );
      }

      // Kill agy hub again after writing the new keychain token so it cannot overwrite or cache old state.
      killAgyHubDaemon();
      const readBack = readKeychainToken() || '';
      const computedFp = fingerprint(readBack);
      const hasDbAuthToWrite = Boolean(
        job.values[KEYS.oauth] || job.values[KEYS.legacyInit] || job.values[KEYS.userStatus]
      );
      log('INFO', `Verified keychain fingerprint=${computedFp} (expected=${job.targetFingerprint || 'none'})`);
      if (job.targetFingerprint && !hasDbAuthToWrite && computedFp !== job.targetFingerprint) {
        throw new Error(
          `Keychain verification failed: written fingerprint (${computedFp}) !== expected (${job.targetFingerprint})`
        );
      }
    }

    // 5. Also write/delete any state.vscdb keys (for v2.5.5 compatibility or profileUrl)
    const dbValues = { ...job.values };
    delete dbValues[KEYS.keychainToken];
    delete dbValues[KEYS.agyUserStatus];

    if (job.dbPath && fs.existsSync(job.dbPath)) {
      // 5a. Update official Antigravity extension memento (google.google-antigravity)
      try {
        const existingAntigravity = await readKeys(job.dbPath, ['google.google-antigravity']);
        if (existingAntigravity['google.google-antigravity']) {
          const parsed = JSON.parse(existingAntigravity['google.google-antigravity']) as Record<string, any>;
          if (parsed && typeof parsed === 'object') {
            if (!parsed['antigravity-storage'] || typeof parsed['antigravity-storage'] !== 'object') {
              parsed['antigravity-storage'] = {};
            }
            if (job.clearKeychain) {
              delete parsed['antigravity-storage']['agy.onboarding.lastLoginUsername'];
              delete parsed['antigravity-storage']['jetski.onboarding.lastLoginUsername'];
            } else if (job.targetEmail) {
              parsed['antigravity-storage']['agy.onboarding.lastLoginUsername'] = job.targetEmail;
              parsed['antigravity-storage']['jetski.onboarding.lastLoginUsername'] = job.targetEmail;
            }
            dbValues['google.google-antigravity'] = JSON.stringify(parsed);
          }
        }
      } catch (err) {
        log('WARN', `Could not update google.google-antigravity in state.vscdb: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Clean up old WAL/SHM companion files before writing
      const walFile = `${job.dbPath}-wal`;
      const shmFile = `${job.dbPath}-shm`;
      try {
        if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
        if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
      } catch {
        // WAL removal is best-effort
      }

      if (job.deleteKeys && job.deleteKeys.length > 0) {
        await deleteKeys(job.dbPath, job.deleteKeys);
      }

      if (Object.keys(dbValues).length > 0) {
        await writeKeys(job.dbPath, dbValues);
      }
      log('INFO', `Updated state.vscdb (deleted=${job.deleteKeys?.length || 0}, written=${Object.keys(dbValues).length})`);

      // If we don't have a keychainToken (e.g. legacy v2.5.5), verify from DB
      if (!job.keychainToken && !job.clearKeychain) {
        const verified = await readKeys(job.dbPath, [
          KEYS.oauth,
          KEYS.legacyInit,
          KEYS.userStatus,
        ]);
        const primaryAuth =
          verified[KEYS.oauth] ||
          verified[KEYS.legacyInit] ||
          verified[KEYS.userStatus] ||
          '';
        const computedFp = fingerprint(primaryAuth);
        if (job.targetFingerprint && computedFp !== job.targetFingerprint) {
          throw new Error(
            `Verification failed: Written fingerprint (${computedFp}) does not match expected (${job.targetFingerprint})`
          );
        }
      }
    }

    result.ok = true;
    result.switchedAt = Date.now();
    log('INFO', 'Token swap completed successfully');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', `Switchyard Helper Error: ${msg}`);
    result.error = msg;

    // Rollback OS Keychain if we had a previous token
    if (previousKeychainToken) {
      writeKeychainToken(previousKeychainToken);
      log('INFO', 'Rolled back OS keychain token');
    }

    // Rollback from backup if backup was created
    if (backupInfo && job.dbPath) {
      try {
        await restoreBackup(backupInfo, job.dbPath);
        log('INFO', `Rolled back state.vscdb to backup ${backupInfo.id}`);
      } catch (rollbackErr) {
        log('ERROR', `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
    }
  } finally {
    // 7. Write result file
    try {
      if (job.resultFile) {
        const resultDir = path.dirname(job.resultFile);
        if (!fs.existsSync(resultDir)) {
          fs.mkdirSync(resultDir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(job.resultFile, JSON.stringify(result, null, 2), {
          mode: 0o600,
        });
        log('INFO', `Wrote resultFile ok=${result.ok}`);
      }
    } catch (writeErr) {
      log('ERROR', `Failed to write result file: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
    }

    // 8. Delete job file (sensitive tokens)
    try {
      fs.rmSync(jobPath, { force: true });
    } catch {
      // ignore
    }

    // 9. Always relaunch the IDE so the user is never left stranded
    if (job.relaunch?.exe) {
      try {
        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        for (const key of Object.keys(cleanEnv)) {
          if (
            key.startsWith('VSCODE_') ||
            key.startsWith('ELECTRON_') ||
            key.startsWith('ANTIGRAVITY_')
          ) {
            delete cleanEnv[key];
          }
        }

        const relaunchArgs = job.relaunch.args || [];
        log('INFO', `Relaunching IDE: exe=${job.relaunch.exe} args=${JSON.stringify(relaunchArgs)}`);
        const child = spawn(job.relaunch.exe, relaunchArgs, {
          detached: true,
          stdio: 'ignore',
          env: cleanEnv as NodeJS.ProcessEnv,
        });
        child.on('error', (spawnErr) => {
          log('ERROR', `Relaunch spawn error: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`);
        });
        child.unref();
        log('INFO', `Spawned relaunch pid=${child.pid ?? 'unknown'}`);
      } catch (spawnErr) {
        log('ERROR', `Failed to relaunch IDE: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`);
      }
    }
  }

  return result;
}

// Auto-run when executed directly via Node / CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith('switch-helper.ts') ||
    process.argv[1].endsWith('switch-helper.js'))
) {
  void runHelper();
}
