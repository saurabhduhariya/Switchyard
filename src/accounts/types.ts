import * as crypto from 'node:crypto';

export interface Snapshot {
  values: Record<string, string>;
  capturedAt: number;
}

export interface AccountMeta {
  id: string; // sha256(email.toLowerCase()).slice(0, 16)
  email: string;
  label?: string;
  plan?: string;
  addedAt: number;
  lastUsedAt?: number;
  fingerprint: string;
}

export interface AccountIdentity {
  email?: string;
  plan?: string;
  fingerprint: string;
}

/**
 * Creates a stable 16-character account ID from an email address.
 */
export function createAccountId(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
}
