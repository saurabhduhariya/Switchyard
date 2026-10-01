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
});
