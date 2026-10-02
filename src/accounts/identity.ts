import * as crypto from 'node:crypto';
import { KEYS } from '../constants';
import { AccountIdentity } from './types';

export interface ProtobufField {
  fieldNumber: number;
  wireType: number;
  data: Buffer;
}

/**
 * Decodes a base64 or base64url string to a Buffer safely.
 */
export function b64decode(str: string): Buffer {
  if (!str) return Buffer.alloc(0);
  try {
    return Buffer.from(str, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Reads a protobuf varint from buffer at the given byte offset.
 */
export function readVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    bytesRead++;
    if (byte === undefined) break;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
    if (shift >= 35) {
      break;
    }
  }

  return { value, bytesRead };
}

/**
 * Length-delimited protobuf field walker.
 */
export function readProtobufFields(buf: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < buf.length) {
    try {
      const tag = readVarint(buf, offset);
      if (tag.bytesRead === 0) break;
      offset += tag.bytesRead;

      const wireType = tag.value & 0x07;
      const fieldNumber = tag.value >>> 3;
      if (fieldNumber === 0) break;

      if (wireType === 0) {
        // Varint
        const val = readVarint(buf, offset);
        if (val.bytesRead === 0) break;
        fields.push({
          fieldNumber,
          wireType,
          data: buf.subarray(offset, offset + val.bytesRead),
        });
        offset += val.bytesRead;
      } else if (wireType === 1) {
        // 64-bit
        if (offset + 8 > buf.length) break;
        fields.push({
          fieldNumber,
          wireType,
          data: buf.subarray(offset, offset + 8),
        });
        offset += 8;
      } else if (wireType === 2) {
        // Length-delimited
        const len = readVarint(buf, offset);
        if (len.bytesRead === 0) break;
        offset += len.bytesRead;
        if (offset + len.value > buf.length) break;
        fields.push({
          fieldNumber,
          wireType,
          data: buf.subarray(offset, offset + len.value),
        });
        offset += len.value;
      } else if (wireType === 5) {
        // 32-bit
        if (offset + 4 > buf.length) break;
        fields.push({
          fieldNumber,
          wireType,
          data: buf.subarray(offset, offset + 4),
        });
        offset += 4;
      } else {
        // Unrecognized wire type; stop parsing
        break;
      }
    } catch {
      break;
    }
  }

  return fields;
}

/**
 * Parses and returns the JSON payload from a JWT token, if valid.
 */
export function jwtPayload(token: string): Record<string, unknown> | undefined {
  if (!token || typeof token !== 'string') return undefined;
  const parts = token.split('.');
  const payload = parts[1];
  if (!payload) return undefined;
  try {
    const raw = Buffer.from(payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Computes a SHA-256 fingerprint (first 12 chars hex) of a token or session value.
 */
export function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value || '').digest('hex').slice(0, 12);
}

/**
 * Scans a buffer for emails, traversing protobuf fields, embedded base64, and JWTs.
 */
export function extractEmailFromBuffer(buf: Buffer): string | undefined {
  if (!buf || buf.length === 0) return undefined;

  // 1. Walk protobuf fields recursively
  const fields = readProtobufFields(buf);
  for (const field of fields) {
    if (field.wireType === 2) {
      const str = field.data.toString('utf8');
      if (str.length >= 20 && /^[A-Za-z0-9+/=\r\n]+$/.test(str.trim())) {
        try {
          const innerBuf = Buffer.from(str.trim(), 'base64');
          const innerEmail = extractEmailFromBuffer(innerBuf);
          if (innerEmail) return innerEmail;
        } catch {
          // ignore
        }
      }

      const subEmail = extractEmailFromBuffer(field.data);
      if (subEmail) return subEmail;
    }
  }

  // 2. Check for JWT tokens
  const str = buf.toString('utf8');
  const jwtRegex = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  let match: RegExpExecArray | null;
  while ((match = jwtRegex.exec(str)) !== null) {
    const payload = jwtPayload(match[0]);
    if (payload && typeof payload.email === 'string') {
      return payload.email;
    }
  }

  // 3. Direct regex check
  const directMatch = str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (directMatch) return directMatch[1];

  // 4. Scan for embedded base64 chunks within binary buffer
  const latinStr = buf.toString('latin1');
  const b64Chunks = latinStr.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const chunk of b64Chunks) {
    try {
      const decodedBuf = Buffer.from(chunk, 'base64');
      const innerEmail = extractEmailFromBuffer(decodedBuf);
      if (innerEmail) return innerEmail;
    } catch {
      // ignore
    }
  }

  return undefined;
}

export interface UserTierInfo {
  id?: string;
  name?: string;
}

/**
 * Parses userTier (field 36) from protobuf buffers recursively.
 */
export function extractTierFromProtobuf(buf: Buffer): UserTierInfo | undefined {
  if (!buf || buf.length === 0) return undefined;

  const fields = readProtobufFields(buf);
  for (const field of fields) {
    if (field.fieldNumber === 36 && field.wireType === 2) {
      const subfields = readProtobufFields(field.data);
      let id: string | undefined;
      let name: string | undefined;
      for (const sf of subfields) {
        if (sf.fieldNumber === 1 && sf.wireType === 2) {
          id = sf.data.toString('utf8');
        } else if (sf.fieldNumber === 2 && sf.wireType === 2) {
          name = sf.data.toString('utf8');
        }
      }
      if (id || name) {
        return { id, name };
      }
    }

    if (field.wireType === 2) {
      const str = field.data.toString('utf8');
      if (str.length >= 20 && /^[A-Za-z0-9+/=\r\n]+$/.test(str.trim())) {
        try {
          const innerBuf = Buffer.from(str.trim(), 'base64');
          const innerTier = extractTierFromProtobuf(innerBuf);
          if (innerTier) return innerTier;
        } catch {
          // ignore
        }
      }

      const subTier = extractTierFromProtobuf(field.data);
      if (subTier) return subTier;
    }
  }

  // Scan embedded base64 chunks for userTier
  const latinStr = buf.toString('latin1');
  const b64Chunks = latinStr.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const chunk of b64Chunks) {
    try {
      const decodedBuf = Buffer.from(chunk, 'base64');
      const innerTier = extractTierFromProtobuf(decodedBuf);
      if (innerTier) return innerTier;
    } catch {
      // ignore
    }
  }

  return undefined;
}

/**
 * Normalizes userTier id and name into a human-readable plan name.
 */
export function formatPlanFromTier(tier: UserTierInfo): string | undefined {
  const id = tier.id?.toLowerCase();
  const name = tier.name;

  if (id === 'free-tier' || id === 'starter-tier' || name?.toLowerCase().includes('starter') || name?.toLowerCase().includes('free')) {
    return 'Antigravity Starter';
  }
  if (id === 'g1-ultra-tier' || name?.toLowerCase().includes('ultra')) {
    return 'Google AI Ultra';
  }
  if (id === 'g1-pro-tier' || name?.toLowerCase().includes('google ai pro')) {
    return 'Google AI Pro';
  }
  if (name?.toLowerCase().includes('ai pro')) {
    return 'AI Pro';
  }
  return name || tier.id;
}

/**
 * Scans a buffer for subscription plan or tier indications.
 */
export function extractPlanFromBuffer(buf: Buffer): string | undefined {
  if (!buf || buf.length === 0) return undefined;

  // 1. Direct protobuf userTier check (highest fidelity)
  const tier = extractTierFromProtobuf(buf);
  if (tier) {
    const formatted = formatPlanFromTier(tier);
    if (formatted) return formatted;
  }

  // 2. Direct string check in buffer utf8 representation
  const direct = findPlanInString(buf.toString('utf8'));
  if (direct) {
    return direct;
  }

  // 3. Recursive traversal of length-delimited protobuf fields
  const fields = readProtobufFields(buf);
  for (const field of fields) {
    if (field.wireType === 2) {
      const str = field.data.toString('utf8');
      if (str.length >= 20 && /^[A-Za-z0-9+/=\r\n]+$/.test(str.trim())) {
        try {
          const innerBuf = Buffer.from(str.trim(), 'base64');
          const innerPlan = extractPlanFromBuffer(innerBuf);
          if (innerPlan) return innerPlan;
        } catch {
          // ignore
        }
      }

      const subPlan = extractPlanFromBuffer(field.data);
      if (subPlan) return subPlan;
    }
  }

  // 4. Also scan embedded base64 chunks for plan
  const latinStr = buf.toString('latin1');
  const b64Chunks = latinStr.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const chunk of b64Chunks) {
    try {
      const decodedBuf = Buffer.from(chunk, 'base64');
      const innerPlan = extractPlanFromBuffer(decodedBuf);
      if (innerPlan) return innerPlan;
    } catch {
      // ignore
    }
  }

  return undefined;
}

function findPlanInString(text: string): string | undefined {
  // Check Starter / Free tiers first
  if (/\b(?:free-tier|starter-tier|Antigravity Starter(?:\s+Quota)?|Starter Quota)\b/i.test(text)) {
    return 'Antigravity Starter';
  }
  // Check Ultra
  if (/\b(?:g1-ultra-tier|Google\s+(?:One\s+)?AI\s+Ultra|Gemini Ultra)\b/i.test(text)) {
    return 'Google AI Ultra';
  }
  // Check Pro candidates (MUST be specific — never match standalone 'Pro' because model names like 'Gemini 3.1 Pro' contain it!)
  const proCandidates = [
    'Google One AI Premium',
    'Google AI Pro',
    'AI Pro',
    'Gemini Advanced',
    'g1-pro-tier',
  ];
  for (const candidate of proCandidates) {
    const regex = new RegExp(`\\b${candidate}\\b`, 'i');
    if (regex.test(text)) {
      return candidate === 'g1-pro-tier' ? 'Google AI Pro' : candidate;
    }
  }
  return undefined;
}

/**
 * Parses snapshot values to extract identity: email, plan, and fallback fingerprint.
 */
export function parseSnapshot(
  valuesOrOauth?: Record<string, string> | string,
  userStatusValue?: string
): AccountIdentity {
  let oauth: string | undefined;
  let userStatus: string | undefined;

  if (typeof valuesOrOauth === 'object' && valuesOrOauth !== null) {
    oauth = valuesOrOauth[KEYS.oauth] || valuesOrOauth[KEYS.legacyInit] || valuesOrOauth['oauth'];
    userStatus = valuesOrOauth[KEYS.userStatus] || valuesOrOauth['userStatus'];
  } else {
    oauth = valuesOrOauth;
    userStatus = userStatusValue;
  }

  let email: string | undefined;
  let plan: string | undefined;

  // 1. Try extracting email and plan from userStatus
  if (userStatus) {
    const userStatusBuf = b64decode(userStatus);
    email = extractEmailFromBuffer(userStatusBuf);
    plan = extractPlanFromBuffer(userStatusBuf);
  }

  // 2. Fallback to oauthToken if email not found
  if (!email && oauth) {
    const oauthBuf = b64decode(oauth);
    email = extractEmailFromBuffer(oauthBuf);
  }

  // 3. Compute fingerprint from primary auth value
  const fp = fingerprint(oauth || userStatus || '');

  return {
    email,
    plan,
    fingerprint: fp,
  };
}
