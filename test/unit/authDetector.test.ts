import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthDetector } from '../../src/accounts/AuthDetector';
import { KEYS } from '../../src/constants';
import { makeSyntheticSessionEntries, writeSyntheticDb } from '../fixtures/makeDb';

describe('accounts/AuthDetector', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-detector-test-'));
    dbPath = path.join(tempDir, 'state.vscdb');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('detects active authentication and extracts identity and snapshot', async () => {
    const syntheticSession = makeSyntheticSessionEntries({
      email: 'active-user@company.com',
      plan: 'AI Pro',
    });

    await writeSyntheticDb(dbPath, syntheticSession);

    const detector = new AuthDetector(dbPath);
    const result = await detector.detectActive();

    expect('unsupported' in result).toBe(false);
    if (!('unsupported' in result)) {
      expect(result.identity.email).toBe('active-user@company.com');
      expect(result.identity.plan).toBe('AI Pro');
      expect(result.identity.fingerprint).toBeDefined();
      expect(result.snapshot.values[KEYS.oauth]).toBe(syntheticSession[KEYS.oauth]);
      expect(result.snapshot.capturedAt).toBeGreaterThan(0);
    }
  });

  it('detects active authentication when userStatus is present even without oauthToken', async () => {
    const syntheticSession = makeSyntheticSessionEntries({
      email: 'user-status-only@company.com',
      plan: 'AI Pro',
    });
    // Remove oauth token, keeping userStatus
    delete syntheticSession[KEYS.oauth];

    await writeSyntheticDb(dbPath, syntheticSession);

    const detector = new AuthDetector(dbPath);
    const result = await detector.detectActive();

    expect('unsupported' in result).toBe(false);
    if (!('unsupported' in result) && !('partial' in result)) {
      expect(result.identity.email).toBe('user-status-only@company.com');
      expect(result.snapshot.values[KEYS.userStatus]).toBe(syntheticSession[KEYS.userStatus]);
    }
  });

  it('returns unsupported when auth tokens are missing from database', async () => {
    await writeSyntheticDb(dbPath, {
      'unrelated.setting': 'true',
    });

    const detector = new AuthDetector(dbPath);
    const result = await detector.detectActive();

    expect('unsupported' in result).toBe(true);
    if ('unsupported' in result) {
      expect(result.unsupported).toBe(true);
      expect(result.reason).toContain('No auth tokens found');
    }
  });

  it('returns unsupported when database file does not exist', async () => {
    const nonExistent = path.join(tempDir, 'absent.vscdb');
    const detector = new AuthDetector(nonExistent);
    const result = await detector.detectActive();

    expect('unsupported' in result).toBe(true);
  });

  it('returns unsupported for Antigravity 2.6 signedOut sentinel and empty state sync keys', async () => {
    const fs = await import('node:fs');
    const initSqlJs = (await import('sql.js')).default;
    const { KEYS } = await import('../../src/constants');
    const { __setTestKeychainToken } = await import('../../src/platform/keychain');

    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');

    const sentinelProto = Buffer.concat([
      Buffer.from('authStateWithContextSentinelKey', 'utf8'),
      Buffer.from('{"state":"signedOut","context":{}}', 'utf8'),
    ]).toString('base64');

    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [KEYS.oauth, sentinelProto]);
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [KEYS.userStatus, '']);
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [KEYS.modelCredits, '']);

    const dbPath = path.join(tempDir, 'signed-out-sentinel.vscdb');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    __setTestKeychainToken('');
    try {
      const detector = new AuthDetector(dbPath);
      const result = await detector.detectActive();
      expect('unsupported' in result).toBe(true);
      if ('unsupported' in result) {
        expect(result.reason).toContain('No auth tokens found');
      }
    } finally {
      __setTestKeychainToken(undefined);
    }
  });

  it('returns unsupported for empty values and unauthenticated legacyInit metadata', async () => {
    const fs = await import('node:fs');
    const initSqlJs = (await import('sql.js')).default;
    const { KEYS } = await import('../../src/constants');
    const { __setTestKeychainToken } = await import('../../src/platform/keychain');

    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [KEYS.oauth, '']);
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [
      KEYS.legacyInit,
      JSON.stringify({ onboardingComplete: true, lastSeenVersion: '2.6.0' }),
    ]);

    const dbPath = path.join(tempDir, 'non-auth-legacy-init.vscdb');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    __setTestKeychainToken('');
    try {
      const detector = new AuthDetector(dbPath);
      const result = await detector.detectActive();
      expect('unsupported' in result).toBe(true);
      if ('unsupported' in result) {
        expect(result.reason).toContain('No auth tokens found');
      }
    } finally {
      __setTestKeychainToken(undefined);
    }
  });

  it('returns unsupported when OS Keychain contains empty or signedOut JSON payloads', async () => {
    const fs = await import('node:fs');
    const initSqlJs = (await import('sql.js')).default;
    const { __setTestKeychainToken } = await import('../../src/platform/keychain');

    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    const dbPath = path.join(tempDir, 'empty-keychain.vscdb');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    try {
      for (const badPayload of ['{}', '{"state":"signedOut"}', 'go-keyring-base64:', 'signedout']) {
        __setTestKeychainToken(badPayload);
        const detector = new AuthDetector(dbPath);
        const result = await detector.detectActive();
        expect('unsupported' in result).toBe(true);
        if ('unsupported' in result) {
          expect(result.reason).toContain('No auth tokens found');
        }
      }
    } finally {
      __setTestKeychainToken(undefined);
    }
  });

  it('returns unsupported (not partial) for a capture DB with only state-sync preference keys', async () => {
    const { __setTestKeychainToken } = await import('../../src/platform/keychain');
    const captureDbPath = path.join(tempDir, 'switchyard-capture', 'cap-1', 'User', 'globalStorage', 'state.vscdb');
    await writeSyntheticDb(captureDbPath, {
      'antigravityUnifiedStateSync.agentPreferences': 'CgJVUw==',
      'antigravityUnifiedStateSync.modelPreferences': 'CgJVUw==',
      'antigravityUnifiedStateSync.browserPreferences': 'CgJVUw==',
    });

    __setTestKeychainToken('');
    try {
      const detector = new AuthDetector(captureDbPath);
      const result = await detector.detectActive();
      expect('unsupported' in result).toBe(true);
    } finally {
      __setTestKeychainToken(undefined);
    }
  });

  it('still returns partial for non-capture DBs with state-sync preference keys, and for capture DBs with profileUrl', async () => {
    const { __setTestKeychainToken } = await import('../../src/platform/keychain');
    await writeSyntheticDb(dbPath, {
      'antigravityUnifiedStateSync.agentPreferences': 'CgJVUw==',
    });
    const captureDbPath = path.join(tempDir, 'switchyard-capture', 'cap-2', 'User', 'globalStorage', 'state.vscdb');
    await writeSyntheticDb(captureDbPath, {
      [KEYS.profileUrl]: 'https://example.com/avatar.png',
    });

    __setTestKeychainToken('');
    try {
      const regularResult = await new AuthDetector(dbPath).detectActive();
      expect('partial' in regularResult && regularResult.partial).toBe(true);

      const captureResult = await new AuthDetector(captureDbPath).detectActive();
      expect('partial' in captureResult && captureResult.partial).toBe(true);
    } finally {
      __setTestKeychainToken(undefined);
    }
  });
});
