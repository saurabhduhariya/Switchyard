import { ACCOUNTS_STATE_KEY, ACTIVE_ACCOUNT_STATE_KEY, SECRET_PREFIX } from '../constants';
import { Mutex } from '../util/mutex';
import { parseSnapshot } from './identity';
import { AccountMeta, AccountQuotaSummary, createAccountId, Snapshot } from './types';

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface AccountStoreOptions {
  secrets: SecretStorageLike;
  state: MementoLike;
}

/**
 * Manages account metadata and encrypted session snapshots.
 * Metadata is kept in Memento (globalState), session tokens ONLY in SecretStorage.
 * All operations are serialized with an internal Mutex.
 */
export class AccountStore {
  private secrets: SecretStorageLike;
  private state: MementoLike;
  private mutex = new Mutex();

  constructor(options: AccountStoreOptions) {
    this.secrets = options.secrets;
    this.state = options.state;
  }

  /**
   * Lists all saved accounts metadata (never returns session tokens).
   * Automatically normalizes/heals any legacy false-positive "Pro" plans.
   */
  async list(): Promise<AccountMeta[]> {
    return this.mutex.runExclusive(async () => {
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      if (!Array.isArray(accounts)) return [];

      let modified = false;
      for (const account of accounts) {
        if (account.plan === 'Pro') {
          let resolvedPlan = 'Antigravity Starter';
          try {
            const secretKey = `${SECRET_PREFIX}${account.id}`;
            const rawSnap = await this.secrets.get(secretKey);
            if (rawSnap) {
              const snap = JSON.parse(rawSnap);
              const identity = parseSnapshot(snap.values);
              if (identity.plan && identity.plan !== 'Pro') {
                resolvedPlan = identity.plan;
              }
            }
          } catch {
            // ignore
          }
          account.plan = resolvedPlan;
          modified = true;
        }
      }

      if (modified) {
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }

      return [...accounts];
    });
  }

  /**
   * Retrieves account metadata by account ID.
   */
  async get(id: string): Promise<AccountMeta | undefined> {
    const accounts = await this.list();
    return accounts.find((a) => a.id === id);
  }

  /**
   * Retrieves account metadata by email address.
   */
  async getByEmail(email: string): Promise<AccountMeta | undefined> {
    const normalized = email.toLowerCase().trim();
    const accounts = await this.list();
    return accounts.find((a) => a.email.toLowerCase().trim() === normalized);
  }

  /**
   * Retrieves account metadata by session fingerprint.
   */
  async getByFingerprint(fingerprint: string): Promise<AccountMeta | undefined> {
    if (!fingerprint) return undefined;
    const accounts = await this.list();
    return accounts.find((a) => a.fingerprint === fingerprint);
  }

  /**
   * Retrieves the currently active account ID.
   */
  async activeId(): Promise<string | undefined> {
    return this.mutex.runExclusive(async () => {
      return this.state.get<string | undefined>(ACTIVE_ACCOUNT_STATE_KEY, undefined);
    });
  }

  /**
   * Sets the active account ID and updates its lastUsedAt timestamp.
   */
  async setActive(id: string | undefined): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.state.update(ACTIVE_ACCOUNT_STATE_KEY, id);


      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const idx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[idx];
      if (idx !== -1 && existing) {
        accounts[idx] = {
          ...existing,
          lastUsedAt: Date.now(),
        };
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }
    });
  }

  /**
   * Updates an account's lastUsedAt timestamp without modifying activeId.
   */
  async touch(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const idx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[idx];
      if (idx !== -1 && existing) {
        accounts[idx] = {
          ...existing,
          lastUsedAt: Date.now(),
        };
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }
    });
  }

  /**
   * Stores a session snapshot in encrypted secret storage.
   * Tokens NEVER enter Memento/globalState.
   */
  async saveSnapshot(id: string, snapshot: Snapshot): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const secretKey = `${SECRET_PREFIX}${id}`;
      await this.secrets.store(secretKey, JSON.stringify(snapshot));

      const identity = parseSnapshot(snapshot.values);
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const idx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[idx];
      if (idx !== -1 && existing) {
        accounts[idx] = {
          ...existing,
          fingerprint: identity.fingerprint,
          plan: identity.plan || existing.plan,
        };
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }
    });
  }

  /**
   * Updates metadata fields for an existing account.
   */
  async updateMeta(id: string, partial: Partial<AccountMeta>): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const idx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[idx];
      if (idx !== -1 && existing) {
        accounts[idx] = { ...existing, ...partial };
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }
    });
  }

  /**
   * Updates an account's quota summary.
   */
  async updateQuota(id: string, quota: AccountQuotaSummary): Promise<void> {
    return this.updateMeta(id, { quota });
  }

  /**
   * Loads a session snapshot from encrypted secret storage.
   */
  async loadSnapshot(id: string): Promise<Snapshot | undefined> {
    return this.mutex.runExclusive(async () => {
      const secretKey = `${SECRET_PREFIX}${id}`;
      const raw = await this.secrets.get(secretKey);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as Snapshot;
      } catch {
        return undefined;
      }
    });
  }

  /**
   * Upserts an account from a session snapshot.
   * Extracts identity, stores snapshot in SecretStorage, and updates AccountMeta in state.
   */
  async upsertFromSnapshot(snapshot: Snapshot, label?: string): Promise<AccountMeta> {
    return this.mutex.runExclusive(async () => {
      const identity = parseSnapshot(snapshot.values);
      const email = identity.email || `unknown-${identity.fingerprint}@switchyard.local`;
      const id = identity.email ? createAccountId(identity.email) : `fp-${identity.fingerprint}`;

      // 1. Save snapshot in secrets
      const secretKey = `${SECRET_PREFIX}${id}`;
      await this.secrets.store(secretKey, JSON.stringify(snapshot));

      // 2. Update metadata in state
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const existingIdx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[existingIdx];
      const now = Date.now();

      let meta: AccountMeta;
      if (existingIdx !== -1 && existing) {
        meta = {
          ...existing,
          plan: identity.plan || existing.plan,
          fingerprint: identity.fingerprint,
          lastUsedAt: now,
          ...(label ? { label } : {}),
        };
        accounts[existingIdx] = meta;
      } else {
        meta = {
          id,
          email,
          label,
          plan: identity.plan,
          addedAt: now,
          lastUsedAt: now,
          fingerprint: identity.fingerprint,
        };
        accounts.push(meta);
      }

      await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      return meta;
    });
  }

  /**
   * Renames the display label of an account.
   */
  async rename(id: string, label: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const idx = accounts.findIndex((a) => a.id === id);
      const existing = accounts[idx];
      if (idx !== -1 && existing) {
        accounts[idx] = { ...existing, label: label.trim() || undefined };
        await this.state.update(ACCOUNTS_STATE_KEY, accounts);
      }
    });
  }

  /**
   * Removes an account from state and deletes its snapshot from secrets.
   */
  async remove(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      // 1. Delete secret
      const secretKey = `${SECRET_PREFIX}${id}`;
      await this.secrets.delete(secretKey);

      // 2. Remove from metadata list
      const accounts = this.state.get<AccountMeta[]>(ACCOUNTS_STATE_KEY, []);
      const filtered = accounts.filter((a) => a.id !== id);
      await this.state.update(ACCOUNTS_STATE_KEY, filtered);

      // 3. Clear activeId if the removed account was active
      const active = this.state.get<string | undefined>(ACTIVE_ACCOUNT_STATE_KEY, undefined);
      if (active === id) {
        await this.state.update(ACTIVE_ACCOUNT_STATE_KEY, undefined);
      }
    });
  }
}
