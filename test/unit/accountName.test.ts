import { describe, it, expect } from 'vitest';
import { accountDisplayName, UNLABELLED_ACCOUNT } from '../../src/shared/accountName';

describe('accountDisplayName', () => {
  it('prefers the label', () => {
    expect(accountDisplayName({ label: 'Work', email: 'jane@example.com' }, false)).toBe('Work');
    expect(accountDisplayName({ label: 'Work', email: 'jane@example.com' }, true)).toBe('Work');
  });

  it('falls back to the part before @ when emails are shown', () => {
    expect(accountDisplayName({ email: 'jane@example.com' }, false)).toBe('jane');
  });

  it('never reveals any part of the email when emails are hidden', () => {
    const name = accountDisplayName({ label: '  ', email: 'jane@example.com' }, true);
    expect(name).toBe(UNLABELLED_ACCOUNT);
    expect(name).not.toContain('jane');
  });
});
