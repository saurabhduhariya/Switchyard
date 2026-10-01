import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSqlJs } from '../../src/db/StateDb';
import { KEYS } from '../../src/constants';

/**
 * Creates an in-memory SQLite database containing ItemTable with the provided key-value entries.
 */
export async function createSyntheticDb(entries: Record<string, string>): Promise<Buffer> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
    try {
      for (const [key, value] of Object.entries(entries)) {
        stmt.run([key, value]);
      }
    } finally {
      stmt.free();
    }
    db.run('COMMIT');
    return Buffer.from(db.export());
  } finally {
    db.close();
  }
}

/**
 * Writes a synthetic database directly to disk at the specified path.
 */
export async function writeSyntheticDb(filePath: string, entries: Record<string, string>): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = await createSyntheticDb(entries);
  fs.writeFileSync(filePath, data);
}

/**
 * Builds a synthetic base64url-encoded JWT with the provided payload.
 */
export function makeSyntheticJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('synthetic-test-signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Builds a synthetic oauthToken value (base64 string containing a synthetic access token and JWT).
 */
export function makeSyntheticOAuthToken(options: { email?: string; token?: string } = {}): string {
  const token = options.token || 'ya29.synthetic-access-token-for-test';
  const jwt = makeSyntheticJwt({
    email: options.email || 'developer@example.com',
    sub: '1234567890',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const payload = `authSentinelKey:${token}:${jwt}`;
  return Buffer.from(payload, 'utf8').toString('base64');
}

/**
 * Builds a synthetic userStatus value (base64 protobuf wrapping an inner base64 message with email and plan).
 */
export function makeSyntheticUserStatus(options: {
  email: string;
  name?: string;
  plan?: string;
}): string {
  const name = options.name || 'Synthetic Tester';
  const plan = options.plan || 'AI Pro';
  const email = options.email;

  // Inner message format: name, email, plan
  const innerMsg = Buffer.concat([
    Buffer.from([0x0a, name.length]),
    Buffer.from(name, 'utf8'),
    Buffer.from([0x12, email.length]),
    Buffer.from(email, 'utf8'),
    Buffer.from([0x1a, plan.length]),
    Buffer.from(plan, 'utf8'),
  ]);

  const innerB64 = innerMsg.toString('base64');

  // Outer message with field 1 (sentinel) and field 2 (inner base64 string)
  const sentinel = Buffer.from('userStatusSentinelKey', 'utf8');
  const innerB64Buf = Buffer.from(innerB64, 'utf8');

  const outerMsg = Buffer.concat([
    Buffer.from([0x0a, sentinel.length]),
    sentinel,
    Buffer.from([0x12, innerB64Buf.length]),
    innerB64Buf,
  ]);

  return outerMsg.toString('base64');
}

/**
 * Helper to build a standard set of synthetic entries for an account.
 */
export function makeSyntheticSessionEntries(options: {
  email: string;
  plan?: string;
  token?: string;
}): Record<string, string> {
  return {
    [KEYS.oauth]: makeSyntheticOAuthToken({ email: options.email, token: options.token }),
    [KEYS.userStatus]: makeSyntheticUserStatus({ email: options.email, plan: options.plan }),
    [KEYS.modelCredits]: Buffer.from('synthetic-model-credits').toString('base64'),
    [KEYS.profileUrl]: 'https://example.com/avatar.png',
  };
}
