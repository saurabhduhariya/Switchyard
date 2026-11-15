import * as crypto from 'node:crypto';

export interface Snapshot {
  values: Record<string, string>;
  capturedAt: number;
}

export interface QuotaBucket {
  remainingFraction?: number;
  remainingPercent?: number;
  resetTime?: string;
  disabled?: boolean;
}

export interface ModelQuotaGroup {
  name: string;
  weekly?: QuotaBucket;
  fiveHour?: QuotaBucket;
  weeklyRemaining?: number;
  weeklyResetTime?: string;
  rolling5hRemaining?: number;
  rolling5hResetTime?: string;
}

export interface AccountQuotaSummary {
  tierName: string;
  gemini: ModelQuotaGroup;
  claudeGpt: ModelQuotaGroup;
  updatedAt: number;
  source: 'live' | 'cache' | 'vscdb';
}

export interface AccountMeta {
  id: string;
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
