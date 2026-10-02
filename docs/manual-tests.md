# Switchyard — Manual Test Matrix & Verification Report

**Document:** `docs/manual-tests.md`  
**Phase:** Phase 9 — Testing + CI  
**Status:** Executed & Verified on Linux x64 (Antigravity IDE v2.5.5 / VS Code base 1.107.0)  
**Date:** October 2026

---

## 1. Test Matrix Summary

The following test scenarios represent the mandatory manual verification checklist run before every release of Switchyard.

| # | Scenario | Windows | macOS | Linux (Active) | Status | Notes |
|---|----------|:---:|:-----:|:-----:|:------:|-------|
| **1** | Fresh install, no accounts → empty state | Planned | Planned | ✅ Verified | **PASS** | Shows clean empty state illustration and "Save Current Login" button |
| **2** | Save current active account | Planned | Planned | ✅ Verified | **PASS** | Auto-detects Google account (`saurabhduhariya2007@gmail.com`), saves metadata in Memento & snapshot in SecretStorage |
| **3** | Add second account (guided sign-out flow) | Planned | Planned | ✅ Verified | **PASS** | `signOutAndRestart` wipes auth keys, restarts IDE, detects new login (`kkpncc8831@gmail.com`), offers toast to save |
| **4** | Switch A → B → A cycle | Planned | Planned | ✅ Verified | **PASS** | Successfully swapped sessions without browser OAuth prompts |
| **5** | Switch with unsaved editor files | Planned | Planned | ✅ Verified | **PASS** | IDE quit prompts to save dirty buffers; helper waits safely until parent PID fully exits |
| **6** | Switch with 2 IDE windows open | Planned | Planned | ✅ Verified | **PASS** | Displays warning dialog to close all other Antigravity windows before proceeding |
| **7** | Forced failure → automatic rollback | Planned | Planned | ✅ Verified | **PASS** | When fingerprint mismatch is induced, helper rolls back to pre-switch backup and restores original account |
| **8** | Restore backup from panel / command | Planned | Planned | ✅ Verified | **PASS** | In-panel settings "Restore Backup" and command `switchyard.restoreBackup` list timestamped backups and restore cleanly |
| **9** | Remove account | Planned | Planned | ✅ Verified | **PASS** | Modal confirmation; deletes metadata from Memento and securely wipes snapshot from SecretStorage |
| **10** | Theme compatibility (Dark, Light, High Contrast) | Planned | Planned | ✅ Verified | **PASS** | Uses native `--vscode-*` CSS variables; crisp SVG vector icons rendered correctly across themes |
| **11** | Upgrade install over older version | Planned | Planned | ✅ Verified | **PASS** | Migrated extension in `~/.antigravity-ide/extensions/saurabh.ag-switchyard-0.1.0/`; sanitizes legacy metadata |
| **12** | Uninstall / clean state check | Planned | Planned | ✅ Verified | **PASS** | No lingering global daemons or rogue processes; backups safely contained in globalStorage |

---

## 2. Detailed Scenario Verification

### Scenario 1 & 2: Fresh Install & First-Run Capture
* **Action:** Install `.vsix` into Antigravity IDE. Open the Accounts sidebar.
* **Result:** Panel loads with zero console errors. Active Google session is captured from `state.vscdb`. Green ACTIVE card displays with account email, user tier (e.g., `Antigravity Starter`), quota breakdown (weekly and 5-hour limit percentages, reset countdown), and snapshot timestamp.

### Scenario 3 & 4: Guided Add Flow & Token Switching
* **Action:** Click "Add Another Account" from the footer or in-panel settings.
* **Behavior:** Modal warning explains IDE will restart. Current account snapshot is updated and preserved. Auth keys (`antigravityUnifiedStateSync.oauthToken`, `antigravityUnifiedStateSync.userStatus`) are cleared in the SQLite database. IDE restarts into unauthenticated state with a guiding card. User signs in with second Google account; Switchyard detects new session and prompts to save.
* **Switching:** Clicking "Switch" on the inactive card triggers helper (`dist/switch-helper.js`), shuts down IDE, updates SQLite keys, and relaunches IDE signed into the target account without opening external browser windows.

### Scenario 5 & 6: Concurrency & Unsaved Work Safety
* **Unsaved Files:** With dirty file in editor, initiating switch halts at VS Code's "Do you want to save changes?" dialog. The detached helper process polls `parentPid` every 200ms up to 30 seconds, never writing until the editor process terminates cleanly.
* **Multiple Windows:** Warning notification reminds user that token swap switches the global database shared across all windows.

### Scenario 7 & 8: Resilience & Backup Recovery
* **Helper Rollback:** If target fingerprint verification fails during swap, helper automatically restores files from `<globalStorage>/backups/<ISO_TIMESTAMP>/` and reports error via `resultFile`.
* **In-Panel Recovery:** In-panel Settings view provides direct "Restore Backup" and "Open Backups Folder" buttons for one-click manual recovery.

### Scenario 9 & 10: Account Removal & UI Themes
* **Secret Scrubbing:** Deleting an account removes its entry from `switchyard.accounts` and calls `context.secrets.delete("switchyard.snapshot.<id>")`.
* **UI Polish:** The interface adheres to strict VS Code design guidelines with zero hardcoded hex colors, full keyboard navigation (Tab, Enter, Esc), ARIA accessibility labels, and email privacy masking.

---

## 3. Bug Bash & Community Feedback Log

* **Issue #1 (Fixed):** Free accounts displaying `Pro` tier.
  * *Resolution:* Extracted protobuf field 36 (`userTier`) from `userStatus` and mapped `free-tier` to `Antigravity Starter`.
* **Issue #2 (Fixed):** Settings opening in external VS Code editor rather than sidebar panel.
  * *Resolution:* Built an embedded, responsive `SettingsView.svelte` directly within the extension panel.
* **Issue #3 (Fixed):** AI-generated emoji icons in quota bars and headers.
  * *Resolution:* Replaced with custom, accessible vector SVG icons (`Icon.svelte`).
* **Issue #4 (Fixed):** CI network ban regex triggering on local IPC method name `fetchLiveQuota`.
  * *Resolution:* Renamed method to `requestLiveQuota` and tightened regex pattern to word boundaries `\bfetch\s*\(`.
