import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { fingerprint } from '../../accounts/identity';
import { KEYS } from '../../constants';
import { createBackup, restoreBackup } from '../../db/backup';
import { deleteKeys, readKeys, writeKeys } from '../../db/StateDb';
import { isProcessAlive } from '../../platform/ide';
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
  const pollIntervalMs = options.pollIntervalMs ?? 200;

  const start = Date.now();
  while (isProcessAlive(pid)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for IDE process (PID ${pid}) to exit after ${timeoutMs}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Process is dead - no additional settle delay needed
  // SQLite will return EBUSY if files are still locked
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

  const result: SwitchResultFile = { ok: false };
  let backupInfo: Awaited<ReturnType<typeof createBackup>> | undefined;

  try {
    // 1. Wait for parent IDE process to terminate
    if (job.parentPid && job.parentPid > 0) {
      await waitForExit(job.parentPid);
    }

    // 2. Create full backup of state.vscdb and sidecars before writing
    backupInfo = await createBackup(job.dbPath, job.backupDir);

    // 3. Clean up old WAL/SHM companion files before writing
    // This ensures we don't replay stale uncommitted transactions from the previous session
    const walFile = `${job.dbPath}-wal`;
    const shmFile = `${job.dbPath}-shm`;
    try {
      if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
      if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
    } catch {
      // WAL removal is best-effort
    }

    // 4. Write target session keys
    await writeKeys(job.dbPath, job.values);

    // 5. Delete requested keys if any
    if (job.deleteKeys && job.deleteKeys.length > 0) {
      await deleteKeys(job.dbPath, job.deleteKeys);
    }

    // 6. Verify written values match target fingerprint
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

    result.ok = true;
    result.switchedAt = Date.now();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Switchyard Helper Error: ${msg}`);
    result.error = msg;

    // Rollback from backup if backup was created
    if (backupInfo) {
      try {
        await restoreBackup(backupInfo, job.dbPath);
        console.info(`Switchyard Helper: Successfully rolled back to backup ${backupInfo.id}`);
      } catch (rollbackErr) {
        console.error('Switchyard Helper: Rollback failed:', rollbackErr);
      }
    }
  } finally {
    // 7. Write result file
    try {
      if (job.resultFile) {
        fs.writeFileSync(job.resultFile, JSON.stringify(result, null, 2), {
          mode: 0o600,
        });
      }
    } catch (writeErr) {
      console.error('Failed to write result file:', writeErr);
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
        delete cleanEnv.ELECTRON_RUN_AS_NODE;
        delete cleanEnv.VSCODE_IPC_HOOK;
        delete cleanEnv.VSCODE_IPC_HOOK_EXTHOST;
        delete cleanEnv.VSCODE_IPC_HOOK_CLI;
        delete cleanEnv.VSCODE_PID;
        delete cleanEnv.VSCODE_CLI;
        delete cleanEnv.VSCODE_CODE_CACHE_PATH;

        const child = spawn(job.relaunch.exe, job.relaunch.args || [], {
          detached: true,
          stdio: 'ignore',
          env: cleanEnv as NodeJS.ProcessEnv,
        });
        child.unref();
      } catch (spawnErr) {
        console.error('Switchyard Helper: Failed to relaunch IDE:', spawnErr);
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
