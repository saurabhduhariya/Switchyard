/**
 * User-configurable extras for the sign-in side window.
 *
 * Only a small allowlist of cosmetic flags is accepted. Anything else is rejected so a
 * setting can never redirect the profile, load code, or open a debug port.
 */
export const OWN_EXTENSION_ID = 'saurabhduhariya.ag-switchyard';

export const ALLOWED_CAPTURE_FLAGS: readonly string[] = [
  '--skip-welcome',
  '--skip-release-notes',
  '--skip-add-to-recently-opened',
  '--disable-telemetry',
  '--disable-workspace-trust',
];

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i;

export interface SanitizedLaunchArgs {
  args: string[];
  rejected: string[];
}

export function sanitizeCaptureLaunchArgs(
  flags: unknown,
  disabledExtensions: unknown
): SanitizedLaunchArgs {
  const args: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(flags)) {
    for (const raw of flags) {
      const flag = typeof raw === 'string' ? raw.trim() : '';
      if (!flag) {
        continue;
      }
      if (!ALLOWED_CAPTURE_FLAGS.includes(flag)) {
        rejected.push(String(raw));
        continue;
      }
      if (!seen.has(flag)) {
        seen.add(flag);
        args.push(flag);
      }
    }
  }

  if (Array.isArray(disabledExtensions)) {
    for (const raw of disabledExtensions) {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id) {
        continue;
      }
      // The side window needs this extension to close itself and show its hint.
      if (!EXTENSION_ID_PATTERN.test(id) || id.toLowerCase() === OWN_EXTENSION_ID) {
        rejected.push(String(raw));
        continue;
      }
      const key = `ext:${id.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        args.push('--disable-extension', id);
      }
    }
  }

  return { args, rejected };
}
