# Switchyard: Enhancement Suggestions

Short list, most valuable first. Details can be worked out when you pick one.

## High value

1. **Profile mode via side-window capture**
   Profile mode still asks for a typed label and saves an empty account (fake `unknown-…@switchyard.local` email). Run the capture flow instead, then rename the finished capture folder to `profiles/<account>`. The account gets its real email and opens already signed in.

2. **"Switch to this account now" after saving**
   Add a button on the success card so the user can switch right after adding, which is the likely next step.

3. **Expire unsaved detected accounts**
   If an account is detected but never saved, its tokens stay on disk until the 3-hour startup sweep. Auto-discard after ~10 minutes and align the CHANGELOG (it says 1 hour, code says 3).

## Medium value

4. **"Use sign-out method instead" button**
   Show it on the failed state. Today the fallback to the legacy flow only happens if the side window fails to start, not if sign-in fails later.

5. **Multiple IDE windows safety**
   The capture session lives in shared state, so a second main window could clear or duplicate an active session. Store a window ID in the session and let only that window act on it.

6. **Warn when the account is already active or saved**
   Show a clear message like "That's already your active account" or "Already saved, refreshing" instead of silently refreshing.

7. **Quieter side window**
   The side window opens extension welcome pages (e.g. GitLens). Try launch flags such as `--skip-welcome` / `--skip-release-notes` or disabling specific extensions, then expose them as a setting. Check which flags Antigravity supports first.

## Lower priority

8. **Lighter process checks on Windows**
   The window check starts PowerShell about every 400 ms while closing. Poll about once per second instead.

9. **More tests**
   Cover the "already active account" case, auto-finish end to end, and the cleanup sweeper with stale sessions.

10. **Release housekeeping**
    Bump the version, update the CHANGELOG to match the code, and refresh the walkthrough images and README for the side-window flow.
