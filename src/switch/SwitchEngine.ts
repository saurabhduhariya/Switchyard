import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { Logger } from '../util/logger';
import { ProfileEngine } from './ProfileEngine';

export interface SwitchResult {
  ok: boolean;
  mode: 'profile' | 'tokenSwap';
  message?: string;
  error?: string;
}

export interface SwitchOptions {
  folders?: string[];
}

export interface CopySettingsResult {
  ok: boolean;
  count: number;
  error?: string;
}

export interface SwitchEngine {
  readonly mode: 'profile' | 'tokenSwap';
  switchTo(accountId: string, options?: SwitchOptions): Promise<SwitchResult>;
  copySettingsToProfile?(accountId: string): Promise<CopySettingsResult>;
  getProfileDir?(accountId: string): string;
  revealProfile?(accountId: string): Promise<void>;
}

export interface SwitchEngineDeps {
  store: AccountStore;
  logger: Logger;
  globalStorageUri: vscode.Uri;
  extensionUri?: vscode.Uri;
  memento: MementoLike;
}

export function createSwitchEngine(
  mode: 'profile' | 'tokenSwap',
  deps: SwitchEngineDeps
): SwitchEngine {
  if (mode === 'profile') {
    return new ProfileEngine(deps);
  }
  // TokenSwapEngine will be implemented in Phase 6
  throw new Error(`Mode "${mode}" will be available in Phase 6. Falling back to Profile mode.`);
}
