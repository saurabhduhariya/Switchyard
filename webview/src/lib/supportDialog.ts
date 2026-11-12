/**
 * Small DOM helpers for the support dialog, kept framework-free so they can be
 * unit tested without a browser.
 */

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export type CopyResult = 'copied' | 'failed';

/** Copies text with the webview's clipboard API. Never throws. */
export async function copyText(text: string, clipboard: ClipboardLike | undefined): Promise<CopyResult> {
  if (!text || !clipboard || typeof clipboard.writeText !== 'function') return 'failed';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export interface DialogLike {
  open: boolean;
  showModal(): void;
  close(): void;
}

/** Opens a native `<dialog>` as modal (focus is trapped, Escape closes it). */
export function openDialog(dialog: DialogLike | undefined): void {
  if (dialog && !dialog.open) dialog.showModal();
}

/** Closes the dialog and returns focus to the element that opened it. */
export function closeDialog(dialog: DialogLike | undefined, returnFocusTo?: { focus(): void } | null): void {
  if (dialog?.open) dialog.close();
  returnFocusTo?.focus();
}

/**
 * True when a click landed on the backdrop. The dialog's content fills the
 * dialog box, so a click whose target is the dialog element itself is outside it.
 */
export function isBackdropClick(target: unknown, dialog: unknown): boolean {
  return target !== null && target !== undefined && target === dialog;
}
