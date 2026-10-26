# Changelog

All notable changes to the **Switchyard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.2.2] - 2026-10-26

### Added
- **Quota history and trend**: a small sparkline of each account's weekly quota over the last 7 days, with "Used X% in 24h" (or the shorter period it really covers). History is capped (about 200 readings, 7 days), only stores readings that changed, only uses live reads, and is removed with the account.
- **Quota error states**: when the signed-in account's quota cannot be read, the card explains why in plain words with a Retry button; a single early failure after startup is not shown. Accounts without any quota yet show "No quota yet. Switch to this account to load it." instead of rows of dashes.
- **Tier table** (`TIERS` in `src/shared/quotaRules.ts`): which windows a tier has (weekly, 5-hour) is data, not scattered name checks. A tier with no weekly window is also handled in the panel.

### Changed
- `QuotaCollector.getQuotaResult()` reports why a read failed (`no-language-server`, `request-failed`, `no-data`); `getQuotaSummary()` still returns just the numbers. Raw error text is only ever logged, never shown.

### Fixed
- A trend is only drawn from at least two readings (a single reading used to look like a flat "no usage" line).

### Added
- **Quota reset notifications**: a one-time notification when an exhausted quota (10% or less) on a saved account has reset, with a button to switch to it (or open the panel when several accounts reset). Resets older than 24 hours are recorded silently. Setting `switchyard.notifyOnQuotaReset` (on by default); the notification also has a Turn Off button.
- **Best-account hint**: when the signed-in account is low on a model, a banner above it suggests the saved account with the most left in that bucket (at least 25%), with Switch and Not now. Dismissals are remembered per situation. Setting `switchyard.suggestBestAccount` (on by default).
- Shared quota rules (`src/shared/quotaRules.ts`) so the panel, notifications and hints agree on what "low" means.

### Added
- Saved accounts whose quota reset time has passed are shown as an estimated `~100%` (marked, with an explanatory note) instead of the old, misleading number. Works offline and never changes stored data.
- Quota of the signed-in account is captured one last time right before switching away from it (bounded to 2.5 s), so the numbers kept for that account are as fresh as possible.

### Fixed
- A manual quota refresh could save the signed-in account's quota under a different account. Only the signed-in account is refreshed now.

## [0.2.1] - 2026-10-11

### Added
- Quota progress bars (green / amber / red by remaining %) with a "Low" chip at 10% or less. The percentage is always shown, so colour is never the only signal.
- Compact view (toggle in the panel header, remembered between sessions): other accounts show a one-line weekly summary instead of the full quota boxes.
- A warning clock on accounts whose quota data is more than 24 hours old, with a tooltip explaining it may be out of date.
- Section label shows how many other accounts there are.

### Changed
- **Starter tier accounts no longer show a 5-hour window** (the tier has a weekly quota only); the card says "Weekly quota only on this plan".
- Tier pill uses a short name ("Starter", "Google AI Pro") so it is no longer cut off.
- The Switch button highlights in the theme's button colour on hover; quota boxes stack in one column on very narrow sidebars.
- Removed logo in front of Switchyard title and cleaned up redundant container header for a cleaner sidebar.

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
