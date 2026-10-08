import { describe, expect, it } from 'vitest';
import { sanitizeCaptureLaunchArgs } from '../../src/capture/launchArgs';
import { buildLaunchArgs } from '../../src/platform/ide';

describe('capture/launchArgs', () => {
  it('accepts only allowlisted cosmetic flags', () => {
    const { args, rejected } = sanitizeCaptureLaunchArgs(
      ['--skip-welcome', '--skip-release-notes', '--skip-welcome', '  --disable-telemetry  '],
      []
    );
    expect(args).toEqual(['--skip-welcome', '--skip-release-notes', '--disable-telemetry']);
    expect(rejected).toEqual([]);
  });

  it('rejects flags that could redirect the profile or open a debug port', () => {
    const { args, rejected } = sanitizeCaptureLaunchArgs(
      ['--user-data-dir', '/etc', '--inspect=9229', '--extensions-dir=/tmp/x', '--remote-debugging-port=1', 'rm -rf /', 42],
      []
    );
    expect(args).toEqual([]);
    expect(rejected.length).toBe(6);
  });

  it('turns disabled extension ids into --disable-extension pairs', () => {
    const { args } = sanitizeCaptureLaunchArgs([], ['eamodio.gitlens', 'ms-python.python']);
    expect(args).toEqual([
      '--disable-extension',
      'eamodio.gitlens',
      '--disable-extension',
      'ms-python.python',
    ]);
  });

  it('never disables Switchyard itself and rejects malformed ids', () => {
    const { args, rejected } = sanitizeCaptureLaunchArgs(
      [],
      ['saurabhduhariya.ag-switchyard', 'SAURABHDUHARIYA.AG-SWITCHYARD', 'not an id', '--evil']
    );
    expect(args).toEqual([]);
    expect(rejected.length).toBe(4);
  });

  it('tolerates non-array settings', () => {
    expect(sanitizeCaptureLaunchArgs(undefined, 'x')).toEqual({ args: [], rejected: [] });
  });

  it('buildLaunchArgs places extra args before folders and keeps the isolated profile flags', () => {
    const args = buildLaunchArgs({
      userDataDir: '/p',
      extensionsDir: '/e',
      extraArgs: ['--skip-welcome'],
      folders: ['/work'],
    });
    expect(args.slice(0, 4)).toEqual(['--user-data-dir', '/p', '--extensions-dir', '/e']);
    expect(args.indexOf('--skip-welcome')).toBeLessThan(args.indexOf('/work'));
  });
});
