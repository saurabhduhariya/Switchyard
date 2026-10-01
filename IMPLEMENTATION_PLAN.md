# Switchyard — Detailed Implementation Plan

Companion to `README.md` (research + architecture). This document is the **build order**: what to do, in which sequence, how to know each step is done.

**Project:** `ag-switchyard` — multi-account switcher sidebar for the Antigravity IDE
**Total estimate:** ~5–6 weeks part-time (≈ 25–30 working days) · **Team:** 1 developer

---

## 0. How to use this plan

* Work **phase by phase**. Do not start a phase until the previous phase's **Exit criteria** are all ticked.
* Every phase has: Goal → Prerequisites → Steps → Deliverables → Exit criteria → Pitfalls.
* Anything marked **[VERIFY]** is an assumption about Antigravity that I could not confirm from documentation. Phase 0 exists to settle those. If the result contradicts the plan, update `docs/spike.md` and adjust the later phases.
* Commit at the end of every numbered step (small commits, conventional format: `feat:`, `fix:`, `test:`, `chore:`, `docs:`).

### Master timeline

| Phase | Name | Days | Output |
|------:|------|-----:|--------|
| 0 | Environment + feasibility spike | 1–2 | `docs/spike.md` with facts about your Antigravity build |
| 1 | Repo scaffold + tooling | 2 | Empty panel loads in the IDE from a `.vsix` |
| 2 | Webview UI with mock data | 3–4 | Complete UI, all states, themes, a11y |
| 3 | Platform + DB + identity + store | 4–5 | Tested core library (no UI) |
| 4 | Capture + detection end-to-end | 2–3 | Real active account shown in panel |
| 5 | Profile engine (mode A) | 2–3 | Switch by launching isolated profiles |
| 6 | Token-swap engine (mode B) | 5–7 | Switch in same window via restart |
| 7 | Add-account flow + backup/restore | 2–3 | Full lifecycle: add → switch → remove → restore |
| 8 | Hardening + security | 3 | Audit passed, edge cases handled |
| 9 | Testing + CI | 2–3 | Green CI on 3 OSes |
| 10 | Package + publish | 2 | v0.1.0 on Open VSX + GitHub release |
| 11 | Post-release + maintenance | ongoing | Update-resilience routine |

### Dependency map

```
P0 ─► P1 ─► P2 ──────────────┐
       └──► P3 ─► P4 ─┬─► P5 ─┤
                       └─► P6 ─┼─► P7 ─► P8 ─► P9 ─► P10 ─► P11
```

P2 (UI) and P3 (core) can run in parallel if you want; both only need P1.

### Repo conventions (set up once, in Phase 1)

* Branches: `main` (releasable) ← `feat/phase-N-short-name`. Merge via PR even if you are alone (CI runs on PRs).
* Milestones in GitHub Issues: `v0.1.0-alpha` (end P4), `v0.1.0-beta` (end P7), `v0.1.0` (end P10).
* One GitHub Issue per numbered step below (copy the step title).

---

## Phase 0 — Environment + feasibility spike

**Goal:** replace every assumption with a fact from *your* machine before writing product code.
**Duration:** 1–2 days · **Prerequisites:** Antigravity installed, two Google accounts you own (A and B).

### Steps

**0.1 Install tooling**
1. Install Node.js 20 LTS or newer, Git, and (recommended) pnpm or npm.
2. Install **DB Browser for SQLite** (to inspect `state.vscdb`).
3. `npm i -g @vscode/vsce ovsx` (packaging/publishing; installed now so Phase 10 has no surprises).

**0.2 Record your Antigravity build**
1. In Antigravity: **Help → About**. Write down: Antigravity version, VS Code base version, Electron, Node, OS.
2. Save in `docs/spike.md` under "Environment". The VS Code base version becomes `engines.vscode` later.

**0.3 Locate user data**
1. Check both folders: `…/Antigravity/User/globalStorage/` and `…/Antigravity IDE/User/globalStorage/`
   - Windows: `%APPDATA%`
   - macOS: `~/Library/Application Support`
   - Linux: `~/.config`
2. Note which exists, plus any `state.vscdb`, `state.vscdb.backup`, `-wal`, `-shm` files.

**0.4 Learn which keys carry the login** ([VERIFY] key names)
1. Close Antigravity completely. Copy `state.vscdb` → `spike/signed-out.vscdb` (if signed out) or sign out first.
2. Sign in with **Account A**, use the IDE for a minute, quit fully. Copy DB → `spike/A.vscdb`.
3. Sign out, sign in with **Account B**, quit. Copy DB → `spike/B.vscdb`.
4. Diff with SQL in DB Browser or a script:
   ```sql
   -- run against each file, compare outputs
   SELECT key, length(value) FROM ItemTable
   WHERE key LIKE '%auth%' OR key LIKE '%oauth%' OR key LIKE '%UnifiedStateSync%'
      OR key LIKE '%jetski%' OR key LIKE '%userStatus%' OR key LIKE '%machine%';
   ```
5. Record in `docs/spike.md`: the exact keys that differ between A and B. Expected candidates: `antigravityUnifiedStateSync.oauthToken`, `antigravityUnifiedStateSync.userStatus`, legacy `jetskiStateSync.agentManagerInitState`.
6. **Never commit these files.** Add `spike/` to `.gitignore` now.

**0.5 Decode identity** ([VERIFY])
1. Take the `oauthToken` value → base64-decode → inspect bytes (use a protobuf decoder such as `protoc --decode_raw` or an online raw decoder on a *local* tool, never paste real tokens into websites).
2. Find where the email appears (in `userStatus`, or inside an ID-token JWT). Record the byte path / field numbers.
3. Decide the identity rule: email → else fingerprint.

**0.6 Test sign-out/in effect without a switcher (manual swap experiment)**
1. Quit the IDE. Copy `A.vscdb` over `state.vscdb` (also over `.vscdb.backup`). Launch → are you signed in as A with no browser prompt?
2. Repeat with `B.vscdb`. Note: did it work, any "re-authenticate" prompt, any "environment changed" message, how long did the token stay valid?
3. This single experiment proves or disproves **mode B**.

**0.7 Test profile isolation (mode A)** ([VERIFY] CLI binary name and flags)
1. Find the executable (Windows: `…\Programs\Antigravity\Antigravity.exe`; macOS app bundle; Linux install dir).
2. Run: `<exe> --user-data-dir "<tmp>/agp1" --extensions-dir "<tmp>/ext"`
3. Sign in as A in this window; close. Run again with `…/agp2`, sign in as B.
4. Re-open `agp1`: still A, without browser? Open both at the same time: independent?
5. Record whether the login is stored under the data dir (`state.vscdb`) or elsewhere (OS keyring) — if keyring, isolation may not work.

**0.8 Test quit + relaunch from an extension host** ([VERIFY])
1. Use a throwaway extension (or the dev console) to log `process.execPath`, `process.versions.electron`, `vscode.env.appRoot`.
2. Spawn a detached child: `spawn(process.execPath, ['-e', 'setTimeout(()=>require("fs").writeFileSync("ok.txt","1"),3000)'], {detached:true, stdio:'ignore', env:{...process.env, ELECTRON_RUN_AS_NODE:'1'}}).unref()`, then run `workbench.action.quit`. Did `ok.txt` appear after the IDE closed? This proves the helper pattern.

**0.9 Review the Terms**
1. Read the current Antigravity / Google AI additional terms yourself. Write a 5-line summary and your decision about shipping mode B ("opt-in, warned") in `docs/spike.md`.

### Deliverables
* `docs/spike.md` containing: environment, paths, auth key list, identity rule, results of 0.6 / 0.7 / 0.8, terms decision.
* **Go/No-go decision table**

| Mode | Works? | Default? |
|------|--------|----------|
| A profile isolation | yes | Yes (v0.x Default) |
| B token swap | yes | Yes (Opt-in experimental) |

### Exit criteria
- [x] At least one mode works end-to-end by hand.
- [x] Auth keys and identity rule are known.
- [x] Executable path + flags confirmed.
- [x] Helper-survives-quit pattern confirmed.

### Pitfalls
* Editing the DB while the IDE is running (change is lost on exit).
* Forgetting `state.vscdb.backup` (IDE may restore from it).
* Using your only paid account for risky experiments — test with accounts you can afford to re-login.

---

## Phase 1 — Repo scaffold + tooling

**Goal:** a typed, bundled, linted extension whose empty sidebar panel opens inside real Antigravity.
**Duration:** 2 days · **Prerequisites:** Phase 0 exit criteria.

### Steps

**1.1 Create the repo**
```bash
mkdir ag-switchyard && cd ag-switchyard
git init
npm init -y
mkdir -p src/{platform,accounts,db,switch/helper,ui,util} webview/src media test/{unit,integration,fixtures} docs
```
Add `.gitignore`: `node_modules/ dist/ *.vsix spike/ .vscode-test/ *.vscdb *.vscdb.backup`.

**1.2 Install dependencies**
```bash
npm i -D typescript @types/node @types/vscode@<engine-version> esbuild \
         eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier \
         vitest @vscode/test-electron @vscode/vsce ovsx npm-run-all2
npm i sql.js
npm i -D @types/sql.js
```
Pin `@types/vscode` to the VS Code base version from step 0.2.

**1.3 `tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "commonjs", "lib": ["ES2022"],
    "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "esModuleInterop": true, "skipLibCheck": true, "outDir": "out", "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src", "test"]
}
```

**1.4 `esbuild.mjs`** (extension + helper + sql.js wasm)
```js
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const shared = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  sourcemap: true, minify: !watch, external: ['vscode'], logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');

const jobs = [
  { ...shared, entryPoints: ['src/extension.ts'],              outfile: 'dist/extension.js' },
  { ...shared, entryPoints: ['src/switch/helper/switch-helper.ts'], outfile: 'dist/switch-helper.js' },
];
if (watch) { for (const j of jobs) await (await context(j)).watch(); }
else { for (const j of jobs) await build(j); }
```
> Because `sql.js` is bundled, load the wasm with `locateFile: f => path.join(__dirname, f)` (not `require.resolve`).

**1.5 Webview project (`webview/`)**
```bash
cd webview
npm init -y
npm i -D vite svelte @sveltejs/vite-plugin-svelte typescript @tsconfig/svelte @vscode/codicons
```
`webview/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../dist/webview', emptyOutDir: true, cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.ts',
      output: { format: 'iife', entryFileNames: 'main.js', assetFileNames: 'main[extname]' },
    },
  },
});
```
`webview/src/main.ts` mounts `App.svelte` into `#app`. For now `App.svelte` renders "Hello Switchyard".

**1.6 `package.json` manifest** — copy the `contributes` block from `README.md` §7.1; set `engines.vscode` to the base version from 0.2; scripts:
```json
"scripts": {
  "build:ext": "node esbuild.mjs",
  "build:web": "npm --prefix webview run build",
  "build": "run-s build:ext build:web",
  "watch:ext": "node esbuild.mjs --watch",
  "watch:web": "npm --prefix webview run build -- --watch",
  "watch": "run-p watch:ext watch:web",
  "lint": "eslint src --ext ts",
  "test": "vitest run",
  "test:int": "node ./out/test/integration/runTests.js",
  "package": "vsce package --no-dependencies",
  "vscode:prepublish": "npm run build"
}
```
(`--no-dependencies` is valid because everything is bundled.)

**1.7 Minimal `src/extension.ts` + `PanelProvider`**
* Register `WebviewViewProvider` for `agSwitchyard.panel`.
* HTML shell with nonce CSP exactly as in README §7.2; load `dist/webview/main.js` and `main.css`.
* Add an Activity Bar SVG icon at `media/icon.svg` (monochrome, uses `currentColor`).

**1.8 Lint/format config**: ESLint (`@typescript-eslint/recommended`, `no-floating-promises` on), Prettier, `.editorconfig`, `.vscodeignore` (exclude `src/**`, `webview/**`, `test/**`, `spike/**`, `docs/**`, `**/*.map`, `node_modules/**`).

**1.9 Run it two ways**
1. **F5 dev host** (VS Code or Antigravity can open the project): confirm the Activity Bar icon and "Hello" panel.
2. **Real install:** `npm run build && npm run package` → in Antigravity: Extensions → ⋯ → *Install from VSIX…* → confirm it installs without an engine error and the panel appears.

**1.10 Minimal CI** (`.github/workflows/ci.yml`): checkout → setup-node 20 → `npm ci` → lint → build → test. (Matrix comes in Phase 9.)

### Deliverables
Working scaffold, first `.vsix` installable in Antigravity, CI green.

### Exit criteria
- [x] `.vsix` installs in real Antigravity; panel shows "Hello".
- [x] `npm run build`, `lint`, `test` pass locally and in CI.
- [x] `.vsix` size < 1 MB (sql.js wasm ≈ 0.6 MB is expected).

### Pitfalls
* `engines.vscode` newer than Antigravity's base → "not compatible" install error.
* Forgetting to copy `sql-wasm.wasm` into `dist/`.
* Webview CSP blocking scripts without the nonce.

---

## Phase 2 — Webview UI with mock data

**Goal:** the entire user interface, driven by a fake store, before any real auth code exists.
**Duration:** 3–4 days · **Prerequisites:** Phase 1.

### Steps

**2.1 Shared message types** — create `src/ui/messages.ts` (README §7.3). Import it from the webview via a path alias or a copied `webview/src/messages.ts` (keep a single source: use a tsconfig path alias `@shared/*`).

**2.2 Webview state store** (`webview/src/stores/app.ts`): Svelte store holding `{ accounts, activeId, busy, error, maskEmails }`. A `vscode = acquireVsCodeApi()` wrapper; `window.addEventListener('message', …)` updates the store; on mount post `{type:'ready'}`.

**2.3 Design tokens (`styles.css`)** — only `--vscode-*` variables:
```css
:root { --gap: 8px; --radius: 6px; }
body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
       font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.card { border: 1px solid var(--vscode-widget-border, transparent);
        background: var(--vscode-editor-background); border-radius: var(--radius); }
.card:hover { background: var(--vscode-list-hoverBackground); }
.btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
```

**2.4 Components** (build in this order, each with a mock "story" page toggled by a `?story=` query in dev):
1. `Avatar.svelte` — circle with initial; color from hash of email.
2. `ActiveCard.svelte` — green dot, **ACTIVE** badge, email, label chip, plan badge, "Active since".
3. `AccountCard.svelte` — email, label, last used, **Switch** button, `⋮` menu.
4. `OverflowMenu.svelte` — Rename, Reveal profile folder, Remove (keyboard accessible).
5. `EmptyState.svelte` — "Save your current login" button + 2-line explanation.
6. `SwitchOverlay.svelte` — progress text + "IDE will restart" notice.
7. `ErrorBanner.svelte` and `Toast.svelte` (detected new login → Save / Dismiss).
8. `Header.svelte` (refresh, settings) and `Footer.svelte` (+ Add account).

**2.5 Mock data harness** — a dev-only `mockHost.ts` that emulates the extension host: returns 0, 1, 3 and 12 accounts; simulates a switch (busy → state with new activeId after 1.5 s) and an error. Run webview standalone with `vite dev` and view in a browser; add a theme switcher that applies saved VS Code CSS variable sets (dark, light, high contrast) to test.

**2.6 Accessibility pass**
* Cards are `<li>` in `<ul aria-label="Accounts">`; active card `aria-current="true"`.
* Buttons have accessible names (`aria-label="Switch to work@company.com"`).
* Keyboard: Tab order, Enter = Switch, `F2` rename, `Delete` remove (confirm), `Esc` closes menu.
* Don't rely on color: ACTIVE text badge.
* Respect `prefers-reduced-motion`.

**2.7 Email masking**: `maskEmail('rahul@gmail.com') → 'r****@gmail.com'`, applied when `maskEmails` is on; unit test it.

**2.8 Wire the real `PanelProvider` to a hard-coded fake `AccountStore`** returning static data, to confirm the host ⇄ webview round trip inside the real IDE (switch just logs and shows the overlay for 2 s).

**2.9 Status bar + Quick Pick** (`StatusBar.ts`, `switchyard.switchAccount`): shows the active email; click opens Quick Pick listing accounts (fake data for now).

**2.10 Screenshots**: capture 4 screenshots (dark/light × empty/list) for the README now, while the UI is fresh.

### Deliverables
Complete UI + mock harness, status bar, Quick Pick, 4 screenshots.

### Exit criteria
- [ ] All states render: empty, loading, list, switching, error, new-login toast.
- [ ] Looks correct in dark, light, and high-contrast themes.
- [ ] Fully keyboard-operable; screen-reader labels present.
- [ ] 12 accounts scroll without layout break; long emails truncate with tooltip.

### Pitfalls
* Hard-coding colors (breaks themes).
* Putting business logic in the webview — it must stay a dumb view.
* Sending data the webview shouldn't have; the contract allows metadata only.

---

## Phase 3 — Platform layer, DB access, identity, account store

**Goal:** a fully unit-tested core library with no UI dependency.
**Duration:** 4–5 days · **Prerequisites:** Phase 1 (can run parallel with Phase 2).

### Steps

**3.1 `constants.ts`** — all key names in one place (from `docs/spike.md`):
```ts
export const KEYS = {
  oauth:      'antigravityUnifiedStateSync.oauthToken',
  userStatus: 'antigravityUnifiedStateSync.userStatus',
  legacyInit: 'jetskiStateSync.agentManagerInitState',
} as const;
export const SECRET_PREFIX = 'switchyard.snapshot.';
```

**3.2 `platform/paths.ts`**
* `getUserDataDirs(): string[]` → candidate dirs for the current OS (both `Antigravity` and `Antigravity IDE`).
* `findStateDb(): string | undefined` → first existing `…/User/globalStorage/state.vscdb`.
* Prefer deriving from `context.globalStorageUri` (its parent chain is `…/User/globalStorage`) — the extension's own storage lives next to `state.vscdb`, which is more reliable than guessing. Use OS guessing only as fallback.
* Unit tests: mock `process.platform`/env, assert paths.

**3.3 `db/StateDb.ts`** — implement `readKeys(dbPath, keys)`, `writeKeys(dbPath, entries)`, `deleteKeys` per README §7.5.
* Reads: copy DB (and `-wal` if present) to a temp dir first, read the copy, delete the copy (avoids lock fights with the running IDE).
* Writes: refuse if the IDE appears to be running (`isIdeRunning()` check — Phase 6), write to `.tmp`, `fsync`, rename.
* Single shared `initSqlJs` instance (cache the promise).

**3.4 `db/backup.ts`**
* `createBackup(dbPath): BackupInfo` → copies `state.vscdb`, `state.vscdb.backup`, `-wal`, `-shm` into `<globalStorage>/backups/<ISO-timestamp>/`.
* `listBackups()`, `restoreBackup(info)`, `pruneBackups(keep)`.
* Set file mode `0600` where supported.

**3.5 `accounts/identity.ts`**
* `parseSnapshot(oauthValue, userStatusValue?) → { email?, plan?, fingerprint }` following the rule from Phase 0.5.
* Small helpers: `b64decode`, `readVarint`, `readFields(buf)` (length-delimited protobuf walker), `jwtPayload(token)`, `fingerprint(refreshToken)`.
* Tests with **synthetic** values built in the test (never real tokens).

**3.6 `accounts/types.ts`**
```ts
export type Snapshot = { values: Record<string, string>; capturedAt: number };
export type AccountMeta = { id: string; email: string; label?: string; plan?: string;
                            addedAt: number; lastUsedAt?: number; fingerprint: string };
```
`id = sha256(email.toLowerCase()).slice(0,16)`.

**3.7 `accounts/AccountStore.ts`**
* Constructor takes `{ secrets: SecretStorage, state: Memento }` (interfaces, so tests can pass fakes).
* Methods: `list()`, `get(id)`, `upsertFromSnapshot(snapshot, label?)`, `saveSnapshot(id, snap)`, `loadSnapshot(id)`, `rename`, `remove` (also deletes the secret), `setActive(id)`, `activeId()`.
* All mutations go through `util/mutex.ts` (a promise-chain mutex).
* Keep secrets only in `secrets`; metadata only in `state`.

**3.8 `accounts/AuthDetector.ts`**
* `detectActive(): Promise<{ identity, snapshot } | undefined>`: read keys → `parseSnapshot` → match by email, else fingerprint.
* Returns `unsupported` with a clear reason if keys are missing/changed.

**3.9 `util/logger.ts` + `util/redact.ts`**
* Output channel "Switchyard".
* `redact(s)` masks anything resembling tokens (long base64, `ya29.`, `1//`) and emails when requested. A lint-style unit test asserts no logger call receives a raw snapshot value.

**3.10 Test fixtures**: `test/fixtures/makeDb.ts` builds a synthetic `state.vscdb` with sql.js (ItemTable + fake keys). Used by all tests.

### Deliverables
Core library with ≥ 80% coverage on `db/`, `accounts/`, `platform/`.

### Exit criteria
- [ ] `npm test` passes, no real tokens in repo (`gitleaks` clean).
- [ ] Round-trip test: write keys → read keys returns identical strings (byte-for-byte).
- [ ] Backup → corrupt DB → restore test passes.
- [ ] Store tests prove tokens never appear in `state` (only in `secrets`).

### Pitfalls
* Re-encoding the token value (must be treated as an opaque string).
* sql.js `export()` writes the *whole* DB — fine when IDE is closed, destructive if a second writer exists.
* Windows file locks: rename can fail with `EPERM`; retry with backoff (3 tries, 100 ms).

---

## Phase 4 — Capture + detection end-to-end

**Goal:** the panel shows your **real** accounts and the real active one.
**Duration:** 2–3 days · **Prerequisites:** Phases 2 and 3.

### Steps

**4.1 Wire core into `extension.ts`**: build `AccountStore`, `AuthDetector`, `PanelProvider`, `StatusBar`; dispose via `context.subscriptions`.

**4.2 First-run capture**
1. On activation, `detectActive()`.
2. If an identity exists and it is not saved → panel shows the **new login toast**: "Save *x@y.com*?".
3. On Save → `store.upsertFromSnapshot`, set active, push state.

**4.3 `switchyard.addAccount` (capture variant)**: if the current login is unsaved → save it; if already saved → info message "Already saved". (The guided new-account flow is Phase 7.)

**4.4 Live refresh**
* `fs.watch` the DB's directory for `state.vscdb` changes; debounce 500 ms; re-detect.
* Refresh on `vscode.window.onDidChangeWindowState` (focused).
* On every detection where identity matches a saved account, **update its stored snapshot** (keeps refresh tokens fresh against rotation). Rate-limit to once per 60 s.

**4.5 Panel actions**: Rename and Remove implemented for real (confirm dialog on remove; remove deletes the secret).

**4.6 Settings + context keys**: implement `switchyard.maskEmails`; add `setContext('switchyard.hasAccounts', …)` for menu `when` clauses.

**4.7 Manual test (alpha)**: sign in as A → Save; (use a second profile or manual DB swap from Phase 0) sign in as B → Save; confirm both appear and the ACTIVE marker follows the real login.

**4.8 Tag `v0.1.0-alpha`** (internal; not published).

### Exit criteria
- [ ] Real email + ACTIVE marker correct for A and B.
- [ ] Panel updates within ~1 s of a login change.
- [ ] `grep -r "oauthToken"` shows no value logged; Output channel contains no secrets.
- [ ] Remove deletes the secret (verify via `context.secrets.get` returning undefined).

### Pitfalls
* Detection loops: updating the snapshot triggers the watcher — compare content hash before saving.
* Treating the IDE's own rewrites (frequent) as account changes; only react when the identity changes.

---

## Phase 5 — Profile engine (mode A)

**Goal:** switching works by opening each account in its own isolated profile window.
**Duration:** 2–3 days · **Prerequisites:** Phase 4 and Phase 0 result for 0.7 = yes. *(If 0.7 failed, skip to Phase 6 and make mode B the default.)*

### Steps

**5.1 `platform/ide.ts`**
* `findExecutable()` — `process.execPath` if it is the IDE binary; otherwise per-OS defaults; allow override via setting `switchyard.executablePath`.
* `buildLaunchArgs({ userDataDir, extensionsDir, folders })`.
* `getSharedExtensionsDir()` — the running IDE's extensions folder (typically `~/.antigravity/extensions` or similar — **[VERIFY]** from `context.extensionUri` parent).

**5.2 `switch/SwitchEngine.ts`** interface + factory chosen by `switchyard.mode`.

**5.3 `switch/ProfileEngine.ts`**
1. Profile dir: `<globalStorage>/profiles/<accountId>`.
2. `switchTo(id)`: if a window for that profile is already open (track PIDs in `globalState`, verify alive) → bring it forward is not possible via API, so show info "Already open"; otherwise spawn: `spawn(exe, ['--user-data-dir', dir, '--extensions-dir', shared, '--new-window', ...folders], {detached:true, stdio:'ignore'}).unref()`.
3. First open of a profile = empty login; show the guidance toast "Sign in once with *x@y.com* in the new window".
4. Mark `lastUsedAt`.

**5.4 Settings sync action** ("Copy my settings into this profile"): copy `settings.json`, `keybindings.json`, `snippets/` from the current user dir into the profile (confirm overwrite).

**5.5 Panel semantics for mode A**: "Active" = the account of *this* window. The Switch button label becomes **Open**. Update UI copy by a `mode` field in the state message.

**5.6 Tests**: unit-test `buildLaunchArgs`; integration smoke test that spawn is invoked with the right args (inject a fake spawner).

### Exit criteria
- [ ] Clicking Open on B launches an isolated window already signed in as B (after its first-time login).
- [ ] A's window is untouched.
- [ ] Shared extensions load in the profile window.
- [ ] No token is read or written by this mode (verify with a code search: ProfileEngine imports nothing from `db/`).

### Pitfalls
* Profile windows don't share settings/keybindings unless copied.
* Paths with spaces on Windows — always pass args as an array, never a shell string.

---

## Phase 6 — Token-swap engine (mode B)

**Goal:** switch accounts inside the same workspace via a safe quit → swap → relaunch.
**Duration:** 5–7 days · **Prerequisites:** Phase 4, Phase 0 result for 0.6 and 0.8 = yes.
**Gate:** ship behind `switchyard.mode = "tokenSwap"` with a warning dialog (see README §13).

### Steps

**6.1 Job file contract** (`src/switch/job.ts`)
```ts
export type SwitchJob = {
  version: 1;
  parentPid: number;
  dbPath: string;
  targetEmail: string;
  targetFingerprint: string;
  values: Record<string, string>;     // keys → values to write
  deleteKeys?: string[];
  backupDir: string;
  relaunch: { exe: string; args: string[] };
  resultFile: string;                 // helper writes JSON status here
};
```
Job file is written with mode `0600` in `os.tmpdir()` with a random name; it is the **only** place tokens leave SecretStorage, and it is deleted by the helper in `finally`.

**6.2 `isIdeRunning` + `waitForExit(pid)`** — poll `process.kill(pid, 0)` every 200 ms (ESRCH → exited), timeout 30 s. Also check for other IDE processes holding the DB (other windows): on Windows try opening the DB for exclusive write; on Unix check lsof-like via attempt to rename → fallback to a warning "Close other Antigravity windows".

**6.3 `switch/helper/switch-helper.ts`** (own bundle, no `vscode` import)
```ts
async function main(jobPath: string) {
  const job: SwitchJob = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const result = { ok: false, error: undefined as string | undefined };
  try {
    await waitForExit(job.parentPid, 30_000);
    const backup = createBackup(job.dbPath, job.backupDir);       // all sidecar files
    try {
      await writeKeys(job.dbPath, job.values);
      for (const k of job.deleteKeys ?? []) await deleteKey(job.dbPath, k);
      await syncBackupFile(job.dbPath, job.values);               // state.vscdb.backup too
      await verify(job.dbPath, job.targetFingerprint);            // re-read + compare
      result.ok = true;
    } catch (e) {
      restoreBackup(backup);                                      // rollback
      result.error = String(e);
    }
  } catch (e) { result.error = String(e); }
  finally {
    fs.writeFileSync(job.resultFile, JSON.stringify(result));
    try { fs.rmSync(jobPath, { force: true }); } catch {}
    spawn(job.relaunch.exe, job.relaunch.args, { detached: true, stdio: 'ignore' }).unref();
  }
}
main(process.argv[2]);
```
* Always relaunch (even on failure) so the user is never left without an IDE.

**6.4 `switch/TokenSwapEngine.ts`** — `switchTo(id)`:
1. Confirm dialog (modal): explains restart; "Don't ask again" only if `confirmBeforeSwitch=false`.
2. Detect current identity; **re-capture** and `saveSnapshot` for the current account (rotation safety).
3. Load target snapshot from SecretStorage; if missing → error "Re-capture this account".
4. Build the job; write job file; spawn helper:
   ```ts
   spawn(process.execPath, [helperPath, jobPath], {
     detached: true, stdio: 'ignore',
     env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
   }).unref();
   ```
5. Mark `pendingSwitch = { targetId, startedAt }` in `globalState`.
6. Webview shows overlay → `vscode.commands.executeCommand('workbench.action.quit')`.
7. If the IDE is still running after 10 s (quit blocked by unsaved files), show "Save your files; the IDE will restart when you close it", keep the helper waiting.

**6.5 Post-restart reconciliation** (in `activate`)
1. Read `resultFile`; if `ok` → detect active; if it equals `pendingSwitch.targetId` → toast "Switched to …"; clear pending.
2. If `!ok` → error banner with the message and **Restore backup** button; show the previous account as active.
3. Clean up stale job/result files.

**6.6 Relaunch arguments**: reopen the same workspace(s): `vscode.workspace.workspaceFolders` → pass their `fsPath`s; pass `--reuse-window` not needed on a fresh start. Note the IDE normally restores previous windows itself — **[VERIFY]** whether you need to pass folders at all; passing none and relying on session restore avoids duplicate windows.

**6.7 Multi-window handling**: if more than one IDE window is open, warn: "Switching restarts all Antigravity windows."

**6.8 Cross-OS specifics**
* Windows: `windowsHide: true` on spawn; handle `EPERM` on rename with retry; account for long-path prefixes.
* macOS: executable is inside the `.app` bundle (`Contents/MacOS/…`) — or `open -a` for relaunch; keyring not involved for the IDE.
* Linux: Wayland/X11 env vars must pass through (`...process.env`); AppImage executable path differs — use `process.env.APPIMAGE` if set.

**6.9 Tests**
* Helper test: create fixture DB with account A, job to switch to B, fake parent PID (a short-lived child), assert DB now has B and verification passes.
* Failure test: corrupt `values` → helper rolls back → DB equals original.
* Crash test: kill helper after backup but before write → DB unchanged; start-up reconciliation reports no result file → "Switch did not complete" message.

### Deliverables
Working mode B with rollback, result reporting, and tests.

### Exit criteria
- [ ] A → B → A cycle works 10 times in a row with no browser prompt (OS: your main one).
- [ ] Forced failure restores the original account and shows a clear message.
- [ ] No token values in logs, temp files removed after every run.
- [ ] Switching with unsaved files behaves sanely (IDE asks to save; helper waits).

### Pitfalls
* Writing before the IDE fully exits (race) → verify step catches it; the wait loop must also wait ~500 ms after PID exit for file handles to release.
* Restoring a stale snapshot after token rotation → always re-capture first.
* The IDE writes `state.vscdb.backup` on startup/exit; forgetting it can bring back the old session.
* Zombie helper: set an overall helper timeout (60 s) and exit with a result file.

---

## Phase 7 — Add-account flow + backup/restore UX

**Goal:** complete user lifecycle with no developer knowledge required.
**Duration:** 2–3 days · **Prerequisites:** Phases 5/6.

### Steps

**7.1 Guided "Add new account"** (mode B)
1. Modal explanation: "We'll save your current account, sign you out, and restart. Sign in with the new Google account once; Switchyard will then offer to save it."
2. Save current snapshot → job with `deleteKeys` for the auth keys (signed-out state) → restart.
3. After restart, extension detects "no identity" → panel shows a step card: **Sign in with your new account** with a button to open the IDE's sign-in command if one exists **[VERIFY]**.
4. When a new identity appears → toast "Save *new@x.com*?" (Phase 4 logic).
5. Escape hatch: "Cancel and restore *previous account*" on the step card.

**7.2 Guided "Add new account"** (mode A): create a profile dir, launch it, show the same guidance, auto-detect when its identity appears (the profile window runs its own copy of the extension → it saves the account into… its own store!). Resolve by sharing metadata: store the account list in a **shared file** `~/.switchyard/accounts.json` (metadata only, no secrets) plus per-profile SecretStorage handoff **or** make the main window detect the profile's DB read-only and import the snapshot. Decide in a short design note `docs/profile-sync.md` before coding; simplest option: main window polls the profile's `state.vscdb` (read-only) until an identity appears.

**7.3 Backups UI**
* Command `switchyard.restoreBackup`: Quick Pick of backups (timestamp + account at the time); confirm; runs the helper in restore mode (same quit → write → relaunch pipeline).
* Settings: `backupRetention`.
* Panel overflow: "Open backups folder".

**7.4 Re-login action** for an account whose snapshot is stale/invalid: "Re-authenticate" → runs the guided add flow targeted to that email.

**7.5 Edit/organise**: drag-to-reorder (persist order), label color, pin favorites (store in `globalState`).

**7.6 First-run walkthrough**: contribute a VS Code **walkthrough** (`contributes.walkthroughs`) with 4 steps (open panel, save current account, add second account, switch).

**7.7 Tag `v0.1.0-beta`** and have 1–2 friends test on their machines.

### Exit criteria
- [ ] A brand-new user can add two accounts and switch between them using only the UI.
- [ ] Cancel at every step leaves the original account working.
- [ ] Restore Backup recovers from a deliberately corrupted DB.

### Pitfalls
* Guidance text must be explicit that the browser sign-in happens exactly once per new account.
* Don't auto-save a detected account without the user's consent.

---

## Phase 8 — Hardening + security

**Goal:** make failure safe and the codebase auditable.
**Duration:** 3 days · **Prerequisites:** Phase 7.

### Steps

**8.1 Threat-model review** — walk the table in README §9 line by line; fix gaps; record results in `docs/security-review.md`.

**8.2 Secret hygiene audit**
1. Search the code: `grep -rn "console\." src` (replace with logger), `grep -rn "fetch\|http\|https\|net\.\|XMLHttpRequest\|WebSocket" src` (expect **zero** network use).
2. Run `gitleaks detect` and add as a CI step.
3. Test: log output after a full add+switch cycle contains no token-like strings (automated regex test).

**8.3 Version/format guard**: if expected keys are missing or fail to parse, set state `unsupported` → panel shows a banner "This Antigravity version isn't supported yet" and **disables** destructive actions (switch/add) while keeping read-only features.

**8.4 Edge cases to implement and test**

| Case | Behaviour |
|------|-----------|
| DB missing | Friendly message, no crash |
| DB locked / read-only | Retry then clear error |
| Disk full during write | Atomic temp file prevents partial write; error shown |
| Antigravity updates changes keys | Unsupported banner (8.3) |
| Two IDE windows open | Warning dialog (6.7) |
| Account removed from Google / token revoked | "Re-authenticate" action (7.4) |
| Snapshot missing in SecretStorage (keychain reset) | Account marked "needs re-login" |
| Same account saved twice | De-duplicate by email |
| Extension disabled mid-switch | Helper still completes; result file read next start |

**8.5 Failure-injection scripts** (`test/failure/`): kill helper at each stage; make DB read-only; delete backup; truncate DB. Document expected outcomes.

**8.6 Telemetry stance**: none. Add to README: "No network calls, no telemetry" and a CI check that fails if `src/` contains network APIs.

**8.7 Dependency policy**: only `sql.js` as runtime dependency; `npm audit --omit=dev` in CI; Dependabot weekly; commit lockfile.

**8.8 Performance check**: activation time < 150 ms (measure with *Developer: Show Running Extensions*), panel first paint < 300 ms, no timers when hidden.

### Exit criteria
- [ ] All edge cases in 8.4 behave as specified (automated where possible).
- [ ] No network API usage in `src/`; gitleaks clean.
- [ ] Unsupported-version guard verified by renaming keys in a fixture DB.

---

## Phase 9 — Testing + CI

**Goal:** confidence on Windows, macOS and Linux with every push.
**Duration:** 2–3 days · **Prerequisites:** Phase 8.

### Steps

**9.1 Test pyramid targets**
* Unit (Vitest): ≥ 80% lines on `db/`, `accounts/`, `platform/`, `switch/` (excluding thin vscode glue).
* Integration (`@vscode/test-electron`): activate extension, execute commands, round-trip webview messages with a stub.
* Helper end-to-end: Phase 6.9 tests.

**9.2 Integration runner** (`test/integration/runTests.ts`)
```ts
import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';
(async () => {
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, '../../..'),
    extensionTestsPath: path.resolve(__dirname, './suite/index'),
    launchArgs: ['--disable-extensions'],
  });
})();
```
(Runs on stock VS Code, which is fine for API-level behaviour; real Antigravity is covered by the manual matrix.)

**9.3 Final CI workflow**
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix: { os: [ubuntu-latest, windows-latest, macos-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci && npm --prefix webview ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
      - run: xvfb-run -a npm run test:int
        if: runner.os == 'Linux'
      - run: npm run test:int
        if: runner.os != 'Linux'
      - run: npm audit --omit=dev --audit-level=high
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
```

**9.4 Manual test matrix** (`docs/manual-tests.md`) — run before every release

| # | Scenario | Win | macOS | Linux |
|---|----------|:---:|:-----:|:-----:|
| 1 | Fresh install, no accounts → empty state | | | |
| 2 | Save current account | | | |
| 3 | Add second account (guided) | | | |
| 4 | Switch A→B→A ×10 | | | |
| 5 | Switch with unsaved files | | | |
| 6 | Switch with 2 windows open | | | |
| 7 | Forced failure → rollback | | | |
| 8 | Restore backup | | | |
| 9 | Remove account | | | |
| 10 | Dark / light / high contrast | | | |
| 11 | Upgrade install over older version | | | |
| 12 | Uninstall → leftover files? | | | |

**9.5 Bug bash**: ask 2–3 people to follow only the walkthrough; log every confusion as an issue.

### Exit criteria
- [ ] CI green on all three OSes.
- [ ] Manual matrix completed on your main OS and at least one other.
- [ ] Zero P0/P1 open issues.

---

## Phase 10 — Package + publish

**Goal:** v0.1.0 live on Open VSX with release notes.
**Duration:** 2 days · **Prerequisites:** Phase 9.

### Steps

**10.1 Marketplace assets**
* `media/icon.png` 128×128 (opaque, simple), banner color in `galleryBanner`.
* README with: what it does, GIF of switching, install steps, **Safety & Terms section**, FAQ, troubleshooting, uninstall/cleanup instructions.
* `CHANGELOG.md` (Keep a Changelog), `LICENSE` (MIT), `SECURITY.md`.
* `package.json` fields: `publisher`, `repository`, `bugs`, `homepage`, `keywords`, `categories`, `icon`, `license`.

**10.2 Disclaimers** (must be in README and the first-run walkthrough)
> Unofficial; not affiliated with Google. Use only accounts you own or are authorized to use. Not designed to evade usage limits. Token-swap mode is experimental and you accept responsibility for complying with the applicable terms.

**10.3 Package and smoke-test**
```bash
npm ci && npm --prefix webview ci
npm run build
npx @vscode/vsce package --no-dependencies     # → ag-switchyard-0.1.0.vsix
```
Install the `.vsix` into a **clean** Antigravity profile and run manual tests 1–4.

**10.4 Open VSX account setup (one time)**
1. Sign in at open-vsx.org with GitHub; create an access token.
2. Sign the Publisher Agreement.
3. `npx ovsx create-namespace <publisher> -p $OVSX_PAT`
4. (Optional) claim the namespace verification via the GitHub flow described in the Open VSX wiki.

**10.5 Publish**
```bash
npx ovsx publish ag-switchyard-0.1.0.vsix -p $OVSX_PAT
```
Verify it appears in Antigravity's Extensions search (may take several minutes to index).

**10.6 Release automation** (`.github/workflows/release.yml`): on tag `v*` → build → package → `ovsx publish` using the `OVSX_PAT` repo secret → attach `.vsix` to a GitHub Release → generate notes from Conventional Commits.

**10.7 Tag and announce**: `git tag v0.1.0 && git push --tags`. Post in relevant communities with the disclaimers visible.

### Exit criteria
- [ ] Installing from the Extensions view in Antigravity works and the panel opens.
- [ ] GitHub release has the `.vsix`, notes, and checksums.
- [ ] README renders correctly on Open VSX (images use absolute URLs).

### Pitfalls
* Relative image paths in README break on the registry — use absolute raw URLs.
* Publishing with a stale `dist/` — always run a clean build in CI.
* Namespace mismatch between `publisher` and the Open VSX namespace.

---

## Phase 11 — Post-release + maintenance

**Goal:** stay working as Antigravity changes.
**Cadence:** ongoing.

### Steps

**11.1 Update-watch routine** — on every Antigravity release: install the new build, run the manual matrix rows 1–4, and run a script `npm run probe` that checks the auth keys still exist and parse (prints OK/FAIL, never values).

**11.2 Issue triage SLA**: reply within 72 h; label `bug`, `compat`, `docs`, `security`. Security reports go through `SECURITY.md` (private).

**11.3 Compatibility table in README**: Antigravity version → Switchyard version → status.

**11.4 Roadmap candidates (post-1.0)**
* Antigravity 2.0 desktop and `agy` CLI support (keyring / token file) as separate opt-in adapters.
* Localization via `vscode.l10n`.
* Per-workspace "preferred account" reminder (notification only — **no automatic switching**).
* Export/import of *metadata only* (labels, order).
* Optional Microsoft Marketplace publish.

**11.5 Release rhythm**: patch releases for compat within days; minor releases monthly; keep `CHANGELOG.md` accurate.

---

## Appendix A — Definition of Done (applies to every step)

- [ ] Code compiles with `strict`, lint clean.
- [ ] Unit tests added/updated; coverage not reduced.
- [ ] No token or email in logs (checked).
- [ ] UI changes checked in dark + light + high contrast.
- [ ] Docs updated (README / CHANGELOG / this plan's checklist).
- [ ] Conventional commit pushed, CI green.

## Appendix B — Risk register (live document)

| ID | Risk | Phase | Trigger | Response |
|----|------|-------|---------|----------|
| R1 | Neither mode works on user's build | 0 | Spike fails | Stop; document findings; consider using an existing switcher |
| R2 | Antigravity changes key format | 8, 11 | Probe fails | Unsupported guard + hotfix |
| R3 | Terms interpretation turns negative | all | Google statement / enforcement news | Disable mode B by default, keep mode A; update README |
| R4 | Token rotation breaks snapshots | 6 | "Re-login" reports | Re-capture before switch (already planned); add detector refresh |
| R5 | Data loss on write | 6, 8 | Any report | Backups, atomic writes, rollback, restore UI |
| R6 | Helper blocked by AV/OS policy | 6 | Windows Defender / Gatekeeper | Document; fall back to mode A |
| R7 | Open VSX publish issues | 10 | Namespace/token errors | Follow wiki; publish manual `.vsix` on GitHub |

## Appendix C — Issue backlog template (copy into GitHub)

```
[P0] 0.1 Install tooling
[P0] 0.4 Learn which keys carry the login
[P0] 0.6 Manual swap experiment
… (one issue per numbered step; label with phase:N)
```

## Appendix D — Quick command reference

```bash
npm run build           # extension + helper + webview
npm run watch           # live rebuild
npm test                # unit tests
npm run test:int        # integration tests (VS Code host)
npm run package         # build .vsix
npx ovsx publish *.vsix -p $OVSX_PAT
```

---

*Unofficial community project; not affiliated with Google. Verify all [VERIFY] items in Phase 0 before relying on them.*
