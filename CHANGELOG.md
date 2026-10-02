# Changelog

All notable changes to the **Switchyard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
