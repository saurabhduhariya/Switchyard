import * as vscode from 'vscode';
import { AuthDetector } from '../accounts/AuthDetector';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { Logger } from '../util/logger';
import { ProfileEngine } from './ProfileEngine';
import { TokenSwapEngine } from './TokenSwapEngine';

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

export interface SignOutAndRestartOptions {
  previousId?: string;
  previousEmail?: string;
  folders?: string[];
  expectedEmail?: string;
}

export interface SwitchEngine {
  readonly mode: 'profile' | 'tokenSwap';
  switchTo(accountId: string, options?: SwitchOptions): Promise<SwitchResult>;
  signOutAndRestart?(options?: SignOutAndRestartOptions): Promise<SwitchResult>;
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
  dbPath?: string;
  detector?: AuthDetector;
}

export function createSwitchEngine(
  mode: 'profile' | 'tokenSwap',
  deps: SwitchEngineDeps
): SwitchEngine {
  if (mode === 'tokenSwap') {
    return new TokenSwapEngine(deps);
  }
  return new ProfileEngine(deps);
}
