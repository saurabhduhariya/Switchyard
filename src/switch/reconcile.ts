import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { Logger } from '../util/logger';
import { SwitchResultFile } from './job';
import { parseSnapshot } from '../accounts/identity';
import { readKeys } from '../db/StateDb';
import { KEYS } from '../constants';

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
  if (pending.resultFile && fs.existsSync(pending.resultFile)) {
    try {
      const raw = fs.readFileSync(pending.resultFile, 'utf8');
      resultFileContent = JSON.parse(raw) as SwitchResultFile;
    } catch (err) {
      logger.warn(`Failed to parse resultFile ${pending.resultFile}:`, err);
    } finally {
      try {
        fs.rmSync(pending.resultFile, { force: true });
      } catch {
        // ignore
      }
    }
  }

  if (resultFileContent?.ok) {
    // Verify that the live state.vscdb fingerprint matches the target account
    const targetAccount = await store.get(pending.targetId);
    if (targetAccount && dbPath) {
      try {
        const liveSnapshot = await readKeys(dbPath, [KEYS.oauth, KEYS.userStatus]);
        const liveIdentity = parseSnapshot(liveSnapshot);

        if (liveIdentity.fingerprint !== targetAccount.fingerprint) {
          logger.warn(
            `Fingerprint mismatch after switch! Expected ${targetAccount.fingerprint}, got ${liveIdentity.fingerprint}`
          );
          const choice = await vscode.window.showWarningMessage(
            `Switchyard: Account switch completed, but verification detected a mismatch. The IDE may still be on the previous account.`,
            'Retry Switch',
            'Dismiss'
          );
          if (choice === 'Retry Switch') {
            // Trigger switch command again
            void vscode.commands.executeCommand('switchyard.switchToAccount', pending.targetId);
          }
          return;
        }
      } catch (err) {
        logger.warn('Failed to verify fingerprint after switch:', err);
        // Continue anyway - the helper process reported success
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
    const choice = await vscode.window.showErrorMessage(
      `Switchyard: Failed to switch to ${pending.targetEmail}: ${err}`,
      'Restore Backup'
    );
    if (choice === 'Restore Backup') {
      void vscode.commands.executeCommand('switchyard.restoreBackup');
    }
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

  if (addingState?.resultFile && fs.existsSync(addingState.resultFile)) {
    try {
      const raw = fs.readFileSync(addingState.resultFile, 'utf8');
      const result = JSON.parse(raw) as SwitchResultFile;
      if (!result.ok) {
        const err = result.error || 'Unknown error while signing out';
        logger.error(`Sign out for adding account failed: ${err}`);
        const choice = await vscode.window.showErrorMessage(
          `Switchyard: Failed to sign out current session: ${err}`,
          'Restore Backup'
        );
        if (choice === 'Restore Backup') {
          void vscode.commands.executeCommand('switchyard.restoreBackup');
        }
      }
    } catch (err) {
      logger.warn('Failed to parse addingAccount resultFile:', err);
    } finally {
      try {
        fs.rmSync(addingState.resultFile, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

