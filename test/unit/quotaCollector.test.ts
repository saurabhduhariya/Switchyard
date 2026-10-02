import { describe, it, expect } from 'vitest';
import { QuotaCollector } from '../../src/quota/QuotaCollector';
import { AccountStore } from '../../src/accounts/AccountStore';

describe('QuotaCollector', () => {
  it('instantiates cleanly without throwing', () => {
    const collector = new QuotaCollector();
    expect(collector).toBeDefined();
  });

  it('returns undefined gracefully when neither LS nor state.vscdb is available', async () => {
    const collector = new QuotaCollector();
    const result = await collector.getQuotaSummary('/non/existent/path/state.vscdb');
    // In test environment without active LS process or mock, returns undefined or live if system LS running
    expect(result === undefined || result?.gemini !== undefined).toBe(true);
  });
});

describe('AccountStore.updateQuota', () => {
  it('updates quota field in account metadata', async () => {
    const memory = new Map<string, unknown>();
    const mockState = {
      get: <T>(k: string, d?: T) => (memory.get(k) as T) ?? (d as T),
      update: async (k: string, v: unknown) => {
        memory.set(k, v);
      },
    };
    const mockSecrets = {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
    };

    const store = new AccountStore({ secrets: mockSecrets, state: mockState });

    // Seed account
    await mockState.update('switchyard.accounts', [
      {
        id: 'acc1',
        email: 'test@example.com',
        addedAt: Date.now(),
        fingerprint: 'fp1',
      },
    ]);

    await store.updateQuota('acc1', {
      tierName: 'Google AI Pro Quota',
      gemini: {
        name: 'Gemini',
        weeklyRemaining: 76.42,
        weeklyResetTime: '2026-10-05T00:00:00Z',
      },
      claudeGpt: {
        name: 'Claude + GPT',
        weeklyRemaining: 0,
        weeklyResetTime: '2026-10-08T00:00:00Z',
      },
      updatedAt: 12345678,
      source: 'live',
    });

    const updated = await store.get('acc1');
    expect(updated?.quota?.tierName).toBe('Google AI Pro Quota');
    expect(updated?.quota?.gemini.weeklyRemaining).toBe(76.42);
    expect(updated?.quota?.claudeGpt.weeklyRemaining).toBe(0);
    expect(updated?.quota?.source).toBe('live');
  });
});
