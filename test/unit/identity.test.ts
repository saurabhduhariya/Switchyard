import { describe, expect, it } from 'vitest';
import {
  b64decode,
  extractEmailFromBuffer,
  extractPlanFromBuffer,
  fingerprint,
  jwtPayload,
  parseSnapshot,
  readProtobufFields,
  readVarint,
} from '../../src/accounts/identity';
import { createAccountId } from '../../src/accounts/types';
import { KEYS } from '../../src/constants';
import {
  makeSyntheticJwt,
  makeSyntheticOAuthToken,
  makeSyntheticUserStatus,
} from '../fixtures/makeDb';

describe('accounts/identity', () => {
  it('decodes base64 safely', () => {
    const buf = b64decode('SGVsbG8gV29ybGQ=');
    expect(buf.toString('utf8')).toBe('Hello World');

    expect(b64decode('').length).toBe(0);
  });

  it('reads varints correctly', () => {
    // 150 = 0x96 0x01
    const buf = Buffer.from([0x96, 0x01]);
    const { value, bytesRead } = readVarint(buf, 0);
    expect(value).toBe(150);
    expect(bytesRead).toBe(2);
  });

  it('reads protobuf fields', () => {
    const textBuf = Buffer.from('hello protobuf', 'utf8');
    // Field 1, wireType 2 (length-delimited) => (1 << 3) | 2 = 10 (0x0a)
    const msg = Buffer.concat([Buffer.from([0x0a, textBuf.length]), textBuf]);

    const fields = readProtobufFields(msg);
    expect(fields.length).toBe(1);
    expect(fields[0].fieldNumber).toBe(1);
    expect(fields[0].wireType).toBe(2);
    expect(fields[0].data.toString('utf8')).toBe('hello protobuf');
  });

  it('parses JWT payload safely', () => {
    const jwt = makeSyntheticJwt({ email: 'developer@example.org', role: 'admin' });
    const payload = jwtPayload(jwt);
    expect(payload).toBeDefined();
    expect(payload?.email).toBe('developer@example.org');
    expect(payload?.role).toBe('admin');

    expect(jwtPayload('not-a-jwt')).toBeUndefined();
    expect(jwtPayload('')).toBeUndefined();
  });

  it('computes 12-char fingerprint', () => {
    const fp1 = fingerprint('token-a');
    const fp2 = fingerprint('token-b');
    expect(fp1).toHaveLength(12);
    expect(fp2).toHaveLength(12);
    expect(fp1).not.toBe(fp2);
    expect(fingerprint('token-a')).toBe(fp1); // deterministic
  });

  it('extracts email and plan from synthetic userStatus', () => {
    const userStatus = makeSyntheticUserStatus({
      email: 'engineer@synthetic-cloud.org',
      name: 'Cloud Engineer',
      plan: 'AI Pro',
    });

    const identity = parseSnapshot({
      [KEYS.userStatus]: userStatus,
      [KEYS.oauth]: 'dummy-oauth-val',
    });

    expect(identity.email).toBe('engineer@synthetic-cloud.org');
    expect(identity.plan).toBe('AI Pro');
    expect(identity.fingerprint).toBeDefined();
  });

  it('extracts email from synthetic oauthToken when userStatus is missing', () => {
    const oauthToken = makeSyntheticOAuthToken({
      email: 'oauth-user@test-domain.com',
    });

    const identity = parseSnapshot({
      [KEYS.oauth]: oauthToken,
    });

    expect(identity.email).toBe('oauth-user@test-domain.com');
  });

  it('falls back to fingerprint when neither token has an email', () => {
    const identity = parseSnapshot({
      [KEYS.oauth]: Buffer.from('opaque-unparsable-token-bytes').toString('base64'),
    });

    expect(identity.email).toBeUndefined();
    expect(identity.fingerprint).toHaveLength(12);
  });

  it('handles completely empty snapshot gracefully', () => {
    const identity = parseSnapshot({});
    expect(identity.email).toBeUndefined();
    expect(identity.plan).toBeUndefined();
    expect(identity.fingerprint).toBeDefined();
  });

  it('generates deterministic account IDs from email', () => {
    const id1 = createAccountId('User.Test@Example.COM');
    const id2 = createAccountId('user.test@example.com ');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(16);
  });

  it('extracts email embedded in raw binary buffer with base64 chunks', () => {
    // Simulate Google internal protobuf containing an embedded base64 payload
    const innerText = 'kkpncc: kkpncc8831@gmail.com';
    const b64 = Buffer.from(innerText).toString('base64');
    const outerBinary = Buffer.concat([
      Buffer.from([0x01, 0x02, 0x03]),
      Buffer.from(b64, 'ascii'),
      Buffer.from([0x04, 0x05, 0x06]),
    ]);

    const email = extractEmailFromBuffer(outerBinary);
    expect(email).toBe('kkpncc8831@gmail.com');
  });

  it('extracts Antigravity Starter tier correctly from protobuf userTier (field 36)', () => {
    // Build field 36 submessage: field 1 = 'free-tier', field 2 = 'Antigravity Starter Quota'
    const idBuf = Buffer.from('free-tier', 'utf8');
    const nameBuf = Buffer.from('Antigravity Starter Quota', 'utf8');
    const tierData = Buffer.concat([
      Buffer.from([0x0a, idBuf.length]),
      idBuf,
      Buffer.from([0x12, nameBuf.length]),
      nameBuf,
    ]);

    // Field 36, wireType 2: (36 << 3) | 2 = 290 => varint 0xa2, 0x02
    const msg = Buffer.concat([
      Buffer.from([0xa2, 0x02, tierData.length]),
      tierData,
    ]);

    const plan = extractPlanFromBuffer(msg);
    expect(plan).toBe('Antigravity Starter');
  });

  it('extracts Google AI Pro tier correctly from protobuf userTier (field 36)', () => {
    const idBuf = Buffer.from('g1-pro-tier', 'utf8');
    const nameBuf = Buffer.from('Google AI Pro', 'utf8');
    const tierData = Buffer.concat([
      Buffer.from([0x0a, idBuf.length]),
      idBuf,
      Buffer.from([0x12, nameBuf.length]),
      nameBuf,
    ]);

    const msg = Buffer.concat([
      Buffer.from([0xa2, 0x02, tierData.length]),
      tierData,
    ]);

    const plan = extractPlanFromBuffer(msg);
    expect(plan).toBe('Google AI Pro');
  });

  it('does NOT misidentify model names like "Gemini 3.1 Pro (High)" as a Pro plan', () => {
    // A free account payload containing model names but no paid userTier
    const modelConfigText = 'Gemini 3.1 Pro (High) Gemini 3.1 Pro (Low) Claude Sonnet 4.6';
    const textBuf = Buffer.from(modelConfigText, 'utf8');
    const msg = Buffer.concat([
      Buffer.from([0x0a, textBuf.length]),
      textBuf,
    ]);

    const plan = extractPlanFromBuffer(msg);
    expect(plan).toBeUndefined();
  });
});
