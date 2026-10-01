import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../../src/db/backup';
import { readKeys } from '../../src/db/StateDb';
import { writeSyntheticDb } from '../fixtures/makeDb';

describe('db/backup', () => {
  let tempDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-backup-test-'));
    dbPath = path.join(tempDir, 'state.vscdb');
    backupDir = path.join(tempDir, 'backups');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates a backup with companion files and meta.json', async () => {
    await writeSyntheticDb(dbPath, { 'test.key': 'val-backup' });
    fs.writeFileSync(`${dbPath}.backup`, 'fake backup data');
    fs.writeFileSync(`${dbPath}-wal`, 'fake wal data');

    const backup = await createBackup(dbPath, backupDir);

    expect(backup.id).toBeDefined();
    expect(fs.existsSync(backup.path)).toBe(true);
    expect(backup.files).toContain('state.vscdb');
    expect(backup.files).toContain('state.vscdb.backup');
    expect(backup.files).toContain('state.vscdb-wal');

    const metaFile = path.join(backup.path, 'meta.json');
    expect(fs.existsSync(metaFile)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    expect(meta.id).toBe(backup.id);
  });

  it('lists backups in newest-first order', async () => {
    await writeSyntheticDb(dbPath, { 'k': 'v' });

    const b1 = await createBackup(dbPath, backupDir);
    // Ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 20));
    const b2 = await createBackup(dbPath, backupDir);

    const list = await listBackups(backupDir);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(b2.id);
    expect(list[1].id).toBe(b1.id);
  });

  it('passes exit criterion: Backup -> corrupt DB -> restore test passes', async () => {
    const originalData = {
      'user.email': 'valid-user@example.com',
      'user.token': 'very-important-session-token-xyz',
    };

    // 1. Create initial valid DB
    await writeSyntheticDb(dbPath, originalData);
    fs.writeFileSync(`${dbPath}.backup`, 'valid companion backup');

    // 2. Take backup
    const backup = await createBackup(dbPath, backupDir);
    expect(backup.files).toContain('state.vscdb');

    // 3. Corrupt the database by overwriting with garbage bytes
    fs.writeFileSync(dbPath, Buffer.from('CORRUPTED_GARBAGE_DATA_12345'));
    fs.writeFileSync(`${dbPath}.backup`, Buffer.from('CORRUPTED_BACKUP'));

    // Verify DB is indeed corrupted and cannot read keys properly
    let corrupted = false;
    try {
      const readCorrupted = await readKeys(dbPath, ['user.email']);
      if (!readCorrupted['user.email']) corrupted = true;
    } catch {
      corrupted = true;
    }
    expect(corrupted).toBe(true);

    // 4. Restore backup
    await restoreBackup(backup, dbPath);

    // 5. Verify restored database matches original data byte-for-byte
    const restoredData = await readKeys(dbPath, Object.keys(originalData));
    expect(restoredData).toEqual(originalData);

    const restoredBackupContent = fs.readFileSync(`${dbPath}.backup`, 'utf8');
    expect(restoredBackupContent).toBe('valid companion backup');
  });

  it('prunes old backups keeping only requested count', async () => {
    await writeSyntheticDb(dbPath, { 'k': 'v' });

    for (let i = 0; i < 5; i++) {
      await createBackup(dbPath, backupDir);
      await new Promise((r) => setTimeout(r, 15));
    }

    let all = await listBackups(backupDir);
    expect(all.length).toBe(5);

    const deleted = await pruneBackups(backupDir, 2);
    expect(deleted.length).toBe(3);

    all = await listBackups(backupDir);
    expect(all.length).toBe(2);
  });
});
