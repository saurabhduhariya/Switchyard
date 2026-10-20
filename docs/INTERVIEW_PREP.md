# Switchyard — Technical Interview Preparation Guide

> **Project:** Switchyard (`ag-switchyard`)  
> **Type:** Developer Tools / Desktop Systems Engineering / VS Code & Electron Architecture  
> **Core Stack:** TypeScript, Node.js, Electron, SQLite (sql.js / WASM), IPC Sockets, Protobuf, Svelte 5, VS Code Extension API  
> **Traction:** 1,000+ organic downloads within 5 days of launch on Open VSX  

---

## 1. The Elevator Pitch (30-Second & 2-Minute Versions)

### 30-Second Pitch (Quick Hook)
> *"I built **Switchyard**, an open-source multi-account manager and switcher extension for the Google Antigravity IDE. Natively, switching Google accounts in Antigravity requires signing out, shutting down all active windows, and losing running terminals and session state. Switchyard solves this by introducing single-click account switching and isolated parallel workspaces, real-time AI quota tracking for Gemini and Claude via loopback IPC, and a side-window credential capture engine—all while operating under a strict zero-network security model where tokens never leave the local OS keychain."*

### 2-Minute Pitch (Technical Overview)
> *"The motivation came from a real developer pain point: AI-first IDEs like Antigravity tie your active editor session, context windows, and model rate limits directly to a single Google account. Developers routinely hit quota walls or need to jump between work, client, and personal accounts. Doing this natively forces a sign-out flow that kills open processes and triggers browser OAuth redirects.*
> 
> *To solve this without violating Google's Terms of Service or making unauthorized third-party API calls, I reverse-engineered how Antigravity manages its local state. I discovered that authentication lives in a local SQLite database (`state.vscdb`) across four specific keys, while live AI quota limits are streamed from a local Language Server daemon.*
> 
> *The system has three key architectural pillars:*
> 1. *A **Side-Window Credential Capture Engine** that launches an ephemeral Antigravity window with `--user-data-dir`, observes SQLite unflushed state, orchestrates graceful termination once OAuth finishes, and stages credentials without touching the user's primary IDE window.*
> 2. *A **Dual-Mode Switching Engine**: Mode A (Isolated Profiles) runs independent IDE windows side-by-side using isolated user data directories; Mode B (Token Swap) utilizes a detached Electron helper process to atomically swap SQLite session keys with SHA-256 rollback protection.*
> 3. *A **Live Quota Collector** that connects directly to the IDE's internal Language Server via loopback Unix/TCP sockets to track real-time 5-hour and weekly rate limits for Gemini and Claude.*
> 
> *The project has over 197 automated unit tests, strict zero-network CI guards, and passed 1,000 downloads in its first week on Open VSX."*

---

## 2. Problem Statement & Motivation

### The Problem
- **Destructive Native Sign-out:** In the Google Antigravity IDE, clicking "Sign Out" closes every open editor window, terminates running debuggers/terminals, and triggers a full restart cycle.
- **Quota Exhaustion:** AI developers hit 5-hour or weekly quota ceilings on models like Claude 3.5 Sonnet or Gemini 1.5 Pro. Switching to a backup or team account was too high-friction to do in the middle of active coding.
- **Workspace Contamination:** Developers working on enterprise projects often have separate corporate and personal Google accounts. Mixing them in a single profile risks credential or workspace cross-contamination.

### The Engineering Constraints
1. **Zero External Network Calls:** We cannot proxy OAuth or call Google APIs directly from extension code. Doing so would violate Google ToS, risk security suspensions, and create supply-chain vulnerabilities.
2. **Crash Resilience:** If an account switch fails mid-operation, the IDE must never be left in an unbootable or corrupted state.
3. **Seamless Capture:** We must capture a new login *without* signing out the current window.

---

## 3. High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ANTIGRAVITY IDE SHELL                           │
│                                                                        │
│  ┌───────────────────────┐           ┌──────────────────────────────┐  │
│  │   Svelte 5 Webview    │           │    Extension Host Engine     │  │
│  │   (UI / Quota HUD)    │◄───IPC───►│                              │  │
│  │  • Active Account     │ (postMsg) │  • PanelProvider             │  │
│  │  • Quota Progress     │           │  • AccountStore (Keychain)   │  │
│  │  • 1-Click Switchers  │           │  • AuthDetector              │  │
│  └───────────────────────┘           └──────────────┬───────────────┘  │
└─────────────────────────────────────────────────────┼──────────────────┘
                                                      │
         ┌────────────────────────────────────────────┼──────────────────────────┐
         │                                            │                          │
         ▼                                            ▼                          ▼
┌──────────────────┐                       ┌─────────────────────┐    ┌────────────────────┐
│   Capture Engine │                       │   Switching Engine  │    │  Quota Collector   │
│                  │                       │                     │    │                    │
│ • Ephemeral Dir  │                       │ [Mode A: Profile]   │    │ • Loopback IPC     │
│ • Child Process  │                       │ • --user-data-dir   │    │   (net.Socket)     │
│ • File Lock Wait │                       │                     │    │ • LS Daemon RPC    │
│ • State Flush    │                       │ [Mode B: TokenSwap] │    │ • Protobuf Decoder │
│ • Auto-Promote   │                       │ • Detached Electron │    │ • 5h/Weekly Quota  │
│                  │                       │ • Atomic DB Swap    │    │                    │
└────────┬─────────┘                       │ • SHA-256 Rollback  │    └─────────┬──────────┘
         │                                 └──────────┬──────────┘              │
         ▼                                            ▼                         ▼
┌──────────────────┐                       ┌─────────────────────┐    ┌────────────────────┐
│ Ephemeral Window │                       │ OS SecretStorage    │    │ Language Server    │
│ (Login Sandbox)  │                       │ (Linux SecretServ / │    │ (Antigravity IPC   │
│                  │                       │  macOS Keychain /   │    │  unix/tcp socket)  │
│                  │                       │  Win CredentialMgr) │    │                    │
└──────────────────┘                       └─────────────────────┘    └────────────────────┘
```

---

## 4. Deep-Dive: The 4 Hardest Technical Challenges

### Challenge 1: Adding Accounts Without Closing the Main Window (The Ephemeral Side-Window Problem)

#### What was the problem?
When a user wants to log in with a second Google account, Antigravity requires a full IDE window to perform the OAuth browser handshake. However, Antigravity holds authentication tokens in memory and **only flushes SQLite writes to `state.vscdb` when that specific window closes**.
If we opened a sign-in window:
- How do we know when the user finished signing in in their external browser?
- If we close the window too early, the tokens are never flushed to disk.
- If we keep the window open, the user has to manually close it and wait.

#### How did I solve it?
1. **Isolated Ephemeral Sandbox:** Switchyard spawns a detached Antigravity process with a dedicated temporary `--user-data-dir` (`~/.config/Antigravity IDE/User/globalStorage/switchyard-captures/<sessionId>`).
2. **Observation via State Watcher:** A background polling loop (`CaptureWatcher`) inspects the temporary SQLite database every 500ms.
3. **State Classification:** It looks for the presence of `antigravityUnifiedStateSync.oauthToken` and `userStatus`.
4. **Flush Synchronization:** When tokens appear in the WAL (Write-Ahead Log) or DB, Switchyard sends a graceful close signal via a coordination file (`close-request.json`) or OS signal, and waits up to 5 seconds for Electron to cleanly flush SQLite locks and terminate.
5. **Atomic Promotion or Vaulting:**
   - In **Profile Mode**: The temporary directory is renamed atomically into a permanent profile folder (`~/.config/Antigravity IDE/profiles/<id>`).
   - In **Token Swap Mode**: The SQLite keys are read directly, persisted into `SecretStorage`, and the temporary folder is completely wiped from disk.
6. **Safety TTL:** Unsaved captured accounts expire after 10 minutes (`CAPTURE_DETECTED_TTL_MS`), and stale sessions are swept on IDE launch.

---

### Challenge 2: In-Place Session Swapping without Electron Lock Collisions (Mode B)

#### What was the problem?
Antigravity IDE runs SQLite with WAL mode enabled (`state.vscdb`, `state.vscdb-wal`, `state.vscdb-shm`). While the IDE is running, the main process maintains active POSIX file locks on `state.vscdb`.
An active VS Code extension host **cannot overwrite SQLite files while the host itself is running**, and modifying in-memory state directly is not exposed via any public API.

#### How did I solve it?
I designed a **Detached Helper Process Architecture**:
1. **Pre-flight Backup:** Before initiating anything, Switchyard creates a timestamped copy of `state.vscdb`, `-wal`, and `-shm`, and records their SHA-256 checksums in memory.
2. **Job File Generation:** Switchyard writes a secure job file in `os.tmpdir()` with strict POSIX permissions (`0o600`), containing the target account's encrypted session keys.
3. **Detached Launcher:** Using Electron's internal Node runtime (`ELECTRON_RUN_AS_NODE=1`), Switchyard spawns a decoupled standalone Node process (`dist/switch-helper.js`) unattached from the parent process tree (`detached: true, stdio: 'ignore'`).
4. **Graceful IDE Exit:** Switchyard commands the IDE to quit via `vscode.commands.executeCommand('workbench.action.quit')`.
5. **Helper Execution:**
   - The helper waits until the parent Antigravity process PID has completely terminated and SQLite locks are released.
   - It performs atomic writes to `state.vscdb` updating only the 4 critical identity keys.
   - It truncates and cleans the WAL and SHM files so stale transactions do not override the new keys on boot.
   - It deletes the temporary job file (`finally { fs.unlinkSync(jobPath); }`).
   - It relaunches Antigravity with the original workspace flags.
6. **Self-Healing Fallback:** If the helper encounters an error or SQLite lock timeout, it restores the backup files from SHA-256 verified copies before exiting.

---

### Challenge 3: Live AI Quota Tracking via Loopback IPC Reverse-Engineering

#### What was the problem?
Antigravity displays model usage quotas for Gemini, Claude 3.5 Sonnet, and GPT models, but provides **zero public APIs** or extension hooks to read these values. Making external requests to Google servers using the user's OAuth tokens was forbidden under our zero-network security stance.

#### How did I solve it?
I inspected the running process tree and discovered that Antigravity spawns an internal Language Server daemon that communicates over a local loopback TCP port.
1. **Process Discovery:** `QuotaCollector` inspects the active process tree to locate Antigravity's internal language server command line arguments, extracting the listening port and internal authorization token.
2. **Loopback IPC Socket:** Switchyard opens a raw Node.js `net.Socket` to `127.0.0.1:<port>`.
3. **RPC Querying:** It issues an internal JSON-RPC call: `RetrieveUserQuotaSummary`.
4. **Response Parsing:** This returns exact data structures:
   - Weekly quota percentage & exact ISO reset timestamp.
   - 5-hour rolling window percentage & reset countdown.
   - Model groups (`Gemini`, `Claude + GPT`).
5. **Cascading Fallbacks (Defense in Depth):**
   - **Primary:** `RetrieveUserQuotaSummary` over loopback socket.
   - **Fallback 1:** `GetUserStatus` over loopback socket (reads model config objects).
   - **Fallback 2:** Offline SQLite reader: Parses the base64-encoded protobuf payload stored in `state.vscdb` under `antigravityUnifiedStateSync.userStatus` to extract cached tier info without even needing the language server.
6. **Tier-Aware Rendering:** Antigravity Starter (free tier) only has weekly quotas, whereas Pro tiers feature 5-hour rolling windows. Switchyard automatically detects the plan and hides the 5-hour window for Starter accounts to prevent UI confusion.

---

### Challenge 4: Zero-Network Architecture & Credential Hardening

#### What was the problem?
Handling OAuth refresh tokens for user Google accounts creates a massive security responsibility. If users suspect that an extension sends their credentials to a third-party server, adoption drops to zero.

#### How did I solve it?
1. **Zero-Network Policy:** Switchyard makes **0 HTTP/HTTPS requests**. All network operations are strictly local loopback (`127.0.0.1`) IPC.
2. **Automated CI Network Enforcement:** In our GitHub Actions CI pipeline (`ci.yml`), a dedicated step scans the entire codebase with regex:
   ```bash
   grep -rE "\bfetch\s*\(|axios|http\.request|https\.request|XMLHttpRequest|WebSocket|net\.request" src/
   ```
   If any outbound network call is detected, the build immediately fails.
3. **OS Keychain Vaulting:** Tokens and database snapshots are stored exclusively in VS Code's `SecretStorage` API (`context.secrets`), which delegates to the native OS keyring:
   - macOS: Keychain Services
   - Windows: Windows Credential Manager
   - Linux: `libsecret` (GNOME Keyring / KWallet)
4. **Metadata Separation:** Account metadata (display email, plan, last used, quota cache) is stored in `globalState`, but **zero tokens or database dumps** are ever stored in `globalState` or plaintext files.
5. **Automatic Log Redaction:** The centralized logger (`logger.ts`) runs a regex redaction pipeline that automatically scrubs:
   - Google access tokens (`ya29.*`)
   - Refresh tokens (`1//.*`)
   - Base64 blobs (>40 characters)
   - User email addresses (when Privacy/Masking mode is toggled)

---

## 5. Architectural Trade-offs & Design Decisions

| Decision | Chosen Approach | Alternative Considered | Why We Chose This |
| :--- | :--- | :--- | :--- |
| **Switching Strategy** | **Dual Mode** (Profile Default + TokenSwap Opt-in) | Token-Swap Only | Profile Mode requires 0 token manipulation and runs side-by-side windows with zero restarts. Token-Swap is great for single-window fans but requires restarting the IDE. Offering both covers all workflows safely. |
| **UI Framework** | **Svelte 5 Runes** | React / Pure Vanilla TS / VS Code TreeView | Native TreeViews cannot render custom quota progress bars, badges, or custom responsive cards. Svelte 5 compiles down to tiny JS with 0 runtime overhead and instant first-paint (<150ms). |
| **Database Access** | **sql.js (WebAssembly)** | Native `better-sqlite3` | Native Node C++ addons require precompilation against Electron's Node ABI for every OS and architecture. WebAssembly runs identically on Linux, Windows, macOS (Intel & Apple Silicon) with zero native compilation issues. |
| **Quota Extraction** | **Loopback IPC to Local LS** | Google Cloud Quota REST API | Calling Google REST APIs requires client IDs, scopes, network requests, and external connectivity. Querying the local daemon is 100% offline, zero-network, and matches the IDE's exact internal state. |
| **Token Storage** | **`context.secrets` (Keychain)** | Encrypted file on disk | File-based encryption requires managing a master key (which would have to be hardcoded or derived locally). VS Code's SecretStorage delegates securely to the operating system's hardware-backed keychain. |

---

## 6. Edge Cases & Resilience Patterns

| Edge Case / Failure Scenario | How Switchyard Handles It |
| :--- | :--- |
| **IDE crashes during Token Swap** | Atomic SHA-256 verified backups of `state.vscdb`, `-wal`, and `-shm` are created before any swap. The helper restores these before boot if locks fail. |
| **User logs into an already-saved account** | `CaptureManager` computes the SHA-256 fingerprint of the OAuth token and checks existing records. If the account already exists, it updates tokens in place instead of creating duplicate records. |
| **User abandons the sign-in window** | Sessions have an automated 10-minute TTL. Unsaved capture directories are purged. If another window already has a capture open, a mutex check prevents concurrent capture conflicts. |
| **Multiple IDE windows running** | Session ownership tracking via `ownerId` and heartbeat timestamps (`heartbeatAt`). Extension hosts in other windows recognize foreign capture sessions and avoid mutating them. |
| **Future Antigravity DB schema changes** | `AuthDetector` has an **Unsupported Version Guard**. If critical keys (`oauthToken`, `userStatus`) are missing or schema changes, the extension displays an informational warning rather than attempting a corrupting write. |
| **Stale Quota Cache** | When offline or disconnected from Language Server, the UI shows a visual warning clock tooltip indicating quota data is older than 24 hours. |

---

## 7. Performance & Engineering Metrics

- **Extension Activation Time:** **~80–120ms** (Target was <150ms). Achieved by lazy-loading the 600KB `sql.js` WASM module only on user interaction rather than during `onStartupFinished`.
- **Webview First Paint:** **~150–250ms** (Target was <300ms). Minimal bundle size (~97KB compiled JS, ~33KB CSS).
- **Background Timers:** Zero active intervals when the panel is hidden (`onDidChangeVisibility` unhooks timers).
- **Test Coverage:** **197 passing unit and integration tests** in Vitest covering edge cases, race conditions, PID recycling, and SQL transaction rollbacks.
- **Traction:** **1,000+ downloads in 5 days** on Open VSX.

---

## 8. Behavioral & Scenario Questions (STAR Method)

### Q1: "Tell me about a complex project you built from scratch."
- **Situation:** As an active user of Google Antigravity IDE, I was constantly hitting AI model quotas on my work and personal accounts. Switching accounts natively required closing all my windows and losing my dev environment.
- **Task:** I decided to build Switchyard, a VS Code extension that enables instant account switching and multi-profile management without network calls or credential leaks.
- **Action:** I reverse-engineered Antigravity's internal SQLite database and Language Server IPC. I engineered a detached Electron helper process to perform atomic session swapping, a side-window capture mechanism with file-lock synchronization, and a Svelte 5 frontend with real-time AI quota visualization.
- **Result:** Published on Open VSX, gained over 1,000 downloads in 5 days, maintained a 0-vulnerability security record, and 197 passing automated tests.

### Q2: "Tell me about a difficult bug or architectural roadblock you faced."
- **Situation:** When implementing the "Add Account" feature, I initially tried reading the login tokens while the user was signing in. But the SQLite database on disk remained empty.
- **Task:** I needed to capture fresh OAuth credentials from an external sign-in window without forcing the user to manually coordinate file saves.
- **Action:** By analyzing Antigravity's process lifecycle, I realized that VS Code forks flush `state.vscdb` memory caches strictly during the window shutdown sequence. I redesigned the subsystem into `CaptureWatcher`: it polls for staging markers, requests a graceful window termination via a file lock protocol, waits for process termination, and only then reads the flushed credentials.
- **Result:** Account capture went from unreliable and manual to 100% automated with zero window closing in the user's primary workspace.

### Q3: "How did you approach security for this project?"
- **Situation:** The extension handles Google OAuth credentials. A single leak or vulnerability would compromise user accounts.
- **Task:** Ensure an uncompromising security architecture that users and enterprises could trust.
- **Action:** I implemented a Zero-Network architecture enforced via automated CI regex gates. Tokens are stored strictly in `context.secrets` backed by the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). All loggers run automated redaction for tokens and emails. Temporary files use `0o600` permissions and are deleted in `finally` blocks.
- **Result:** Switchyard has zero external dependencies, 0 network calls, and passed full security audits with no plain-text token leaks.

### Q4: "If you had to design v2 of this project, what would you improve?"
- **Answer:**
  1. **Cross-Platform Virtual Display Capture:** On Linux headless setups, launching a side window requires an X11/Wayland display. I would explore headless OAuth capture options.
  2. **Fine-Grained Quota Alarms:** Introduce OS native notifications when rolling 5-hour quota resets (e.g., "Your Claude 3.5 Sonnet quota has reset").
  3. **Team Account Vault Sharing:** Optional client-side encrypted export/import using GPG or asymmetric keypairs to allow dev teams to share test profiles securely.

---

## 9. Quick Technical Cheat Sheet

| Topic | Key Answer Points |
| :--- | :--- |
| **How does Token Swap work?** | Spawns detached helper (`ELECTRON_RUN_AS_NODE=1`), exits IDE, waits for PID to die and locks to release, updates 4 SQLite keys (`oauthToken`, `userStatus`, `modelCredits`, `profileUrl`), clears WAL/SHM, relaunches IDE. |
| **How does Profile Mode work?** | Launches `antigravity-ide --user-data-dir <path>`, providing 100% clean isolation for editors, extensions, and auth. |
| **How do you read Quotas?** | Query local Language Server daemon via loopback socket (`RetrieveUserQuotaSummary`), fallback to `GetUserStatus`, fallback to offline protobuf decoding in SQLite. |
| **Where are tokens stored?** | `context.secrets` (VS Code `SecretStorage`), which uses OS Keychains (macOS Keychain, Win Credential Manager, Linux Secret Service). |
| **Why WebAssembly SQLite?** | `sql.js` (WASM) avoids native C++ ABI compilation issues across Node/Electron versions and architectures. |
| **How is Zero-Network enforced?** | CI automated script bans `fetch`, `axios`, `http`, `WebSocket`, etc., in `src/`. |
| **How is UI built?** | Svelte 5 runes (`$state`, `$derived`), compiled to ~97KB bundle, themed with native VS Code CSS tokens. |
