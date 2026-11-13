/**
 * How an account is named in the panel, status bar and quick pick.
 * Shared by the extension host and the webview.
 */

/** Used when emails are hidden and the account has no label yet. */
export const UNLABELLED_ACCOUNT = 'Unlabelled account';

/**
 * The account's label, otherwise the part of the email before `@`.
 * With `hideEmail`, nothing derived from the email is returned: an unlabelled
 * account shows {@link UNLABELLED_ACCOUNT} instead.
 */
export function accountDisplayName(account: { label?: string; email: string }, hideEmail: boolean): string {
  const label = account.label?.trim();
  if (label) return label;
  if (hideEmail) return UNLABELLED_ACCOUNT;
  return account.email.split('@')[0] || account.email;
}
