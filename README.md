# Switchyard

Switchyard is a sidebar extension for Google Antigravity IDE that lets you manage, monitor, and switch between multiple Google accounts with a single click.

## Features

- **Non-Disruptive Account Addition**: Add new Google accounts without closing your main IDE window using the side-window capture flow.
- **One-Click Switching**: Switch between saved Google accounts without repeating the browser sign-in process.
- **Model Usage & Quotas**: View live remaining quota percentages (weekly and 5-hour limits, or weekly only on the Starter tier) and reset countdowns for Gemini, Claude, and GPT models.
- **Dual Switching Modes**:
  - **Token Swap (Default)**: Switches accounts in the current window via an atomic session swap and restart.
  - **Isolated Profiles**: Launches separate Antigravity windows side-by-side using isolated user data directories.
- **Automatic Backups**: Creates a backup of your session database before every switch, with automatic rollback if a session fails to verify.
- **In-Panel Settings**: Configure switching modes, email masking, and backup retention directly inside the sidebar panel.
- **Privacy & Security**: Zero external network requests. Credentials are encrypted and stored in your operating system's native keychain.

## Usage

### 1. Save Your Current Account
Open the Accounts panel from the Activity Bar. Switchyard automatically detects your active Google session. Click **Save Current Login** to store it.

### 2. Add Additional Accounts
Click **Add Another Account**. A separate Antigravity window opens on the sign-in page. Sign in with the new Google account there; Switchyard detects it, closes that window and shows **Save Account** in your main window. Your main window stays open and your current account stays active the whole time.

The older flow (sign out and restart the IDE) is still available through the `switchyard.addAccountMethod` setting.

### 3. Switch Accounts
Click **Switch** on any inactive account card to switch into that session.

## Switching Modes

Switchyard supports two switching strategies:

1. **Token Swap (Default)**:
   Swaps the active session credentials in `state.vscdb` while the IDE is closed and relaunches the editor into your target account. Ideal when working in a single workspace.

2. **Isolated Profiles**:
   Spawns a separate Antigravity window with `--user-data-dir` pointing to an isolated profile folder. Both accounts can remain open side-by-side simultaneously.

You can toggle between these modes at any time in the in-panel settings drawer or via VS Code settings.

## Adding Accounts: Side-Window Flow

1. Click **Add Another Account** in the sidebar.
2. A temporary Antigravity window opens. Sign in with the new Google account there.
3. Switchyard notices the sign-in, closes the temporary window and reads the saved login. This is automatic; if it is slow, click **I've signed in**.
4. The card shows the detected account. Add an optional label and click **Save Account** (or **Refresh saved session** if the account was already saved).
5. Click **Switch to this account** if you want to use it right away.

Your main IDE window never closes or reloads during this process, and your active account never changes.

**Profile mode:** the same flow is used. The temporary window's data becomes the account's isolated profile, so the first Switch opens it already signed in.

**Good to know**
- The temporary sign-in folder holds live login data, so Switchyard deletes it as soon as the flow ends (saved, cancelled, failed or timed out). A detected account you never save is discarded after 10 minutes.
- Only one sign-in can run at a time. If another Switchyard window already has one open, you will be told.
- If the side window cannot be used on your system, use **Use sign-out method** on the failed card or set `switchyard.addAccountMethod` to `signOutRestart`.

### Troubleshooting

| Problem | What to try |
|---|---|
| The card never turns green | Click **I've signed in**. Then open **View → Output → Switchyard** and look for `Capture watcher status:` lines. |
| "did not provide a login token" | The sign-in did not finish before the window closed. Add the account again and wait for the window to close by itself. |
| The side window shows welcome pages | Set `switchyard.captureWindowArgs` (for example `["--skip-welcome", "--skip-release-notes"]`) and `switchyard.captureWindowDisabledExtensions` (for example `["eamodio.gitlens"]`). |
| The side window will not open | Set `switchyard.executablePath`, or use the sign-out method. |

## Extension Settings

This extension contributes the following settings (`switchyard.*`):

| Setting | Default | Description |
|---|---|---|
| `switchyard.mode` | `tokenSwap` | Switching method: `tokenSwap` (same window with restart) or `profile` (isolated side-by-side windows). |
| `switchyard.addAccountMethod` | `sideWindow` | Method for adding new accounts: `sideWindow` (open separate window without closing main IDE) or `signOutRestart` (legacy sign-out and restart flow). |
| `switchyard.captureWindowArgs` | `[]` | Extra flags for the sign-in window. Allowed: `--skip-welcome`, `--skip-release-notes`, `--skip-add-to-recently-opened`, `--disable-telemetry`, `--disable-workspace-trust`. Machine scope. |
| `switchyard.captureWindowDisabledExtensions` | `[]` | Extension IDs to disable inside the sign-in window only (Switchyard itself cannot be disabled there). Machine scope. |
| `switchyard.confirmBeforeSwitch` | `true` | Ask for confirmation before restarting the IDE during a switch. |
| `switchyard.maskEmails` | `false` | Mask email addresses in the panel and status bar (e.g., `s****@gmail.com`). |
| `switchyard.backupRetention` | `5` | Number of database backups to keep. |
| `switchyard.executablePath` | `""` | Custom path to the Antigravity executable binary (detected automatically if blank). |

## Commands

The following commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Switchyard: Switch Account…` — Show account switcher quick pick.
- `Switchyard: Add Account` — Save the active account.
- `Switchyard: Add New Account` — Start add account flow (opens side window by default).
- `Switchyard: Refresh` — Refresh active account and model quotas.
- `Switchyard: Restore Last Backup` — Restore session database from a backup.
- `Switchyard: Open Backups Folder` — Open backups folder in file manager.
- `Switchyard: Settings` — Open Switchyard settings.

## Security & Privacy

- **How quota freshness works**: Antigravity only reports quota for the account that is signed in, so other accounts show the numbers from the last time they were active (the clock on the card shows how old they are). Switchyard captures the signed-in account's quota one last time right before you switch away from it. If a saved account's reset time has passed since then, its bucket is shown as an estimated `~100%` (with a note), because it has refilled. Estimates never change stored data and cannot know about usage from other devices; switch to the account for exact numbers.
- **Usage trend**: under each Weekly row, a small line shows how that quota has moved over the last 7 days, with a caption such as "Used 12% in 24h". Switchyard keeps a tiny, capped history of weekly readings (at most about 200 per account, never older than a week) in its own local storage; readings are only added when something changed, and an account's history is deleted when you remove the account. The figure only covers the time Switchyard actually has data for, and the caption says so (for example "Used 5% in 5h").
- **Quota errors**: if Switchyard cannot read the signed-in account's quota, the card says so in plain words (for example that the language server is not running yet) with a **Retry** button, instead of showing empty dashes. A single failure right after the IDE starts is not shown, because that is normal. Accounts that have never been signed in show "No quota yet. Switch to this account to load it."
- **Tiers**: which quota windows exist (weekly, 5-hour) is defined in one small table (`TIERS` in `src/shared/quotaRules.ts`). Starter has a weekly quota only; Pro and Ultra have both. Adding or changing a tier is a one-line edit there.
- **Quota reset notifications**: when a quota that was used up on a saved account (10% or less left) has reset, Switchyard tells you once, with a button to switch to that account. It only uses the quota already stored per account, so it makes no network calls. Turn it off with `switchyard.notifyOnQuotaReset`.
- **Best-account hint**: when the signed-in account is running low (10% or less) on a model, a hint above it suggests the saved account with the most left in that same bucket, with a one-click **Switch** and **Not now** (remembered until the situation changes). Accounts whose reset has passed are shown as estimated (`~`). Turn it off with `switchyard.suggestBestAccount`.
- **Offline-First**: Switchyard makes zero external network or telemetry calls. Quota data is queried directly from Antigravity's local language server on loopback (`127.0.0.1`).
- **OS Keychain Encryption**: Sensitive tokens are stored in VS Code's `SecretStorage` API (backed by Windows Credential Manager, macOS Keychain, or Linux Secret Service).
- **Redacted Logging**: All tokens and authorization keys are redacted before anything is logged to output channels.

## Disclaimer

This extension is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. Users are responsible for complying with the applicable Google and Antigravity terms of service for their accounts.
