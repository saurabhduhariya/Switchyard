import { describe, it, expect } from 'vitest';
import { describeQuotaError, QuotaCollector } from '../../src/quota/QuotaCollector';
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
        weekly: {
          remainingFraction: 0.7642,
          remainingPercent: 76.42,
          resetTime: '2026-10-05T00:00:00Z',
          disabled: false,
        },
        fiveHour: {
          remainingFraction: 0.9529,
          remainingPercent: 95.29,
          resetTime: '2026-10-02T22:00:00Z',
          disabled: false,
        },
        weeklyRemaining: 76.42,
        weeklyResetTime: '2026-10-05T00:00:00Z',
        rolling5hRemaining: 95.29,
        rolling5hResetTime: '2026-10-02T22:00:00Z',
      },
      claudeGpt: {
        name: 'Claude + GPT',
        weekly: {
          remainingFraction: 0,
          remainingPercent: 0,
          resetTime: '2026-10-08T00:00:00Z',
          disabled: false,
        },
        fiveHour: {
          disabled: true,
        },
        weeklyRemaining: 0,
        weeklyResetTime: '2026-10-08T00:00:00Z',
      },
      updatedAt: 12345678,
      source: 'live',
    });

    const updated = await store.get('acc1');
    expect(updated?.quota?.tierName).toBe('Google AI Pro Quota');
    expect(updated?.quota?.gemini.weekly?.remainingPercent).toBe(76.42);
    expect(updated?.quota?.gemini.fiveHour?.remainingPercent).toBe(95.29);
    expect(updated?.quota?.gemini.weeklyRemaining).toBe(76.42);
    expect(updated?.quota?.gemini.rolling5hRemaining).toBe(95.29);
    expect(updated?.quota?.claudeGpt.weekly?.remainingPercent).toBe(0);
    expect(updated?.quota?.claudeGpt.fiveHour?.disabled).toBe(true);
    expect(updated?.quota?.source).toBe('live');
  });

  it('correctly parses RetrieveUserQuotaSummary payload into weekly and 5h buckets', () => {
    const collector = new QuotaCollector();
    const rawDto = {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.645962,
              resetTime: '2026-10-03T09:36:57Z',
            },
            {
              bucketId: 'gemini-5h',
              displayName: 'Five Hour Limit Remaining',
              window: '5h',
              remainingFraction: 0.9529025,
              resetTime: '2026-10-02T21:31:30Z',
            },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0,
              resetTime: '2026-10-08T11:26:16Z',
            },
            {
              bucketId: '3p-5h',
              displayName: 'Five Hour Limit Remaining',
              window: '5h',
              remainingFraction: 1,
              disabled: true,
              resetTime: '2026-10-02T21:35:12Z',
            },
          ],
        },
      ],
    };

    // Access private method for testing unit parser
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (collector as any).parseQuotaSummaryResponse(rawDto, 'Google AI Pro', 'live');

    expect(parsed.tierName).toBe('Google AI Pro Quota');
    expect(parsed.source).toBe('live');

    // Gemini assertions
    expect(parsed.gemini.weekly?.remainingPercent).toBe(64.6);
    expect(parsed.gemini.weekly?.resetTime).toBe('2026-10-03T09:36:57Z');
    expect(parsed.gemini.weekly?.disabled).toBe(false);
    expect(parsed.gemini.fiveHour?.remainingPercent).toBe(95.29);
    expect(parsed.gemini.fiveHour?.resetTime).toBe('2026-10-02T21:31:30Z');
    expect(parsed.gemini.fiveHour?.disabled).toBe(false);
    expect(parsed.gemini.weeklyRemaining).toBe(64.6);
    expect(parsed.gemini.rolling5hRemaining).toBe(95.29);

    // Claude + GPT assertions
    expect(parsed.claudeGpt.weekly?.remainingPercent).toBe(0);
    expect(parsed.claudeGpt.weekly?.resetTime).toBe('2026-10-08T11:26:16Z');
    expect(parsed.claudeGpt.weekly?.disabled).toBe(false);
    expect(parsed.claudeGpt.fiveHour?.disabled).toBe(true);
    expect(parsed.claudeGpt.rolling5hRemaining).toBeUndefined();
  });
});

describe('QuotaCollector.getQuotaResult (why a read failed)', () => {
  const fakeQuota: any = { tierName: 'Google AI Pro Quota', updatedAt: 1, source: 'live', gemini: { name: 'Gemini' }, claudeGpt: { name: 'Claude + GPT' } };

  function collectorWith(opts: { endpoint?: unknown; request?: () => Promise<unknown>; db?: () => Promise<unknown> }) {
    const c: any = new QuotaCollector();
    c.getOrDiscoverEndpoint = async () => opts.endpoint;
    c.requestLiveQuota = opts.request ?? (async () => undefined);
    c.loadFromDb = opts.db ?? (async () => undefined);
    return c as QuotaCollector;
  }

  it('returns the numbers when the language server answers', async () => {
    const c = collectorWith({ endpoint: { port: 1, token: 't' }, request: async () => fakeQuota });
    expect(await c.getQuotaResult()).toEqual({ quota: fakeQuota });
  });

  it('says the language server is not running when it cannot be found', async () => {
    const c = collectorWith({ endpoint: undefined });
    const r = await c.getQuotaResult('/x/state.vscdb');
    expect(r.quota).toBeUndefined();
    expect(r.error?.kind).toBe('no-language-server');
  });

  it('says the request failed when the language server is there but errors out', async () => {
    const c = collectorWith({
      endpoint: { port: 1, token: 'super-secret-csrf' },
      request: async () => {
        throw new Error('ECONNRESET super-secret-csrf');
      },
    });
    const r = await c.getQuotaResult();
    expect(r.error?.kind).toBe('request-failed');
    expect(JSON.stringify(r)).not.toContain('super-secret-csrf'); // raw error text is never returned
  });

  it('says there is no data when the language server answers with nothing', async () => {
    const c = collectorWith({ endpoint: { port: 1, token: 't' }, request: async () => undefined });
    expect((await c.getQuotaResult()).error?.kind).toBe('no-data');
  });

  it('falls back to the database, and then there is no error', async () => {
    const c = collectorWith({ endpoint: undefined, db: async () => ({ ...fakeQuota, source: 'vscdb' }) });
    const r = await c.getQuotaResult('/x/state.vscdb');
    expect(r.quota?.source).toBe('vscdb');
    expect(r.error).toBeUndefined();
  });

  it('keeps the live failure reason when the database fallback fails too', async () => {
    const c = collectorWith({
      endpoint: { port: 1, token: 't' },
      request: async () => {
        throw new Error('boom');
      },
      db: async () => {
        throw new Error('db broken');
      },
    });
    expect((await c.getQuotaResult('/x/state.vscdb')).error?.kind).toBe('request-failed');
  });

  it('getQuotaSummary still works and just returns the numbers', async () => {
    const c = collectorWith({ endpoint: { port: 1, token: 't' }, request: async () => fakeQuota });
    expect(await c.getQuotaSummary()).toEqual(fakeQuota);
    expect(await collectorWith({ endpoint: undefined }).getQuotaSummary()).toBeUndefined();
  });

  it('every failure has a plain-language message', () => {
    for (const kind of ['no-language-server', 'request-failed', 'no-data'] as const) {
      const e = describeQuotaError(kind);
      expect(e.kind).toBe(kind);
      expect(e.message.length).toBeGreaterThan(20);
    }
  });
});
