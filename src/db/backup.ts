import * as fs from 'node:fs';
import * as path from 'node:path';
import { readKeys } from './StateDb';
import { isPlanTierCompatible, isStarterTier } from '../shared/quotaRules';
import type { AccountStore } from '../accounts/AccountStore';
import type { Logger } from '../util/logger';
import type { AccountMeta, AccountQuotaSummary } from '../accounts/types';

export interface BackupInfo {
  id: string; // ISO timestamp string safe for filesystems, e.g. "2026-10-01T16-42-00-123Z"
  timestamp: number;
  path: string; // full directory path
  files: string[]; // filenames in backup
}

interface BackupMeta {
  id: string;
  timestamp: number;
  sourceDb: string;
  files: string[];
}

/**
 * Creates a timestamped backup of state.vscdb and any companion files (.backup, -wal, -shm).
 */
export async function createBackup(dbPath: string, backupRootDir?: string): Promise<BackupInfo> {
  const rootDir = backupRootDir || path.join(path.dirname(dbPath), 'backups');
  const now = new Date();
  const id = now.toISOString().replace(/:/g, '-');
  const targetDir = path.join(rootDir, id);

  fs.mkdirSync(targetDir, { recursive: true });

  const filesToCopy = [
    { source: dbPath, destName: 'state.vscdb' },
    { source: `${dbPath}.backup`, destName: 'state.vscdb.backup' },
    { source: `${dbPath}-wal`, destName: 'state.vscdb-wal' },
    { source: `${dbPath}-shm`, destName: 'state.vscdb-shm' },
  ];

  const copiedFiles: string[] = [];

  for (const item of filesToCopy) {
    if (fs.existsSync(item.source)) {
      const destPath = path.join(targetDir, item.destName);
      fs.copyFileSync(item.source, destPath);
      try {
        fs.chmodSync(destPath, 0o600);
      } catch {
        // chmod might not be supported on some filesystems/Windows; ignore
      }
      copiedFiles.push(item.destName);
    }
  }

  const meta: BackupMeta = {
    id,
    timestamp: now.getTime(),
    sourceDb: dbPath,
    files: copiedFiles,
  };

  const metaPath = path.join(targetDir, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });

  return {
    id,
    timestamp: meta.timestamp,
    path: targetDir,
    files: copiedFiles,
  };
}

/**
 * Lists all backups in the backup root directory, sorted from newest to oldest.
 */
export async function listBackups(backupRootDir: string): Promise<BackupInfo[]> {
  if (!fs.existsSync(backupRootDir)) {
    return [];
  }

  const entries = fs.readdirSync(backupRootDir, { withFileTypes: true });
  const backups: BackupInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = path.join(backupRootDir, entry.name);
    const metaPath = path.join(dirPath, 'meta.json');

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BackupMeta;
        backups.push({
          id: meta.id,
          timestamp: meta.timestamp,
          path: dirPath,
          files: meta.files || [],
        });
        continue;
      } catch {
        // fallback to inferring from folder name
      }
    }

    // Fallback: parse directory name as timestamp
    const stat = fs.statSync(dirPath);
    const files = fs.readdirSync(dirPath).filter((f) => f !== 'meta.json');
    backups.push({
      id: entry.name,
      timestamp: stat.mtimeMs,
      path: dirPath,
      files,
    });
  }

  return backups.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Restores a backup over the target database path.
 */
export async function restoreBackup(info: BackupInfo, targetDbPath: string): Promise<void> {
  const targetDir = path.dirname(targetDbPath);
  fs.mkdirSync(targetDir, { recursive: true });

  const mapping: Record<string, string> = {
    'state.vscdb': targetDbPath,
    'state.vscdb.backup': `${targetDbPath}.backup`,
    'state.vscdb-wal': `${targetDbPath}-wal`,
    'state.vscdb-shm': `${targetDbPath}-shm`,
  };

  for (const file of info.files) {
    const srcFile = path.join(info.path, file);
    const destFile = mapping[file];
    if (destFile && fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      try {
        fs.chmodSync(destFile, 0o600);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Prunes backups, keeping only the newest `keep` backups.
 * Returns array of deleted backup paths.
 */
export async function pruneBackups(backupRootDir: string, keep: number): Promise<string[]> {
  const allBackups = await listBackups(backupRootDir);
  if (allBackups.length <= keep) {
    return [];
  }

  const toRemove = allBackups.slice(keep);
  const deleted: string[] = [];

  for (const backup of toRemove) {
    try {
      fs.rmSync(backup.path, { recursive: true, force: true });
      deleted.push(backup.path);
    } catch {
      // ignore deletion errors
    }
  }

  return deleted;
}

/**
 * Detects any accounts whose quota was accidentally contaminated or overwritten during an account switch
 * (e.g. a Pro account having a Starter quota, or a Starter account having a Pro quota).
 * Restores their authentic quota from the latest available backup in backupRootDir.
 */
export async function recoverCorruptedQuotas(
  store: AccountStore,
  backupRootDir: string,
  logger?: Logger
): Promise<boolean> {
  const accounts = await store.list();
  const corrupted = accounts.filter(
    (a) => a.plan && a.quota && !isPlanTierCompatible(a.plan, a.quota)
  );

  if (corrupted.length === 0) {
    return false;
  }

  const backups = await listBackups(backupRootDir);
  let anyRestored = false;

  for (const acc of corrupted) {
    let restored = false;
    for (const b of backups) {
      const backupDbPath = path.join(b.path, 'state.vscdb');
      if (!fs.existsSync(backupDbPath)) continue;
      try {
        const keys = await readKeys(backupDbPath, ['saurabhduhariya.ag-switchyard']);
        const raw = keys['saurabhduhariya.ag-switchyard'];
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const backupAccounts: AccountMeta[] = parsed['switchyard.accounts'] || [];
        const match = backupAccounts.find((ba) => ba.id === acc.id);
        if (match?.quota && isPlanTierCompatible(acc.plan, match.quota)) {
          logger?.info(`Restoring authentic quota for ${acc.email} (${acc.plan}) from backup ${b.id}`);
          await store.updateQuota(acc.id, match.quota);
          restored = true;
          anyRestored = true;
          break;
        }
      } catch (err) {
        logger?.debug(`Failed to inspect backup ${b.id} for quota recovery:`, err);
      }
    }

    if (!restored && acc.quota) {
      if (isStarterTier(acc.plan)) {
        const cleanQuota: AccountQuotaSummary = {
          tierName: 'Antigravity Starter Quota',
          gemini: {
            name: 'Gemini',
            weekly: acc.quota.gemini?.weekly,
            weeklyRemaining: acc.quota.gemini?.weeklyRemaining,
            weeklyResetTime: acc.quota.gemini?.weeklyResetTime,
          },
          claudeGpt: {
            name: 'Claude + GPT',
            weekly: acc.quota.claudeGpt?.weekly,
            weeklyRemaining: acc.quota.claudeGpt?.weeklyRemaining,
            weeklyResetTime: acc.quota.claudeGpt?.weeklyResetTime,
          },
          updatedAt: acc.quota.updatedAt,
          source: acc.quota.source,
        };
        await store.updateQuota(acc.id, cleanQuota);
        anyRestored = true;
      } else {
        await store.updateQuota(acc.id, {
          ...acc.quota,
          tierName: `${acc.plan} Quota`,
        });
        anyRestored = true;
      }
    }
  }

  return anyRestored;
}

export const recoverCorruptedProQuotas = recoverCorruptedQuotas;
