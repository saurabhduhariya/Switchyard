# Changelog

All notable changes to the **Switchyard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.0] - 2026-10-08

### Added
- **Side-window Add Account** (default): a separate sign-in window opens, Switchyard detects the login, closes that window and lets you save the account. Your main window is never signed out, closed or reloaded, and your active account never changes.
- **Profile mode** uses the same flow: the sign-in window's data becomes the account's isolated profile, so the real email is saved and the first Switch opens already signed in.
- "Switch to this account" button on the saved card (with Dismiss).
- The card says when the detected account is new, already saved, or already your active account; the button becomes "Refresh saved session" for the last two.
- "I've signed in" button as a manual way to finish when automatic detection is slow.
- "Use sign-out method" button on a failed or timed-out sign-in card.
- A detected-but-unsaved account is discarded (and its folder deleted) after 10 minutes.
- Settings `switchyard.addAccountMethod` (`sideWindow` | `signOutRestart`), `switchyard.captureWindowArgs` and `switchyard.captureWindowDisabledExtensions` (allowlisted flags only, machine scope).

### Changed
- Capture sessions are owned by one Switchyard window (heartbeat lease). Other windows cannot see, cancel, sweep or overwrite a live sign-in; a session abandoned by a closed or crashed window is taken over or cleaned up.
- The command is now titled "Switchyard: Add New Account" and the walkthrough step describes the side-window flow.
- On Windows the side-window process is polled less often (1 s) and given longer (8 s) to close, because each lookup starts PowerShell.

### Fixed
- Saving never creates an "unknown" account: a snapshot without a login token is refused.
- Antigravity can hold a fresh login in memory until its window closes; Switchyard now closes the sign-in window and reads the saved login afterwards.
- Cancel no longer leaves a stuck "Cancelled" card; Try Again after a timeout or failure starts a fresh sign-in.
- A persisted PID is never signalled during cleanup (it could have been reused by another program); the real window is found by its `--user-data-dir`.
- The sign-in folder is deleted when saving fails, and tokens cached in memory are dropped on every end state. The startup sweep removes stale folders after 1 hour.

### Technical
- New `src/capture/` module: `CaptureManager` (state machine, ownership, expiry, profile promotion), `CaptureWatcher`, `companion` (side-window mode), `processes` (find/close the real window), `launchArgs` (flag allowlist) and `src/platform/launch.ts` (shared isolated-window launcher).
- 190 unit tests, including an end-to-end auto-finish scenario, panel routing tests and real-process lookup tests.

---

## [0.1.3] - 2026-10-06

### Fixed
- **Critical: Real Account Switching & AI Quota Synchronization**:
  - Fixed Token Swap mode not genuinely switching Google accounts (avatar and AI quotas were stuck on the old account).
  - Root cause: Helper process was targeting Extension Host PID instead of Electron Main Process PID, causing in-memory cache to never refresh.
  - Solution: Changed `process.pid` to `getMainProcessPid()` using `process.ppid` to target the correct Electron Main Process.
  - Added post-restart fingerprint verification in `reconcile.ts` - compares live `state.vscdb` credentials with target account and displays retry button if mismatch detected.
  - Removed artificial settle delay from helper process, relying on non-blocking SQLite lock detection for fast ~1.2s relaunches.

### Changed
- **UI Clarity**:
  - Updated Token Swap mode description: "Swaps authentication in the current workspace via fast sub-second IDE relaunch. Real avatar & AI quota rotation."
  - Updated Isolated Profiles description: "Run multiple accounts side-by-side in separate windows. Zero window closing."

### Technical
- Modified `src/switch/TokenSwapEngine.ts`: Use `getMainProcessPid()` instead of `process.pid` for accurate parent process detection.
- Added `src/platform/ide.ts`: New `getMainProcessPid()` function returning `process.ppid || process.pid`.
- Optimized `src/switch/helper/switch-helper.ts`: Removed `settleDelayMs` parameter, simplified WAL/SHM cleanup to single pass.
- Enhanced `src/switch/reconcile.ts`: Added live fingerprint verification with automatic retry on mismatch.
- Updated all unit tests to reflect process relaunch behavior.

---

## [0.1.0] - 2026-10-02

### Added
- **Multi-Account Switching Architecture**:
  - **Mode A (Isolated Profiles)**: Open multiple Google accounts side-by-side in independent Antigravity IDE windows using `--user-data-dir`.
  - **Mode B (Token Swap)**: Switch between Google accounts inside the same window via atomic quit-swap-relaunch with zero browser prompts.
- **Live Auth Detection & First-Run Capture**:
  - Debounced filesystem watcher (500ms) on `state.vscdb` and window focus re-detection.
  - Automatic discovery of active Google sessions with one-click "Save Login" prompts.
- **Model Usage & Quotas Dashboard**:
  - Live weekly and 5-hour quota percentages and reset countdowns for Gemini and Claude + GPT.
  - Local loopback IPC socket communication with the internal Language Server (`GetUserStatus`).
  - Offline fallback decoder for `antigravityUnifiedStateSync.userStatus` protobuf payloads.
  - Accurate tier detection distinguishing `Antigravity Starter` (free tier) from `Antigravity Pro`.
- **In-Panel Settings View**:
  - Embedded settings view directly in the sidebar for switching modes, email masking, confirmation toggles, and backup management.
- **Backup & Recovery System**:
  - Automatic timestamped snapshots of `state.vscdb`, `state.vscdb.backup`, `-wal`, and `-shm` files before every switch.
  - SHA-256 fingerprint verification with automatic instant rollback on mismatch.
  - One-click backup restoration from in-panel settings or Command Palette (`switchyard.restoreBackup`).
  - Quick action to open the backups folder in the system file manager (`switchyard.openBackupsFolder`).
- **Security & Privacy Hardening**:
  - **Zero-Network Architecture**: No external telemetry, tracking, or network requests.
  - **OS Keychain Vault**: OAuth tokens and snapshots stored exclusively in `SecretStorage` (never in `globalState` or plain files).
  - Centralized logger redaction for OAuth tokens, refresh tokens, and base64 credentials.
  - Email address masking option (`u****@domain.com`) for privacy during screen sharing.
  - Unsupported version guard to gracefully handle future Antigravity key schema migrations.
- **User Interface**:
  - Built with Svelte 5 runes and native VS Code CSS variables for Dark, Light, and High Contrast themes.
  - Clean vector SVG icon system (`Icon.svelte`).
  - Full keyboard navigation and ARIA accessibility labels.
  - Interactive 4-step onboarding walkthrough (`Getting Started with Switchyard`).
