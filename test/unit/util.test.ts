import { describe, expect, it } from 'vitest';
import { Logger, OutputChannelLike } from '../../src/util/logger';
import { Mutex } from '../../src/util/mutex';
import { redact } from '../../src/util/redact';

class MemoryOutputChannel implements OutputChannelLike {
  public lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }
}

describe('util/redact', () => {
  it('redacts Google OAuth access tokens', () => {
    const raw = 'Request failed with token ya29.synthetic-sample-token-abc123xyz and more text';
    expect(redact(raw)).toBe('Request failed with token ya29.*** and more text');
  });

  it('redacts Google refresh tokens', () => {
    const raw = 'Refresh token is 1//0gV4f7-sample_refresh_token_here_end';
    expect(redact(raw)).toBe('Refresh token is 1//***');
  });

  it('redacts Bearer authorization headers', () => {
    const raw = 'Authorization: Bearer secret-bearer-token-12345';
    expect(redact(raw)).toBe('Authorization: Bearer ***');
  });

  it('redacts long base64 blobs', () => {
    const b64 = 'CsOrAQoVdXNlclN0YXR1c1NlbnRpbmVsS2V5EqirAQqkqwFHaE';
    const raw = `Payload: ${b64}`;
    const redacted = redact(raw);
    expect(redacted).not.toContain(b64);
    expect(redacted).toContain('[REDACTED_B64_50]');
  });

  it('optionally masks email addresses', () => {
    const raw = 'Contact user@example.com for assistance';
    expect(redact(raw, { redactEmail: true })).toBe('Contact u***@example.com for assistance');
  });
});

describe('util/logger', () => {
  it('writes to output channel with automatic token redaction', () => {
    const channel = new MemoryOutputChannel();
    const logger = new Logger(channel);

    logger.info('User authenticated with ya29.token123 and 1//refresh456');
    logger.error('Error with token:', 'ya29.secretErrorToken');

    expect(channel.lines.length).toBe(2);
    expect(channel.lines[0]).toContain('[INFO]');
    expect(channel.lines[0]).not.toContain('ya29.token123');
    expect(channel.lines[0]).toContain('ya29.***');
    expect(channel.lines[0]).not.toContain('1//refresh456');
    expect(channel.lines[0]).toContain('1//***');

    expect(channel.lines[1]).toContain('[ERROR]');
    expect(channel.lines[1]).not.toContain('ya29.secretErrorToken');
  });

  it('passes lint-style test: logger never leaks raw snapshot object tokens', () => {
    const channel = new MemoryOutputChannel();
    const logger = new Logger(channel);

    const snapshot = {
      values: {
        'antigravityUnifiedStateSync.oauthToken': 'ya29.leakedTokenValue12345',
        'antigravityUnifiedStateSync.userStatus': 'CsOrAQoVdXNlclN0YXR1c1NlbnRpbmVsS2V5EqirAQqkqwFHaE',
      },
      capturedAt: 123456,
    };

    logger.debug('Captured snapshot:', snapshot);

    const fullLog = channel.lines.join('\n');
    expect(fullLog).not.toContain('ya29.leakedTokenValue12345');
    expect(fullLog).not.toContain('CsOrAQoVdXNlclN0YXR1c1NlbnRpbmVsS2V5EqirAQqkqwFHaE');
  });
});

describe('util/mutex', () => {
  it('serializes operations and prevents race conditions', async () => {
    const mutex = new Mutex();
    let counter = 0;
    const executionOrder: number[] = [];

    const task = async (id: number, delayMs: number) => {
      await mutex.runExclusive(async () => {
        const current = counter;
        executionOrder.push(id);
        await new Promise((r) => setTimeout(r, delayMs));
        counter = current + 1;
      });
    };

    await Promise.all([
      task(1, 30),
      task(2, 20),
      task(3, 10),
    ]);

    expect(counter).toBe(3);
    expect(executionOrder).toEqual([1, 2, 3]);
  });
});
