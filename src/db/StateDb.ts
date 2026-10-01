import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/**
 * Returns a cached singleton instance of SqlJsStatic.
 */
export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) => {
        const candidatePaths = [
          path.join(__dirname, file),
          path.join(__dirname, '..', file),
          path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
        ];
        for (const candidate of candidatePaths) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
        try {
          return require.resolve(`sql.js/dist/${file}`);
        } catch {
          return file;
        }
      },
    });
  }
  return sqlJsPromise;
}

/**
 * Safely reads specific keys from state.vscdb.
 * Copies the DB (and -wal/-shm if present) to a temporary directory to avoid lock contention
 * with the running IDE, reads the requested keys, and deletes the temporary files.
 */
export async function readKeys(dbPath: string, keys: string[]): Promise<Record<string, string>> {
  if (!fs.existsSync(dbPath) || keys.length === 0) {
    return {};
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-read-'));
  const tempDb = path.join(tempDir, 'state.vscdb');

  try {
    fs.copyFileSync(dbPath, tempDb);

    const walFile = `${dbPath}-wal`;
    const shmFile = `${dbPath}-shm`;
    if (fs.existsSync(walFile)) {
      try {
        fs.copyFileSync(walFile, `${tempDb}-wal`);
      } catch {
        // WAL file may have been removed or checkpointed concurrently; ignore
      }
    }
    if (fs.existsSync(shmFile)) {
      try {
        fs.copyFileSync(shmFile, `${tempDb}-shm`);
      } catch {
        // ignore
      }
    }

    const SQL = await getSqlJs();
    const data = fs.readFileSync(tempDb);
    const db = new SQL.Database(data);

    try {
      const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'");
      if (!tableCheck.length || !tableCheck[0].values.length) {
        return {};
      }

      const results: Record<string, string> = {};
      const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
      try {
        for (const key of keys) {
          stmt.bind([key]);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            if (row.value !== null && row.value !== undefined) {
              results[key] = String(row.value);
            }
          }
          stmt.reset();
        }
      } finally {
        stmt.free();
      }
      return results;
    } finally {
      db.close();
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp dir cleanup error
    }
  }
}

/**
 * Reads a single key from state.vscdb.
 */
export async function readKey(dbPath: string, key: string): Promise<string | undefined> {
  const result = await readKeys(dbPath, [key]);
  return result[key];
}

/**
 * Writes or replaces keys in state.vscdb.
 * Atomic write: writes to a .tmp file, flushes with fsync, and renames with retry backoff.
 * Also keeps state.vscdb.backup in sync if present.
 */
export async function writeKeys(dbPath: string, entries: Record<string, string>): Promise<void> {
  const SQL = await getSqlJs();
  let db: Database;

  if (fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath);
    db = new SQL.Database(data);
  } else {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new SQL.Database();
  }

  try {
    db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
    try {
      for (const [key, value] of Object.entries(entries)) {
        stmt.run([key, value]);
      }
    } finally {
      stmt.free();
    }
    db.run('COMMIT');

    const exported = Buffer.from(db.export());
    await atomicWriteFile(dbPath, exported);

    // Keep state.vscdb.backup in sync if it exists
    const backupSibling = `${dbPath}.backup`;
    if (fs.existsSync(backupSibling)) {
      await atomicWriteFile(backupSibling, exported);
    }
  } finally {
    db.close();
  }
}

/**
 * Deletes keys from state.vscdb.
 */
export async function deleteKeys(dbPath: string, keys: string[]): Promise<void> {
  if (!fs.existsSync(dbPath) || keys.length === 0) {
    return;
  }

  const SQL = await getSqlJs();
  const data = fs.readFileSync(dbPath);
  const db = new SQL.Database(data);

  try {
    const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'");
    if (!tableCheck.length || !tableCheck[0].values.length) {
      return;
    }

    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare('DELETE FROM ItemTable WHERE key = ?');
    try {
      for (const key of keys) {
        stmt.run([key]);
      }
    } finally {
      stmt.free();
    }
    db.run('COMMIT');

    const exported = Buffer.from(db.export());
    await atomicWriteFile(dbPath, exported);

    const backupSibling = `${dbPath}.backup`;
    if (fs.existsSync(backupSibling)) {
      await atomicWriteFile(backupSibling, exported);
    }
  } finally {
    db.close();
  }
}

/**
 * Writes data to a temp file, fsyncs, and atomically renames over targetPath with retry backoff.
 */
async function atomicWriteFile(targetPath: string, data: Buffer, retries = 3, delayMs = 100): Promise<void> {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let attempt = 0;
  while (true) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err: unknown) {
      attempt++;
      const isLockError =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        ((err as { code: string }).code === 'EPERM' || (err as { code: string }).code === 'EBUSY');

      if (attempt >= retries || !isLockError) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
