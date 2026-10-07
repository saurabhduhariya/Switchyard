# Switchyard

Switchyard is a sidebar extension for Google Antigravity IDE that lets you manage, monitor, and switch between multiple Google accounts with a single click.

## Features

- **Non-Disruptive Account Addition**: Add new Google accounts without closing your main IDE window using the side-window capture flow.
- **One-Click Switching**: Switch between saved Google accounts without repeating the browser sign-in process.
- **Model Usage & Quotas**: View live remaining quota percentages (weekly and 5-hour limits) and reset countdowns for Gemini, Claude, and GPT models.
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
Click **Add Another Account** in the sidebar. By default, Switchyard opens a separate temporary window where you can sign in with a new Google account. Once signed in, Switchyard automatically detects the new account and saves it—your main workspace stays open the entire time.

Alternatively, you can use the legacy method (configured via `switchyard.addAccountMethod` setting) which signs you out and restarts the IDE for the new account sign-in.

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

By default, Switchyard uses a **non-disruptive side-window flow** to add new Google accounts:

1. Click **Add Another Account** in the sidebar
2. A separate temporary Antigravity window opens
3. Sign in with your new Google account in this window
4. Switchyard automatically detects and saves the new account
5. The temporary window closes, and you're back to your main workspace

**Your main IDE window never closes or reloads during this process**, allowing you to continue working while adding accounts.

### Legacy Sign-Out Method

If you prefer the traditional approach, you can switch to the legacy method via the `switchyard.addAccountMethod` setting:
- Set to `signOutRestart` to use the original sign-out and restart flow
- Set to `sideWindow` (default) for the non-disruptive side-window method

## Extension Settings

This extension contributes the following settings (`switchyard.*`):

| Setting | Default | Description |
|---|---|---|
| `switchyard.mode` | `tokenSwap` | Switching method: `tokenSwap` (same window with restart) or `profile` (isolated side-by-side windows). |
| `switchyard.addAccountMethod` | `sideWindow` | Method for adding new accounts: `sideWindow` (open separate window without closing main IDE) or `signOutRestart` (legacy sign-out and restart flow). |
| `switchyard.confirmBeforeSwitch` | `true` | Ask for confirmation before restarting the IDE during a switch. |
| `switchyard.maskEmails` | `false` | Mask email addresses in the panel and status bar (e.g., `s****@gmail.com`). |
| `switchyard.backupRetention` | `5` | Number of database backups to keep. |
| `switchyard.executablePath` | `""` | Custom path to the Antigravity executable binary (detected automatically if blank). |

## Commands

The following commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Switchyard: Switch Account…` — Show account switcher quick pick.
- `Switchyard: Add Account` — Save the active account.
- `Switchyard: Add New Account` — Start guided sign-out and capture flow.
- `Switchyard: Refresh` — Refresh active account and model quotas.
- `Switchyard: Restore Last Backup` — Restore session database from a backup.
- `Switchyard: Open Backups Folder` — Open backups folder in file manager.
- `Switchyard: Settings` — Open Switchyard settings.

## Security & Privacy

- **Offline-First**: Switchyard makes zero external network or telemetry calls. Quota data is queried directly from Antigravity's local language server on loopback (`127.0.0.1`).
- **OS Keychain Encryption**: Sensitive tokens are stored in VS Code's `SecretStorage` API (backed by Windows Credential Manager, macOS Keychain, or Linux Secret Service).
- **Redacted Logging**: All tokens and authorization keys are redacted before anything is logged to output channels.

## Disclaimer

This extension is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. Users are responsible for complying with the applicable Google and Antigravity terms of service for their accounts.
