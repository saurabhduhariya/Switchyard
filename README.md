# Switchyard — Multi-Account Switcher for Google Antigravity

<div align="center">

![Switchyard Logo](https://raw.githubusercontent.com/saurabhduhariya/Switchyard/main/media/icon.png)

**Seamlessly manage, monitor, and switch between multiple Google accounts in Antigravity IDE without repeating browser logins.**

[![Open VSX](https://img.shields.io/open-vsx/v/saurabhduhariya/ag-switchyard?color=blue&label=Open%20VSX)](https://open-vsx.org/extension/saurabhduhariya/ag-switchyard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code Engine](https://img.shields.io/badge/Antigravity-^1.107.0-007ACC.svg)](https://code.visualstudio.com/)
[![Zero Telemetry](https://img.shields.io/badge/telemetry-none-success.svg)](#-privacy--security)
[![Zero Network Calls](https://img.shields.io/badge/network-zero-success.svg)](#-privacy--security)

</div>

---

## ⚡ Overview

Google Antigravity IDE binds your editor to a single Google account. Switching accounts normally requires manually signing out, opening a browser OAuth window, approving permissions, and re-authenticating.

**Switchyard** solves this by providing a native sidebar panel where you can save your accounts once and switch between them with **1 click**.

---

## ✨ Features

* **⚡ 1-Click Account Switching:** Switch between your work, personal, and client accounts in seconds without repeated browser OAuth prompts.
* **📊 Live Quotas & Model Usage:** Real-time visibility into your remaining quotas and reset countdowns:
  * **Gemini Models:** Weekly limit %, 5-hour rolling limit, and exact reset time.
  * **Claude & GPT Models:** Weekly limit %, 5-hour rolling limit, and reset countdown.
  * **Accurate Tier Detection:** Automatically identifies **Antigravity Starter** (Free) vs. **Antigravity Pro**.
* **🌓 Dual Switching Modes:**
  * **Token Swap Mode (Default):** Fast, seamless switching inside the same workspace via clean restart.
  * **Isolated Profiles Mode:** Run multiple accounts simultaneously in separate, side-by-side IDE windows.
* **🔒 Encrypted OS Keychain Storage:** Your OAuth tokens are stored exclusively in your operating system's native keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service).
* **🛡️ Zero-Network Guarantee:** Switchyard makes **zero external HTTP or telemetry calls**. Quota data is queried directly from Antigravity's local language server on loopback (`127.0.0.1`).
* **📦 Automatic Backups & Instant Rollback:** Automatically backs up your IDE session database (`state.vscdb`) before every switch. If a token ever fails to verify, Switchyard automatically restores your previous session.
* **⚙️ Embedded In-Panel Settings:** Change switching modes, adjust backup retention, or toggle email masking directly inside the sidebar.
* **👁️ Privacy Mode:** Optional email masking (`u****@domain.com`) to keep your email private while streaming or screen sharing.

---

## 🚀 Quick Start

1. **Install Switchyard:**
   Install directly from the Antigravity Extensions view (`Ctrl+Shift+X`) by searching for `Switchyard` or via the [Open VSX Registry](https://open-vsx.org/extension/saurabhduhariya/ag-switchyard).
2. **Open the Accounts Panel:**
   Click the **Accounts** icon in the Activity Bar. Switchyard will automatically detect your currently logged-in Google account.
3. **Save Your Current Login:**
   Click **Save Current Login** to store your active account credentials securely.
4. **Add Another Account:**
   Click **Add Another Account**. Switchyard will save your current session, sign you out cleanly, and restart the IDE. Sign in with your second Google account once in the browser, and Switchyard will offer to save it.
5. **Switch Anytime:**
   Click **Switch** on any inactive account card to switch instantly!

---

## ⚙️ Configuration & Settings

You can customize Switchyard via the in-panel gear icon or in **Settings** (`Ctrl+,`) under `switchyard.*`:

| Setting | Default | Description |
| :--- | :---: | :--- |
| `switchyard.mode` | `tokenSwap` | `tokenSwap` = switch in the same window (restarts IDE). `profile` = launch isolated windows side-by-side. |
| `switchyard.confirmBeforeSwitch` | `true` | Ask for confirmation before restarting the IDE when switching accounts. |
| `switchyard.maskEmails` | `false` | Mask email addresses in the accounts panel and status bar (e.g. `s****@gmail.com`). |
| `switchyard.backupRetention` | `5` | Number of database backups to retain before pruning old snapshots. |
| `switchyard.executablePath` | `""` | Custom path to the Antigravity binary (leave blank for automatic detection). |

---

## ⌨️ Command Palette Actions

All features can also be triggered via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

* `Switchyard: Switch Account…` — Open quick pick to switch accounts from anywhere.
* `Switchyard: Add Account` — Save the currently active account.
* `Switchyard: Add New Account` — Start the guided sign-out and new account capture flow.
* `Switchyard: Refresh` — Refresh active account status and model quotas.
* `Switchyard: Restore Last Backup` — Revert database to a previous backup snapshot.
* `Switchyard: Open Backups Folder` — Open the backups folder in your system file manager.
* `Switchyard: Settings` — Open the Switchyard settings panel.

---

## 🛡️ Privacy & Security

Switchyard was engineered with strict security principles:

1. **Zero External Network Requests:** The extension contains zero network clients (`fetch`, `http`, `axios`, etc.). Verified by automated CI checks.
2. **Encrypted Storage:** Secrets are stored exclusively in VS Code's encrypted `SecretStorage` vault. Only non-sensitive metadata (labels, email, plan tier) is saved in local extension state.
3. **Log Scrubbing:** Sensitive tokens (`ya29.`, `1//`, base64 tokens) are automatically redacted (`[REDACTED]`) before anything is printed to logs.
4. **Crash-Safe Operations:** All database modifications write to a temporary file first, followed by an atomic rename and SHA-256 fingerprint verification.

---

## ⚠️ Disclaimer

Switchyard is an independent, community-driven open-source extension and is **not affiliated with, endorsed by, or sponsored by Google**.

This tool is designed for legitimate productivity workflows (such as switching between personal, work, and open-source identities). It is not designed to evade or manipulate model usage limits or terms of service. Users are responsible for complying with Google's applicable Terms of Service.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
