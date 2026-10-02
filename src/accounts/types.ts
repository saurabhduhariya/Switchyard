import * as crypto from 'node:crypto';

export interface Snapshot {
  values: Record<string, string>;
  capturedAt: number;
}

export interface ModelQuotaGroup {
  name: string; // "Gemini" | "Claude + GPT"
  weeklyRemaining?: number; // percentage (e.g. 76.42)
  weeklyResetTime?: string; // ISO string e.g. "2026-10-02T14:36:41Z"
  rolling5hRemaining?: number;
  rolling5hResetTime?: string;
}

export interface AccountQuotaSummary {
  tierName: string; // e.g. "Google AI Pro Quota"
  gemini: ModelQuotaGroup;
  claudeGpt: ModelQuotaGroup;
  updatedAt: number; // epoch ms
  source: 'live' | 'cache' | 'vscdb';
}

export interface AccountMeta {
  id: string; // sha256(email.toLowerCase()).slice(0, 16)
  email: string;
  label?: string;
  plan?: string;
  addedAt: number;
  lastUsedAt?: number;
  fingerprint: string;
  pinned?: boolean;
  quota?: AccountQuotaSummary;
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
