import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findCaptureMainPids, forceKill } from '../../src/capture/processes';

describe('capture/processes', () => {
  let child: ChildProcess | undefined;
  let dir: string;

  afterEach(() => {
    if (child?.pid) {
      forceKill(child.pid);
    }
    child = undefined;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a process by its --user-data-dir and ignores other folders', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-proc-'));
    // `--` makes node pass the rest through as plain arguments that show up in the process list
    child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', '--', '--user-data-dir', dir, '--new-window'],
      { stdio: 'ignore', windowsHide: true }
    );
    await new Promise((r) => setTimeout(r, 800));

    const found = await findCaptureMainPids(dir);
    expect(found).toContain(child.pid);

    const other = await findCaptureMainPids(path.join(dir, 'does-not-exist'));
    expect(other).not.toContain(child.pid);
  }, 20000);

  it('returns an empty list when nothing matches', async () => {
    expect(await findCaptureMainPids('/definitely/not/a/real/capture/dir')).toEqual([]);
  }, 20000);
});
