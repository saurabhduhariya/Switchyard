import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDetectActive = vi.fn();

vi.mock('../../src/accounts/AuthDetector', () => {
  return {
    AuthDetector: class {
      detectActive = mockDetectActive;
    },
  };
});

import { CaptureWatcher } from '../../src/capture/CaptureWatcher';
import { Logger } from '../../src/util/logger';

describe('capture/CaptureWatcher', () => {
  let tmpDir: string;
  let dbPath: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-watcher-test-'));
    dbPath = path.join(tmpDir, 'state.vscdb');
    fs.writeFileSync(dbPath, 'dummy-db');
    logger = new Logger({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as any);
    mockDetectActive.mockReset();
  });

  it('requires two consecutive matching reads to trigger detection callback (double-read debounce)', async () => {
    const watcher = new CaptureWatcher(dbPath, logger);
    const callback = vi.fn();
    watcher.onDetection(callback);

    const testIdentity = {
      email: 'newuser@example.com',
      fingerprint: 'fp-12345',
    };
    const dummySnapshot = { values: {}, capturedAt: Date.now() };

    // First read returns identity
    mockDetectActive.mockResolvedValueOnce({
      identity: testIdentity,
      snapshot: dummySnapshot,
    });

    // Second read returns identical identity
    mockDetectActive.mockResolvedValueOnce({
      identity: testIdentity,
      snapshot: dummySnapshot,
    });

    // Poll 1
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).not.toHaveBeenCalled();

    // Poll 2
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).toHaveBeenCalledWith(testIdentity, dummySnapshot);
  });

  it('resets debounce counter if identity changes between reads', async () => {
    const watcher = new CaptureWatcher(dbPath, logger);
    const callback = vi.fn();
    watcher.onDetection(callback);

    const dummySnapshot = { values: {}, capturedAt: Date.now() };

    // Poll 1: user1
    mockDetectActive.mockResolvedValueOnce({
      identity: { email: 'user1@example.com', fingerprint: 'fp-1' },
      snapshot: dummySnapshot,
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).not.toHaveBeenCalled();

    // Poll 2: user2 (mismatch -> counter resets to 1)
    mockDetectActive.mockResolvedValueOnce({
      identity: { email: 'user2@example.com', fingerprint: 'fp-2' },
      snapshot: dummySnapshot,
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).not.toHaveBeenCalled();

    // Poll 3: user2 again (matches -> counter reaches 2)
    mockDetectActive.mockResolvedValueOnce({
      identity: { email: 'user2@example.com', fingerprint: 'fp-2' },
      snapshot: dummySnapshot,
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).toHaveBeenCalledWith({ email: 'user2@example.com', fingerprint: 'fp-2' }, dummySnapshot);
  });

  it('resets debounce on partial or unsupported detection', async () => {
    const watcher = new CaptureWatcher(dbPath, logger);
    const callback = vi.fn();
    watcher.onDetection(callback);

    const dummySnapshot = { values: {}, capturedAt: Date.now() };

    // Poll 1: active
    mockDetectActive.mockResolvedValueOnce({
      identity: { email: 'user1@example.com', fingerprint: 'fp-1' },
      snapshot: dummySnapshot,
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Poll 2: partial
    mockDetectActive.mockResolvedValueOnce({
      partial: true,
      availableValues: {},
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).not.toHaveBeenCalled();

    // Poll 3: active again (starts from count 1 again)
    mockDetectActive.mockResolvedValueOnce({
      identity: { email: 'user1@example.com', fingerprint: 'fp-1' },
      snapshot: dummySnapshot,
    });
    (watcher as any).poll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callback).not.toHaveBeenCalled();
  });

  it('stop() properly stops timers and watchers', () => {
    const watcher = new CaptureWatcher(dbPath, logger);
    watcher.start();
    expect((watcher as any).pollTimer).toBeDefined();

    watcher.stop();
    expect((watcher as any).pollTimer).toBeUndefined();
    expect((watcher as any).fsWatcher).toBeUndefined();
  });
});
