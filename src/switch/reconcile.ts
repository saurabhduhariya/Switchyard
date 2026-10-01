import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { AccountStore, MementoLike } from '../accounts/AccountStore';
import { Logger } from '../util/logger';
import { SwitchResultFile } from './job';

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
  logger: Logger
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
}
