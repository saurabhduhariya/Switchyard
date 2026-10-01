import { beforeEach, describe, expect, it } from 'vitest';
import { AccountStore, MementoLike, SecretStorageLike } from '../../src/accounts/AccountStore';
import { Snapshot } from '../../src/accounts/types';
import { ACCOUNTS_STATE_KEY, ACTIVE_ACCOUNT_STATE_KEY, SECRET_PREFIX } from '../../src/constants';
import { makeSyntheticSessionEntries } from '../fixtures/makeDb';

class FakeSecretStorage implements SecretStorageLike {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  getAll(): Map<string, string> {
    return new Map(this.data);
  }
}

class FakeMemento implements MementoLike {
  private data = new Map<string, any>();

  get<T>(key: string, defaultValue?: T): T {
    if (this.data.has(key)) {
      return this.data.get(key);
    }
    return defaultValue as T;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  getAll(): Map<string, any> {
    return new Map(this.data);
  }
}

describe('accounts/AccountStore', () => {
  let secrets: FakeSecretStorage;
  let state: FakeMemento;
  let store: AccountStore;

  beforeEach(() => {
    secrets = new FakeSecretStorage();
    state = new FakeMemento();
    store = new AccountStore({ secrets, state });
  });

  it('starts with an empty account list and no active account', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.activeId()).toBeUndefined();
  });

  it('upserts an account from snapshot and manages metadata', async () => {
    const rawEntries = makeSyntheticSessionEntries({
      email: 'alex@example.com',
      plan: 'AI Pro',
    });

    const snapshot: Snapshot = {
      values: rawEntries,
      capturedAt: 123456789,
    };

    const meta = await store.upsertFromSnapshot(snapshot, 'Personal');
    expect(meta.email).toBe('alex@example.com');
    expect(meta.label).toBe('Personal');
    expect(meta.plan).toBe('AI Pro');

    const accounts = await store.list();
    expect(accounts.length).toBe(1);
    expect(accounts[0].id).toBe(meta.id);

    const byId = await store.get(meta.id);
    expect(byId).toEqual(meta);

    const byEmail = await store.getByEmail('ALEX@EXAMPLE.COM');
    expect(byEmail).toEqual(meta);
  });

  it('passes exit criterion: Store tests prove tokens never appear in state (only in secrets)', async () => {
    const sensitiveToken = 'SECRET_OAUTH_TOKEN_VALUE_XYZ_999';
    const rawEntries = {
      'antigravityUnifiedStateSync.oauthToken': sensitiveToken,
      'antigravityUnifiedStateSync.userStatus': Buffer.from(
        'synthetic-status-containing-token'
      ).toString('base64'),
    };

    const snapshot: Snapshot = {
      values: rawEntries,
      capturedAt: Date.now(),
    };

    const meta = await store.upsertFromSnapshot(snapshot);

    // 1. Verify secrets storage HAS the snapshot and sensitive token
    const secretKey = `${SECRET_PREFIX}${meta.id}`;
    expect(secrets.has(secretKey)).toBe(true);
    const storedSecret = await secrets.get(secretKey);
    expect(storedSecret).toContain(sensitiveToken);

    // 2. CRITICAL AUDIT: Inspect every byte stored in Memento/state
    const stateMap = state.getAll();
    const stateStringified = JSON.stringify(Array.from(stateMap.entries()));

    // Tokens must NEVER appear in state
    expect(stateStringified).not.toContain(sensitiveToken);
    expect(stateStringified).not.toContain('SECRET_OAUTH_TOKEN');
    expect(stateStringified).not.toContain('synthetic-status-containing-token');

    // Only metadata must be in state
    const accountsInState = state.get<any[]>(ACCOUNTS_STATE_KEY, []);
    expect(accountsInState.length).toBe(1);
    expect(accountsInState[0].id).toBe(meta.id);
    expect(accountsInState[0]).not.toHaveProperty('values');
    expect(accountsInState[0]).not.toHaveProperty('token');
    expect(accountsInState[0]).not.toHaveProperty('oauth');
  });

  it('loads snapshots accurately from secrets', async () => {
    const rawEntries = makeSyntheticSessionEntries({
      email: 'test@domain.org',
    });

    const snapshot: Snapshot = {
      values: rawEntries,
      capturedAt: 55555,
    };

    const meta = await store.upsertFromSnapshot(snapshot);
    const loaded = await store.loadSnapshot(meta.id);

    expect(loaded).toBeDefined();
    expect(loaded?.capturedAt).toBe(55555);
    expect(loaded?.values).toEqual(rawEntries);

    const nonExistent = await store.loadSnapshot('missing-id');
    expect(nonExistent).toBeUndefined();
  });

  it('sets active account and updates lastUsedAt timestamp', async () => {
    const snap1 = { values: makeSyntheticSessionEntries({ email: 'a@test.com' }), capturedAt: 100 };
    const snap2 = { values: makeSyntheticSessionEntries({ email: 'b@test.com' }), capturedAt: 200 };

    const meta1 = await store.upsertFromSnapshot(snap1);
    const meta2 = await store.upsertFromSnapshot(snap2);

    await store.setActive(meta2.id);
    expect(await store.activeId()).toBe(meta2.id);

    const updated2 = await store.get(meta2.id);
    expect(updated2?.lastUsedAt).toBeGreaterThanOrEqual(200);
  });

  it('renames an account label', async () => {
    const snap = { values: makeSyntheticSessionEntries({ email: 'rename@test.com' }), capturedAt: 100 };
    const meta = await store.upsertFromSnapshot(snap, 'Old Label');

    await store.rename(meta.id, 'New Label');

    const updated = await store.get(meta.id);
    expect(updated?.label).toBe('New Label');
  });

  it('removes an account, deletes its secret, and unsets activeId if active', async () => {
    const snap = { values: makeSyntheticSessionEntries({ email: 'del@test.com' }), capturedAt: 100 };
    const meta = await store.upsertFromSnapshot(snap);

    await store.setActive(meta.id);
    expect(await store.activeId()).toBe(meta.id);

    const secretKey = `${SECRET_PREFIX}${meta.id}`;
    expect(secrets.has(secretKey)).toBe(true);

    await store.remove(meta.id);

    // Secret must be deleted
    expect(secrets.has(secretKey)).toBe(false);

    // Account list must be empty
    expect(await store.list()).toEqual([]);

    // Active ID must be cleared
    expect(await store.activeId()).toBeUndefined();
  });

  it('serializes concurrent mutations safely without race conditions', async () => {
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        store.upsertFromSnapshot({
          values: makeSyntheticSessionEntries({ email: `user${i}@concurrency.com` }),
          capturedAt: Date.now() + i,
        })
      );
    }

    await Promise.all(promises);

    const accounts = await store.list();
    expect(accounts.length).toBe(10);
  });

  it('saveSnapshot synchronizes account fingerprint and plan in metadata', async () => {
    const initialSnap = {
      values: makeSyntheticSessionEntries({ email: 'rotate@test.com', plan: 'AI Pro' }),
      capturedAt: 100,
    };
    const meta = await store.upsertFromSnapshot(initialSnap);
    const initialFp = meta.fingerprint;

    // Simulate rotation with new auth value
    const rotatedSnap = {
      values: makeSyntheticSessionEntries({
        email: 'rotate@test.com',
        plan: 'Gemini Advanced',
        token: 'rotated-token-99',
      }),
      capturedAt: 200,
    };
    await store.saveSnapshot(meta.id, rotatedSnap);

    const updated = await store.get(meta.id);
    expect(updated).toBeDefined();
    expect(updated!.plan).toBe('Gemini Advanced');
    // Fingerprint must be updated and non-empty
    expect(updated!.fingerprint).toBeDefined();
    expect(updated!.fingerprint).not.toBe(initialFp);
  });

  it('updateMeta modifies arbitrary metadata fields safely', async () => {
    const snap = {
      values: makeSyntheticSessionEntries({ email: 'updatemeta@test.com' }),
      capturedAt: 100,
    };
    const meta = await store.upsertFromSnapshot(snap);

    await store.updateMeta(meta.id, { label: 'Updated Label', fingerprint: 'custom-fp-99' });
    const updated = await store.get(meta.id);
    expect(updated?.label).toBe('Updated Label');
    expect(updated?.fingerprint).toBe('custom-fp-99');
  });
});
