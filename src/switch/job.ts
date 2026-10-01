export interface SwitchJob {
  version: 1;
  parentPid: number;
  dbPath: string;
  targetEmail: string;
  targetFingerprint: string;
  values: Record<string, string>;
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
