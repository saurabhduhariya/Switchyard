import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteKeys, readKey, readKeys, writeKeys } from '../../src/db/StateDb';
import { writeSyntheticDb } from '../fixtures/makeDb';

describe('db/StateDb', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-db-test-'));
    dbPath = path.join(tempDir, 'state.vscdb');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('reads keys from existing database', async () => {
    await writeSyntheticDb(dbPath, {
      'test.key1': 'value-one',
      'test.key2': 'value-two',
    });

    const values = await readKeys(dbPath, ['test.key1', 'test.key2', 'missing.key']);
    expect(values).toEqual({
      'test.key1': 'value-one',
      'test.key2': 'value-two',
    });

    const single = await readKey(dbPath, 'test.key1');
    expect(single).toBe('value-one');

    const missing = await readKey(dbPath, 'missing.key');
    expect(missing).toBeUndefined();
  });

  it('returns empty record when file does not exist', async () => {
    const nonExistent = path.join(tempDir, 'does-not-exist.vscdb');
    const values = await readKeys(nonExistent, ['any.key']);
    expect(values).toEqual({});
  });

  it('passes round-trip test: write keys -> read keys returns identical strings (byte-for-byte)', async () => {
    const complexData = {
      'auth.token': 'ya29.synthetic-token-value-abc123-opaque',
      'user.status': 'CsOrAQoVdXNlclN0YXR1c1NlbnRpbmVsS2V5EqirAQqkqwFHaE...',
      'unicode.test': 'こんにちは世界 🚀 / Multi-Byte \u001f\ufffd 🎯 \u2022 \u00a9 \u03c0',
      'empty.key': '',
    };

    // Write to DB
    await writeKeys(dbPath, complexData);

    // Read back and assert identical strings
    const readBack = await readKeys(dbPath, Object.keys(complexData));
    expect(readBack).toEqual(complexData);

    for (const [k, expected] of Object.entries(complexData)) {
      expect(readBack[k]).toBe(expected);
      expect(Buffer.from(readBack[k], 'utf8')).toEqual(Buffer.from(expected, 'utf8'));
    }
  });

  it('deletes keys correctly', async () => {
    await writeSyntheticDb(dbPath, {
      'key.keep': 'keep-me',
      'key.delete': 'delete-me',
    });

    await deleteKeys(dbPath, ['key.delete']);

    const remaining = await readKeys(dbPath, ['key.keep', 'key.delete']);
    expect(remaining).toEqual({
      'key.keep': 'keep-me',
    });
  });

  it('updates state.vscdb.backup when sibling exists', async () => {
    const backupPath = `${dbPath}.backup`;
    await writeSyntheticDb(dbPath, { 'original.key': 'val1' });
    await writeSyntheticDb(backupPath, { 'original.key': 'val1' });

    // Write updated keys to main DB
    await writeKeys(dbPath, { 'original.key': 'updated-val' });

    // Backup sibling should also have been updated
    const backupKeys = await readKeys(backupPath, ['original.key']);
    expect(backupKeys['original.key']).toBe('updated-val');
  });

  it('handles companion -wal and -shm files gracefully during read', async () => {
    await writeSyntheticDb(dbPath, { 'sample.key': 'wal-test' });
    fs.writeFileSync(`${dbPath}-wal`, 'fake wal content');
    fs.writeFileSync(`${dbPath}-shm`, 'fake shm content');

    const result = await readKeys(dbPath, ['sample.key']);
    expect(result['sample.key']).toBe('wal-test');
  });
});
