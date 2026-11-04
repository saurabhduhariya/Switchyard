export interface SwitchJob {
  version: 1;
  parentPid: number;
  dbPath: string;
  targetEmail: string;
  targetFingerprint: string;
  values: Record<string, string>;
  /** v2.6.0+: Raw go-keyring-base64 credential to write into OS Keychain (service: gemini, username: antigravity) */
  keychainToken?: string;
  /** v2.6.0+: True when signing out (clears OS Keychain & kills agy --hub) */
  clearKeychain?: boolean;
  deleteKeys?: string[];
  backupDir: string;
  relaunch: {
    exe: string;
    args: string[];
  };
  resultFile: string;
}

export interface SwitchResultFile {
  ok: boolean;
  error?: string;
  switchedAt?: number;
}
