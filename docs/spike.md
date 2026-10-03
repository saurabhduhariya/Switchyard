# Antigravity IDE Feasibility Spike Report

**Date:** October 2026  
**Environment:** Linux x64  
**Project:** Switchyard (`ag-switchyard`)

---

## 1. Environment & Versions

The following environment details were inspected and verified on the target system:

| Component | Value | Notes |
| :--- | :--- | :--- |
| **Antigravity IDE** | `2.5.5` | Quality: stable (`product.json`) |
| **VS Code Base** | `1.107.0` | Commit: `ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8` |
| **`engines.vscode` Target** | `^1.107.0` | Set in `package.json` for extension compatibility |
| **Electron Runtime** | `39.2.3` | Bundled in Antigravity |
| **Internal Node.js** | `22.21.1` | Run via `ELECTRON_RUN_AS_NODE=1` |
| **OS / Platform** | `Linux x64` | Arch / Linux distribution |
| **Local Tooling** | Node `v20.20.2`, `sqlite3` CLI, `@vscode/vsce`, `ovsx` | Verified installed |

---

## 2. Executable & Paths

* **Binary Executable:** `/usr/bin/antigravity-ide` (shell launcher wrapping `/opt/antigravity-ide/bin/antigravity-ide` and `/opt/antigravity-ide/antigravity-ide`).
* **Active User Configuration Dir:** `~/.config/Antigravity IDE`
* **Active Global Storage:** `~/.config/Antigravity IDE/User/globalStorage`
* **Live SQLite Database:** `~/.config/Antigravity IDE/User/globalStorage/state.vscdb` (and `state.vscdb.backup`)
* **Flag Compatibility:** Verified that `antigravity-ide` supports `--user-data-dir <dir>` and `--extensions-dir <dir>`.

---

## 3. Auth Keys & Key Diff Analysis (Step 0.4)

Comparing full database dumps (`ItemTable` with 1,694 keys) across two distinct authenticated Google accounts revealed that only 14 keys changed, of which 4 are the critical auth/identity keys:

| Key Name | Purpose | Behavior Observed |
| :--- | :--- | :--- |
| `antigravityUnifiedStateSync.oauthToken` | OAuth refresh & access tokens | 1068 bytes, changes per account |
| `antigravityUnifiedStateSync.userStatus` | Identity, email, plan & model credits | 27KB–29KB, changes per account |
| `antigravityUnifiedStateSync.modelCredits` | Quota & model tier balance | 104–156 bytes, changes per account |
| `antigravity.profileUrl` | User avatar image URL | Changes per account |

*Legacy key `jetskiStateSync.agentManagerInitState` was not present in this build.*

---

## 4. Identity Decoding Rule (Step 0.5)

* **Structure:** The value of `antigravityUnifiedStateSync.userStatus` is base64-encoded protobuf wrapping an inner base64-encoded protobuf message.
* **Extraction:** 
  1. Base64 decode the outer string.
  2. Locate and base64 decode the embedded inner base64 block.
  3. The user's Google email address is stored as a plain UTF-8 string inside the inner message.
* **Verified Accounts:**
  - Account A: `user.a@example.com`
  - Account B: `user.b@example.com`
* **Identity Rule:**
  - Primary: Extract email from `userStatus`.
  - Fallback: SHA256 fingerprint (`sha256(oauthToken).slice(0, 12)`).

---

## 5. Feasibility Experiments & Verification

### Step 0.6: Manual Swap Experiment (Mode B — Token Swap)
* **Test:** Antigravity IDE was closed, and `state.vscdb` + `state.vscdb.backup` were overwritten with Account A snapshot, then reopened. Repeated with Account B snapshot.
* **Result:** **PASSED**. Both Account A and Account B restored their active sessions immediately without triggering browser OAuth or any re-authentication dialogs.

### Step 0.7: Profile Isolation Experiment (Mode A — Isolated Profiles)
* **Test:** Launched `antigravity-ide --user-data-dir /tmp/ag_profile_test`.
* **Result:** **PASSED**. The new instance opened in a fresh, isolated, unauthenticated state without accessing the primary profile's credentials. Linux file-based storage ensures clean isolation without OS keyring collisions.

### Step 0.8: Detached Child Process & Quit Hook
* **Test:** Executed `ELECTRON_RUN_AS_NODE=1 /opt/antigravity-ide/antigravity-ide -e '...'` as a detached process.
* **Result:** **PASSED**. Electron executed the script in pure Node.js mode and wrote output asynchronously to `/tmp/ag_helper_test.txt` without requiring an external Node binary.

---

## 6. Terms of Service Review & Safety Stance

* **Google Terms:** Third-party tools making automated API requests using extracted Antigravity OAuth tokens have triggered 403 suspension blocks.
* **Switchyard Architecture:**
  - The extension never makes network calls or talks to Google APIs directly.
  - Only the official Antigravity IDE communicates with Google servers.
  - Mode A (Profile Isolation) does not touch or extract tokens at all.
  - Mode B (Token Swap) only writes local state when closed and operates solely inside the official IDE.

---

## 7. Go / No-Go Decision

| Switching Mode | Functional? | Role in Switchyard |
| :--- | :---: | :--- |
| **Mode A (Profile Isolation)** | **YES** | **Default mode (v0.x)** — Safest, zero token manipulation. |
| **Mode B (Token Swap)** | **YES** | **Opt-in experimental mode** — Single-window switching with restart confirmation. |

---

## 8. Exit Criteria Sign-off

- [x] At least one mode works end-to-end by hand. *(Both Mode A and Mode B verified)*
- [x] Auth keys and identity rule are known. *(Verified on live DB)*
- [x] Executable path + flags confirmed. *(`/usr/bin/antigravity-ide`, `--user-data-dir`, `--extensions-dir`)*
- [x] Helper-survives-quit pattern confirmed. *(Verified with `ELECTRON_RUN_AS_NODE=1`)*

**Phase 0 is COMPLETE.** Ready to proceed to **Phase 1 (Repo Scaffold & Tooling)**.
