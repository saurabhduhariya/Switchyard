# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Switchyard, please report it privately:

### Reporting Process

1. **Email:** Send details to `saurabh.duhariya2007@gmail.com` with subject line: `[SECURITY] Switchyard Vulnerability Report`
2. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)
   - Your contact information for follow-up

### What to Expect

- **Acknowledgment:** Within 72 hours
- **Initial Assessment:** Within 1 week
- **Status Updates:** Every 7 days until resolution
- **Fix Timeline:** Critical issues patched within 14 days; others within 30 days
- **Public Disclosure:** Coordinated with reporter after fix is released
- **Credit:** Security researchers credited in release notes (unless anonymity requested)

### Security Response Process

1. Report received and acknowledged
2. Vulnerability validated and severity assessed
3. Patch developed and tested
4. Security advisory published (GitHub Security Advisories)
5. Patch released with version bump
6. Public disclosure after users have time to update

---

## Security Architecture

### Data Handled by Switchyard

This extension handles **highly sensitive authentication credentials**. Understanding what data is processed and how it's protected is critical.

#### Personal Information Processed

| Data Type | Purpose | Storage Location | Encryption |
|-----------|---------|------------------|------------|
| **Google OAuth Tokens** | Account switching | OS Keychain via VS Code SecretStorage | ✅ Encrypted |
| **Email Addresses** | Account identification | VS Code globalState (metadata) | ❌ Plaintext |
| **Display Names** | UI display | VS Code globalState | ❌ Plaintext |
| **Avatar URLs** | UI display | VS Code globalState | ❌ Plaintext |
| **Google Plan Info** | Badge display | VS Code globalState | ❌ Plaintext |

**Critical:** OAuth tokens (refresh tokens, access tokens) are **never** stored in plaintext. They are stored exclusively in the operating system's secure credential storage:
- **Windows:** Windows Credential Manager
- **macOS:** Keychain
- **Linux:** Secret Service API (gnome-keyring, KWallet, etc.)

#### Data NOT Collected

- ❌ No telemetry or analytics
- ❌ No usage statistics
- ❌ No crash reports
- ❌ No network requests of any kind
- ❌ No third-party service integrations

### Security Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  User's Local Machine                                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Switchyard Extension (Sandboxed)                      │ │
│  │                                                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  AccountStore                                    │  │ │
│  │  │  • Reads: OS Keychain (via SecretStorage API)   │  │ │
│  │  │  • Writes: OS Keychain (via SecretStorage API)  │  │ │
│  │  │  • Never touches network                        │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Webview (Isolated Iframe)                       │  │ │
│  │  │  • Receives: Account metadata only (no tokens)   │  │ │
│  │  │  • CSP: Strict Content Security Policy          │  │ │
│  │  │  • No remote resources allowed                   │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  switch-helper.js (Detached Process)             │  │ │
│  │  │  • Runs ONLY when IDE is closed                  │  │ │
│  │  │  • Writes tokens to state.vscdb                  │  │ │
│  │  │  • Job file: 0600 permissions, temp dir          │  │ │
│  │  │  • Auto-deleted after completion                 │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  OS Keychain (Operating System)                        │ │
│  │  • Encrypted at rest                                   │ │
│  │  • Per-user isolation                                  │ │
│  │  • Requires user authentication on some platforms      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  state.vscdb (Antigravity IDE Database)                │ │
│  │  ⚠️  Tokens stored UNENCRYPTED by Antigravity IDE      │ │
│  │  • This is an upstream limitation                      │ │
│  │  • Switchyard only writes when IDE is fully closed     │ │
│  │  • Readable by any local process (OS file permissions) │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Threat Model

For a complete threat analysis, see [`docs/security-review.md`](docs/security-review.md).

**Key Threats Mitigated:**

1. **Token Theft via Network Exfiltration**  
   ✅ **Mitigation:** Extension makes zero network requests. Verified by CI check.

2. **Token Exposure in Logs**  
   ✅ **Mitigation:** All logging goes through `Logger.redact()` which masks tokens and emails.

3. **Token Leakage to Webview**  
   ✅ **Mitigation:** Webview receives only `AccountMeta` (email, label, plan) — never tokens.

4. **Temp File Token Exposure**  
   ✅ **Mitigation:** Job files created with `0600` permissions, deleted in `finally` blocks.

5. **Database Corruption**  
   ✅ **Mitigation:** Atomic writes, pre-write backups, post-write verification, rollback on error.

6. **XSS in Webview**  
   ✅ **Mitigation:** Strict CSP with nonce-based script loading, no remote resources.

7. **Supply Chain Attack**  
   ✅ **Mitigation:** Only one runtime dependency (`sql.js`), npm audit in CI, lockfile committed.

**Residual Risks:**

⚠️ **Local Process Access:** Any process running as your user can read `state.vscdb` because Antigravity IDE stores tokens unencrypted. This is an upstream limitation. Switchyard's OS keychain storage is more secure, but the active session in `state.vscdb` remains readable.

⚠️ **Multi-Window Race Conditions:** Switching while multiple IDE windows are open may cause inconsistency. The extension warns but does not enforce.

### Security Best Practices for Users

1. **Use Strong OS Account Password:** Keychain encryption depends on your OS account security
2. **Keep OS Updated:** Security patches for keychain implementations
3. **Avoid Untrusted Extensions:** Other extensions can read `state.vscdb`
4. **Use Mode A (Profile) for Highest Security:** Profile mode never touches tokens
5. **Regular Backups:** Use the built-in backup system before major operations
6. **Review Logs:** Check Output → Switchyard for any unexpected warnings

### Switching Modes and Security

| Mode | Token Handling | Security Level | Recommended For |
|------|----------------|----------------|-----------------|
| **Profile** (Mode A) | Never reads or writes tokens | ⭐⭐⭐⭐⭐ Highest | Users prioritizing security |
| **Token Swap** (Mode B) | Reads from keychain, writes to DB when IDE closed | ⭐⭐⭐⭐ High | Users wanting same-window experience |

Both modes are safe when used properly, but **Profile mode is recommended** if you have sensitive accounts.

---

## Scope

### In Scope

- Code execution vulnerabilities in the extension
- Token exposure through logs, UI, or network
- Authentication bypass or privilege escalation
- Database corruption leading to data loss
- XSS or code injection in the webview
- Temp file security issues
- Dependency vulnerabilities

### Out of Scope

- Antigravity IDE vulnerabilities (report to Google)
- VS Code core vulnerabilities (report to Microsoft)
- Social engineering attacks
- Physical access attacks (keylogger, screen recording)
- Issues requiring malicious extensions to be installed
- Browser-side OAuth flow vulnerabilities (Google's responsibility)
- OS keychain implementation bugs (report to OS vendor)

---

## Known Limitations

### 1. state.vscdb Unencrypted Storage (Upstream)

**Issue:** The Antigravity IDE stores OAuth tokens in `state.vscdb` without encryption. Any process running as your user can read this file.

**Status:** This is a limitation of Antigravity IDE itself, not Switchyard. Switchyard improves security by storing snapshots in the OS keychain.

**Mitigation:** 
- Use Mode A (Profile) which never touches tokens
- Keep your OS account secure
- Avoid running untrusted software

### 2. Multi-Window Switching

**Issue:** Switching while multiple Antigravity windows are open may cause race conditions.

**Status:** Warning dialog shown, but not strictly enforced.

**Mitigation:** Close other windows before switching, or use Mode A (Profile).

### 3. Token Rotation

**Issue:** Google may rotate refresh tokens periodically. Restoring an old snapshot may fail authentication.

**Status:** Mitigated by re-capturing the active session before every switch.

**Workaround:** If authentication fails, use "Re-authenticate" or sign in again manually.

---

## Compliance and Terms of Service

### Google Terms Alignment

**Unofficial Extension:** Switchyard is not affiliated with, endorsed by, or supported by Google.

**Terms Compliance Strategy:**
- Extension does NOT make API calls using your tokens
- Only the official Antigravity IDE communicates with Google servers
- Mode A (Profile) never manipulates tokens at all
- Mode B (Token Swap) is opt-in experimental with clear warnings

**User Responsibility:** By using this extension, you accept responsibility for ensuring your use complies with:
- Google's Terms of Service
- Antigravity Additional Terms
- Your organization's security policies
- Any applicable laws and regulations

**Prohibited Uses:**
- ❌ Do not use to evade rate limits or quotas
- ❌ Do not use with accounts you don't own or aren't authorized to use
- ❌ Do not extract tokens for use in other applications
- ❌ Do not implement automation or account rotation for abuse

---

## Security Updates

### How We Handle Security Issues

1. **Critical vulnerabilities:** Hotfix within 14 days, emergency release
2. **High severity:** Patch within 30 days, regular release
3. **Medium/Low severity:** Bundled into next minor release

### Update Notifications

- Security fixes announced in `CHANGELOG.md`
- Critical issues: GitHub Security Advisory
- Follow releases: Watch this repository on GitHub

### Supported Channels

- GitHub Issues (non-security bugs)
- GitHub Discussions (questions, feature requests)
- Email (security vulnerabilities only)

---

## Security Checklist (For Contributors)

If you're contributing code:

- [ ] No hardcoded secrets or tokens
- [ ] No network calls (fetch, http, WebSocket, etc.)
- [ ] Sensitive data logged through `Logger.redact()`
- [ ] New commands don't expose tokens to UI
- [ ] Temp files use 0600 permissions
- [ ] Database writes are atomic with rollback
- [ ] Tests don't contain real credentials
- [ ] Dependencies reviewed and justified

---

## Contact

**Security Issues:** saurabh.duhariya2007@gmail.com  
**General Issues:** [GitHub Issues](https://github.com/saurabh/Switchyard/issues)  
**Repository:** [https://github.com/saurabh/Switchyard](https://github.com/saurabh/Switchyard)

---

**Last Updated:** October 2, 2026  
**Version:** 0.1.0
