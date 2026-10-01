import { describe, it, expect } from 'vitest';

// We'll import from the webview lib path directly
// since it's a pure function with no dependencies
import { maskEmail } from '../../webview/src/lib/maskEmail';

describe('maskEmail', () => {
  it('masks a standard email', () => {
    expect(maskEmail('rahul@gmail.com')).toBe('r****@gmail.com');
  });

  it('masks a long local part', () => {
    expect(maskEmail('saurabhduhariya2007@gmail.com')).toBe('s****@gmail.com');
  });

  it('masks a short local part (2 chars)', () => {
    expect(maskEmail('ab@test.com')).toBe('a*@test.com');
  });

  it('handles a single-char local part', () => {
    expect(maskEmail('a@test.com')).toBe('a****@test.com');
  });

  it('returns as-is if no @ sign', () => {
    expect(maskEmail('noemail')).toBe('noemail');
  });

  it('returns as-is if @ is at position 0', () => {
    expect(maskEmail('@domain.com')).toBe('@domain.com');
  });

  it('masks with exactly 4 stars for 5-char local', () => {
    expect(maskEmail('hello@world.com')).toBe('h****@world.com');
  });

  it('masks with 3 stars for 4-char local', () => {
    expect(maskEmail('test@x.io')).toBe('t***@x.io');
  });
});
