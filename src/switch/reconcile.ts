import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { Logger } from '../util/logger';
import { SwitchResultFile } from './job';
import { parseSnapshot } from '../accounts/identity';
import { readKeys } from '../db/StateDb';
import { KEYS } from '../constants';
import { readKeychainToken } from '../platform/keychain';
import { isWsl, toWindowsPath } from '../platform/wsl';

function resolveExistingResultFile(resultFile?: string): string | undefined {
  if (!resultFile) return undefined;
  if (fs.existsSync(resultFile)) return resultFile;

  // Cross-OS fallback in case Switchyard runs on the opposite side of a Windows<->WSL bridge
  if (process.platform === 'win32' && resultFile.startsWith('/mnt/')) {
    const winMatch = resultFile.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (winMatch?.[1] && winMatch[2] !== undefined) {
      const winPath = `${winMatch[1].toUpperCase()}:\\${winMatch[2].replace(/\//g, '\\')}`;
      if (fs.existsSync(winPath)) return winPath;
    }
  } else if (isWsl()) {
    const driveMatch = resultFile.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (driveMatch?.[1] && driveMatch[2] !== undefined) {
      const wslPath = `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, '/')}`;
      if (fs.existsSync(wslPath)) return wslPath;
    }
    const winConverted = toWindowsPath(resultFile);
    if (winConverted !== resultFile && fs.existsSync(winConverted)) return winConverted;
  }
  return undefined;
}

/**
 * Displays a VS Code action notification without blocking callers on user dismissal,
 * while still draining microtasks so pre-resolved promises run before returning.
 */
async function promptAction(
  prompt: Thenable<string | undefined>,
  onChoice: (choice: string | undefined) => void
): Promise<void> {
  void Promise.resolve(prompt).then(onChoice, () => {
    // Ignore errors from dismissed or cancelled VS Code notifications
  });
  await Promise.resolve();
  await Promise.resolve();
}

async function offerRestoreBackup(message: string): Promise<void> {
  await promptAction(vscode.window.showErrorMessage(message, 'Restore Backup'), (choice) => {
    if (choice === 'Restore Backup') {
      void vscode.commands.executeCommand('switchyard.restoreBackup');
    }
  });
}

export interface PendingSwitchState {
  targetId: string;
  targetEmail: string;
  resultFile: string;
  startedAt: number;
}

/**
 * Reconciles any pending token-swap after the IDE restarts.
 * Inspects resultFile, sets active account on success, or offers backup restore on error.
 */
export async function reconcilePendingSwitch(
  memento: MementoLike,
  store: AccountStore,
  logger: Logger,
  dbPath?: string
): Promise<void> {
  const pending = memento.get<PendingSwitchState | undefined>(
    'switchyard.pendingSwitch',
    undefined
  );
  if (!pending) {
    return;
  }

  // Clear pending state immediately to prevent repeated reconciliation
  await memento.update('switchyard.pendingSwitch', undefined);

  logger.info(`Reconciling pending switch for ${pending.targetEmail}...`);

  let resultFileContent: SwitchResultFile | undefined;
  const resolvedResultFile = resolveExistingResultFile(pending.resultFile);
  if (resolvedResultFile) {
    try {
      const raw = fs.readFileSync(resolvedResultFile, 'utf8');
      resultFileContent = JSON.parse(raw) as SwitchResultFile;
    } catch (err) {
      logger.warn(`Failed to parse resultFile ${resolvedResultFile}:`, err);
    } finally {
      try {
        fs.rmSync(resolvedResultFile, { force: true });
      } catch {
        // ignore
      }
    }
  }

  if (resultFileContent?.ok) {
    const targetAccount = await store.get(pending.targetId);
    if (targetAccount) {
      try {
        const liveKeychain = readKeychainToken();
        const liveValues: Record<string, string> = {};
        if (liveKeychain) {
          liveValues[KEYS.keychainToken] = liveKeychain;
        } else if (dbPath) {
          const dbSnap = await readKeys(dbPath, [KEYS.oauth, KEYS.userStatus]);
          Object.assign(liveValues, dbSnap);
        }
        const liveIdentity = parseSnapshot(liveValues);
        const fpMatches = liveIdentity.fingerprint === targetAccount.fingerprint;
        const liveEmail = liveIdentity.email?.toLowerCase().trim();
        const targetEmail = targetAccount.email?.toLowerCase().trim();
        const emailMatches = Boolean(liveEmail && targetEmail && liveEmail === targetEmail);
        const emailConflicts = Boolean(liveEmail && targetEmail && liveEmail !== targetEmail);
        if (emailConflicts || (!fpMatches && !emailMatches)) {
          logger.warn(
            `Post-switch verification mismatch! Expected ${targetAccount.email} (${targetAccount.fingerprint}), got ${liveIdentity.email ?? 'unknown'} (${liveIdentity.fingerprint})`
          );
          await promptAction(
            vscode.window.showWarningMessage(
              `Switchyard: Account switch completed, but verification detected a mismatch. The IDE may still be on the previous account.`,
              'Retry Switch',
              'Dismiss'
            ),
            (choice) => {
              if (choice === 'Retry Switch') {
                void vscode.commands.executeCommand('switchyard.switchAccount', pending.targetId);
              }
            }
          );
          return;
        }
      } catch (err) {
        logger.warn('Failed to verify fingerprint after switch:', err);
      }
    }
    await store.setActive(pending.targetId);
    logger.info(`Successfully reconciled switch to account: ${pending.targetEmail}`);
    void vscode.window.showInformationMessage(
      `Switched to account ${pending.targetEmail}`
    );
  } else if (resultFileContent && !resultFileContent.ok) {
    const err = resultFileContent.error || 'Unknown error during token swap';
    logger.error(`Switch to ${pending.targetEmail} failed: ${err}`);
    await offerRestoreBackup(`Switchyard: Failed to switch to ${pending.targetEmail}: ${err}`);
  } else {
    // Result file missing (e.g. process died before helper ran or quit was cancelled)
    const elapsed = Date.now() - (pending.startedAt || 0);
    if (elapsed > 15_000) {
      logger.warn(`Pending switch to ${pending.targetEmail} did not produce a result file.`);
      void vscode.window.showWarningMessage(
        `Switchyard: Account switch to ${pending.targetEmail} did not complete.`
      );
    }
  }

  // Also reconcile addingAccount sign-out state if present
  const addingState = memento.get<
    { resultFile?: string; previousEmail?: string } | undefined
  >('switchyard.addingAccount', undefined);

  const resolvedAddingResult = resolveExistingResultFile(addingState?.resultFile);
  if (resolvedAddingResult) {
    try {
      const raw = fs.readFileSync(resolvedAddingResult, 'utf8');
      const result = JSON.parse(raw) as SwitchResultFile;
      if (!result.ok) {
        const err = result.error || 'Unknown error while signing out';
        logger.error(`Sign out for adding account failed: ${err}`);
        await offerRestoreBackup(`Switchyard: Failed to sign out current session: ${err}`);
      }
    } catch (err) {
      logger.warn('Failed to parse addingAccount resultFile:', err);
    } finally {
      try {
        fs.rmSync(resolvedAddingResult, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

