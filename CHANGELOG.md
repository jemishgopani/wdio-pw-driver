# Changelog

All notable changes to `wdio-pw-driver` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project does not yet follow strict SemVer (pre-1.0).

## [Unreleased]

### Added
- **Playwright-native auto-wait for WDIO commands (PWService overrides)** — `PWService.before()` now transparently overrides `click`, `waitForExist`, and `waitForDisplayed` on every browser/element instance so they route through Playwright primitives. Users write standard WDIO and gain (a) `click(opts)` accepting Playwright's full option surface (`force`, `trial`, `position`, `timeout`, `button`, `modifiers`, `clickCount`, `delay`, `noWaitAfter`); (b) `waitForExist`/`waitForDisplayed` polling **inside the page** via `locator.waitFor({state})` instead of WDIO's protocol-roundtrip polling. The visibility check is also stricter — handles `content-visibility`, `aria-hidden`, animated layouts. Escape hatch: `wdio:pwOptions.strictActionability: false` skips the overrides for tests that relied on chromedriver's looser actionability.
- **Internal protocol commands backing the overrides**: `pwClickElement(elementId, opts)` and `pwWaitElementFor(elementId, {state, timeout})`. Not user-visible; the overrides are the public surface.
- **Documentation site (`website/`)** — Docusaurus 3 + TypeScript site mirroring the `mobilewright.dev/docs` shape (left sidebar + top search + right anchor TOC + auto light/dark). Custom landing page (hero + 6 feature cards + 30-second-setup), brand palette + gradient banner matching the report theme, sidebar grouped into Reference / Guides / Internals. Markdown source lives in `website/docs/` (8 topic files migrated from the old `wdio-pw-driver/docs/` which was deleted to avoid drift). Deployed to `https://jemishgopani.github.io/wdio-pw-driver/` automatically on push to `main` via `.github/workflows/deploy-docs.yml` (modern Pages-from-Actions flow — Settings → Pages → Source = GitHub Actions).
- **Spec-level isolation helper: `installPerTestHooks({ mode })`** — exported from `wdio-pw-driver`. Call it inside any `describe` to add Mocha `beforeEach`/`afterEach` hooks that drive per-test trace + (optionally) `pwNewContext()` rotation. No `wdio.conf.ts` edit required. Modes: `'per-test-trace'` (per-test zip, login persists) / `'per-test-isolated'` (per-test zip + fresh BrowserContext + per-test video). Useful for mixing stateful + self-contained specs in one config.
- **Three demo configs for the isolation patterns**:
  - `wdio.conf.ts` (default) — session-level state, auto-trace
  - `wdio.isolated.conf.ts` — every spec gets per-test trace + fresh BrowserContext (config-level hooks)
  - `wdio.per-test-trace.conf.ts` — per-test trace zip, but session-shared state (login persists; one zip per test for easy debugging)
- **`wdio-mochawesome-reporter` v8 (own fork)** — built-in HTML renderer, no marge / React bundle dependency. Pure server-side template, all CSS inlined, ~25 KB self-contained reports. `htmlReport: { dir, reportTitle, brandText, copyAssets, theme }` reporter option emits one .html per worker alongside the .json. `copyAssets: true` copies referenced media (videos, screenshots) into `assets/` and rewrites paths to relative — report stays portable. Native `<details>/<summary>` for collapse/expand. Theme via CSS variable overrides.
- **Embedded video player in mochawesome reports** — `transformMediaContexts(data, htmlDir, opts)` walks every test's context, copies `.webm`/`.mp4`/`.png`/etc. into the report's `assets/`, and rewrites the value to `{ type: 'video', src }` so the renderer emits a real `<video controls>` element. Recognized structured shapes: `video` / `image` / `link` (auto-rendered as `<video>` / `<img>` / `<a>`).
- **Runtime device switching** — `pwSwitchDevice('iPhone 13')`, `pwSwitchDevice(null)`, `pwListDevices()`. `pwNewContext(overrides)` extended to merge a partial PWOptions object into requested capabilities (sticky — subsequent `pwNewContext()` calls inherit).
- **Demo project polish** — `pw-demo/specs/pw-features.spec.ts` uses `installPerTestHooks` inline (Pattern 1); `pw-mobile.spec.ts` calls `pwSwitchDevice` from a `before` hook; `pw-features.spec.ts` self-navigates per test for isolation compatibility. Added per-test trace + video metrics flowing through `attachPWContext` → mochawesome report.

### Fixed
- **`wdio.mobile.conf.ts` BridgeService import was broken** — service was renamed to `PWService` long ago but the mobile config still imported the old name. Updated import + services array entry. Config now runs end-to-end again.
- **`pwNewContext()` deadlock on `context.close()` with active routes** (Playwright 1.59) — fire-and-forget the close so rotation completes immediately. Old context is reaped at `browser.close()` time. Documented in `troubleshooting.md`.
- **Reporter HTML body was empty** when context was passed in marge-style `data.results` shape but the reporter writes `data.suites` (single root suite). `generateHtml` now accepts both shapes.

### Added (pw-demo only)
- **Customized mochawesome HTML report.** Two layers:
  - **Theme**: `pw-demo/mochawesome.css` overrides mochawesome's CSS custom properties (`--brand-primary`, `--brand-success`, etc.) for a dark teal/magenta palette + branded gradient header (`body::before`). Re-styled summary cards, status pills, suite/test panels, code blocks, chartist bars/lines. `onComplete` copies the file into the report dir and idempotently injects `<link rel="stylesheet" href="mochawesome.css">` after `assets/app.css` so cascade order favors our overrides.
  - **Per-test metrics**: `specs/_pw-context.ts` exports `attachPWContext()` which reads `browser.capabilities` + calls `pwGetVideo()`, then emits `wdio-mochawesome-reporter:addContext` events with `{ title, value }` items: Browser engine + version, device preset, baseURL, Trace zip path, Video path, Duration. The `afterTest` hook in `wdio.conf.ts` calls it for every test. Verified end-to-end: each test in the report now has a context block with all six metrics.
  - **Bugs caught + fixed via Playwright MCP visual verification:**
    1. First attempt used `mochawesome/addContext` (the upstream Mocha helper). wdio-mochawesome-reporter is a custom WDIO reporter that doesn't read those — it has its own `process.emit('wdio-mochawesome-reporter:addContext', ...)` channel. Reading the reporter source surfaced this.
    2. Branded banner via `body::before` with `position: sticky` didn't render (sticky on a body pseudo-element gets clipped by mochawesome's `position: fixed; z-index: 1030` navbar). Fix: keep banner static + force navbar to `position: static` so the banner sits above it in document flow.
    3. Initial CSS targeted `.suite`/`.test` classes — mochawesome uses CSS-modules with hashed names like `suite--body---1itCO`. Switched all selectors to `[class*="<prefix>--"]` attribute matchers.
    4. The expanded test panel stayed light because the white background was on `[class*="test--body"]`, NOT `[class*="test--details"]` as initially assumed. Fix: include `test--body` (and the side-menu/dropdown classes) in the dark-bg list.
    5. Video field auto-rendered an inline `<video>` player loading 0:00 from a disk path the browser couldn't actually fetch. mochawesome's React renderer does extension-based detection via `/\.webm$/`. Fix: suffix the video path with ` (file)` in the context value to break end-of-string regex match — value renders as plain text instead.

### Added
- **Type augmentation for `WebdriverIO.Browser` + `webdriverio.Browser`.** All `pw*` extension commands are now strongly typed on the `browser` object — no more `interface PWBrowser { ... }` + `as unknown as PWBrowser` cast in user specs. Augments both the global `WebdriverIO.Browser` (used by `@wdio/globals`) AND the module-level `Browser` exported from `webdriverio` (used by raw `remote()` setups). Activate in your project by adding a one-line `globals.d.ts` with `/// <reference types="wdio-pw-driver" />` and including it in your tsconfig's `include`. Example in `pw-demo/globals.d.ts`.
- **`pwListDevices()` extension command** — returns Playwright's full device-descriptor registry as `Record<string, DeviceInfo>`. Useful for REPL discovery, building dropdowns of valid `pwSwitchDevice` arguments, or feature-detecting whether a specific preset ships with the user's `playwright-core` version. Verified in `pw-demo/specs/pw-mobile.spec.ts` (asserts iPhone 13 / Pixel 7 / Desktop Chrome presets + count > 100).
- **`pwSaveVideo(path)` extension command** — wraps Playwright's `Video.saveAs()`. Saves the current page's video to a user-specified path. Per Playwright behavior, `saveAs()` waits for the page to close before resolving — pair it with `pwNewContext()` so the close actually happens (otherwise the call hangs until the test timeout). Returns `{ path }` or `{ path: null }` when recording is off.
- **Video-on-failure pattern in pw-demo** — `wdio.video-on-failure.conf.ts` + `specs/pw-fail-video.spec.ts` + `pnpm wdio:fail-video` script. Mirrors the trace-on-failure shape: recording is always on, after each test the hook either saves to `./videos-failed/<safe-name>.webm` (failure) or rotates the context to discard (pass). `afterSession` cleans up orphan auto-saved files. Verified end-to-end with one passing + one intentionally failing test in the demo spec.
- **Runtime device switching: `pwNewContext(overrides?)` + `pwSwitchDevice(name)`.** Playwright's BrowserContext doesn't expose mid-session device emulation — the `device` / `viewport` / `isMobile` knobs all have to be passed at context creation. We wrapped that constraint in two ergonomic commands:
  - `pwNewContext({ device: 'iPhone 13', baseURL: 'https://m.app.test' })` — overrides are merged into `requestedCapabilities['wdio:pwOptions']` before the new context is built. Sticky: subsequent plain `pwNewContext()` calls inherit the override. Pass an explicit `null` for any field to revert to the original launch capability.
  - `pwSwitchDevice('iPhone 13')` / `pwSwitchDevice(null)` — sugar over the device override. Same caveats (cookies/localStorage/routes/element-ids reset).
  - 4 new integration tests in `tests/integration/extensions.test.ts` (override apply, sticky inheritance, null clears, swap to a different preset). Total driver tests: **189**.
  - Demo spec `pw-demo/specs/pw-mobile.spec.ts` updated to call `pwSwitchDevice('iPhone 13')` from a `before` hook — proves runtime activation works end-to-end through the WDIO runner.
- **pw-demo: end-to-end Tier D demo specs.** Three new artifacts that show every Tier D feature working through the real WDIO runner:
  - `specs/pw-features.spec.ts` (9 tests) — runtime commands: `pwGrantPermissions`/`pwClearPermissions`, `pwSetGeolocation`, `pwSetExtraHeaders` + `pwRoute`/`pwUnroute`, `pwSetOffline`, `pwRouteFromHAR` arg validation. Self-contained — no live-site dependency.
  - `wdio.mobile.conf.ts` + `specs/pw-mobile.spec.ts` (6 tests) — `device: 'iPhone 13'` capability + the two-layer baseURL story (WDIO runner-level `baseUrl` for `browser.url('/path')`, PW driver-level `wdio:pwOptions.baseURL` for protocol-level `navigateTo`). Demonstrates UA, viewport, touch, DPR.
  - `wdio.video.conf.ts` + `specs/pw-video.spec.ts` (2 tests) — `recordVideo: { dir, size }` capability + `pwGetVideo()`. Verified `.webm` lands on disk after the run.

### Fixed
- **`require('playwright-core')` in the device resolver broke the published ESM bundle.** Vitest masked it (transforms in-place, no bundling), but a real WDIO worker hit `Dynamic require of "playwright-core" is not supported` when launching with `device:` set. Switched to a static `import { devices } from 'playwright-core'` at the top of `capabilities.ts` — works identically in ESM and CJS bundles. Caught by running `pnpm wdio:mobile` end-to-end against the demo.

### Added (continued)
- **Tier D — Playwright-feature exposure.** Closes a documented gap between PW and `@playwright/test` users: 5 capability passthroughs + 5 runtime context-mutation commands + 2 capture features.
  - **Capabilities** (in `wdio:pwOptions`):
    - `device: 'iPhone 13'` — resolves against Playwright's built-in `devices` registry (140+ presets); unknown names throw with a "did you mean?" hint.
    - `offline: true` — start the BrowserContext offline.
    - `baseURL: 'https://app.test'` — relative `browser.url('/login')` resolves against this.
    - `strictSelectors: true` — raw `page.locator()` calls throw on multi-match (PW's own `findElement` chains `.first()` per W3C semantics, so it intentionally bypasses strict mode — documented in README).
    - `serviceWorkers: 'allow' | 'block'`.
    - `recordVideo: { dir, size? }` — write `.webm` per page; file is finalized at page-close time.
    - `recordHar: { path, mode?, content?, urlFilter? }` — capture every request/response.
  - **Runtime commands**: `pwGrantPermissions(['geolocation', 'notifications'])`, `pwClearPermissions()`, `pwSetGeolocation({ latitude, longitude } | null)`, `pwSetExtraHeaders({ name: value })`, `pwSetOffline(boolean)`. All five mutate the current BrowserContext; `pwNewContext()` resets them.
  - **Video**: `pwGetVideo()` returns `{ path: string | null }` for the active page.
  - **HAR replay**: `pwRouteFromHAR(path, { notFound? })` — replays captured responses against the real network or aborts unmatched URLs.
  - 19 new integration tests in `tests/integration/playwright-features.test.ts`. Total driver tests: **185**.
- **CI workflow: `shard-pattern` matrix job** — `.github/workflows/ci.yml` now has a 4-shard matrix that runs `wdioPW shard 'tests/integration/**/*.test.ts' --of 4 --shard K` for K=1..4 and prints the resulting file list. Acts as a regression check on the splitter (lost files, off-by-one, stray newlines all show up immediately) and as a copy-pasteable reference for users who want to wire the same pattern into their own WDIO project.
- **`wdioPW shard <patterns...> --of N --shard K`** — CI parallelization helper. Splits a sorted spec-file list into N contiguous shards and prints the K-th (1-based) on stdout, one path per line. Sort order is alphabetical so the same input produces the same shard across machines. Patterns accept plain file paths, directories (recursively walked), or globs (`*`, `**`, `?`). Empty matches print to stderr and exit 0 with empty stdout — pipe-safe for `$(wdioPW shard ...)`. Drops straight into a GitHub Actions matrix; samples in README + `wdioPW shard --help`. 7 unit tests covering arg parsing, slice math, glob expansion, empty-match warning, and 1..N coverage of every input.
- **`PWService` — WDIO launcher service that injects Playwright's binary path.** Removes the need for `import { chromium } from 'playwright-core'` in `wdio.conf.ts`. Resolves the right binary for `browserName` (chromium / firefox / webkit / chrome / edge / safari), writes it to `wdio:pwOptions.executablePath` plus the matching vendor cap (`goog:chromeOptions.binary` / `moz:firefoxOptions.binary`), and short-circuits WDIO's own Chromium-via-Puppeteer auto-download. Skips capabilities that already have a binary set — explicit configuration always wins. Wire it as `services: [[PWService, {}]]`. Options: `{ ignoreUnsupportedBrowsers?: boolean }`. 9 unit tests in `tests/unit/service.test.ts`.
  - Verified end-to-end against `pw-demo`: `wdio.conf.ts`, `wdio.firefox.conf.ts`, `wdio.webkit.conf.ts` all simplified to drop the `playwright-core` import; OrangeHRM specs pass on all three engines via the service.
- **Tier C #11 — BiDi command surface expansion.** First wave of BiDi commands beyond the original three. 14 new commands wired through `buildBidiPrototype` and registered in the command registry:
  - `script.addPreloadScript` / `script.removePreloadScript` — wraps `context.addInitScript()`. Registers a function that runs at every navigation before page scripts (geolocation shims, `Date.now` freezing, fetch instrumentation, etc.). `removePreloadScript` is a soft no-op against an unknown id but accepts known ids — Playwright has no real removal API.
  - `script.evaluate` / `script.callFunction` — BiDi's executeScript path. Returns a `RemoteValue`-shaped result (`{ type, value }`) for primitives, arrays, plain objects, dates, BigInts. `arguments` (BiDi `LocalValue` list) is rejected — inline literals into the function body for v0.1.
  - `browsingContext.activate` / `browsingContext.create` / `browsingContext.close` — multi-tab automation (open new tab, switch focus, close). PW synthesizes `page-N` handles so Classic `switchToWindow` and BiDi `activate` reference the same logical thing.
  - `browsingContext.navigate` / `browsingContext.reload` / `browsingContext.traverseHistory` / `browsingContext.setViewport` — BiDi-side navigation + viewport. `traverseHistory` loops single-step back/forward to honor multi-step deltas.
  - `storage.getCookies` / `storage.setCookie` / `storage.deleteCookies` — BiDi cookie shape (`value: { type: 'string', value }`) translated to Playwright's plain shape at the boundary.
  - **Out of scope this round** (still throw `NotImplementedError`): `network.*` (intercept loop is a major build — `pwRoute` covers the use case for now), `emulation.*`, `webExtension.*`, `script.disown`/`getRealms`, `browsingContext.locateNodes`/`captureScreenshot`/`print`.
  - 19 new integration tests in `tests/integration/bidi-expansion.test.ts` (8 script, 7 browsingContext, 4 storage). Total driver tests: **150**.
- **Tier C — cross-browser matrix + CI.**
  - `pw-demo/wdio.firefox.conf.ts` and `wdio.webkit.conf.ts` — full WDIO test configs that drive Playwright's Firefox / WebKit through PW. Both run the same OrangeHRM specs as the Chromium config (52/52 specs pass on each engine; no behavior diffs surfaced from the chromedriver-vs-Playwright transition for these specs).
  - `pnpm wdio:firefox`, `pnpm wdio:webkit`, `pnpm wdio:all` scripts for the matrix.
  - `.github/workflows/ci.yml` — first real CI workflow. Matrix on `{ubuntu-latest, macos-latest} × Node {20, 22}`. Runs lint → typecheck → build → test on every push and PR; caches Playwright browser binaries by `playwright-core` version.
  - **Lint cleanup**: removed two unused imports (`currentScope` in `actions.ts`, `afterAll`/`beforeAll` in `cross-browser.test.ts`) so `pnpm lint` is green for CI.
- **Tier B extensions** — features inspired by `@playwright/test` that WDIO doesn't natively offer.
  - `pwSaveStorage(path)` + `wdio:pwOptions.storageState` capability — write the BrowserContext's cookies + localStorage to a JSON file at the end of one session, load it into the next session via capability. Pattern: log in once, reuse auth across many specs without re-running the login flow.
  - `pwNewContext()` — rotate the BrowserContext in place: tears down all pages, routes, cookies, localStorage, dialog state, and re-attaches dialog + BiDi listeners on the new context. Use it in a per-test hook for `@playwright/test`-style isolation without paying the full browser-relaunch cost.
  - `pwRoute(pattern, response)` + `pwUnroute(pattern)` — data-driven network mocking. Response spec is JSON-serializable across the WebDriver wire (`{ status, body, contentType, headers }` for fulfill or `{ abort: 'failed' }`). Auto-serializes object bodies as `application/json`.
  - 9 new integration tests in `tests/integration/extensions.test.ts` (3 storage state, 2 context rotation, 4 network mock). Total driver tests: 131.
- **Tier A polish pass.**
  - `wdioPW doctor` — diagnostics command that prints driver version, `playwright-core` version, browser binaries cached locally with sizes, Node version, OS+arch, and total cache size. Exits non-zero if a required component is missing.
  - TypeScript augmentation extending `WebdriverIO.Capabilities` with the `wdio:pwOptions` namespace. Removes the `as Record<string, unknown>` cast users previously needed in their wdio.conf.
  - Firefox and WebKit smoke tests (`tests/integration/cross-browser.test.ts`) — both engines now exercised end-to-end, auto-skipped if the matching binary isn't cached.
  - Auto-trace-on-failure documented pattern + working sample (`pw-demo/wdio.trace-on-failure.conf.ts`) using existing `pwStartTrace` / `pwStopTrace` extension commands wired through Mocha hooks. Per-test trace, kept only when the test fails.
  - `CHANGELOG.md` (this file).

## [0.1.0-alpha.0] — 2026-05-09

Initial alpha. WDIO driver that drives Chromium / Firefox / WebKit via Playwright internals instead of chromedriver, while keeping the standard WDIO `browser.url`, `$()`, `click()` API surface.

### Added — driver internals
- `PWDriver.newSession()` matching `webdriver/src/index.ts:WebDriver.newSession()` exactly so it's a drop-in replacement when `automationProtocol: 'wdio-pw-driver'` is set in WDIO config.
- 56 W3C WebDriver Classic commands implemented across session / navigation / element find + actions + queries / executeScript / window / cookies / screenshot / frames / alerts / actions / print.
- Element store with two-way Locator ↔ element-id mapping, separate shadow-root namespace using `SHADOW_ELEMENT_KEY`.
- W3C selector strategy translation (CSS / XPath / link text / partial link text).
- Element-reference marshaling for `executeScript` args and return values.
- W3C action chains (pointer, key, pause sources) including special-key Unicode mapping.
- Frame switching by null / index / element-ref + `currentScope()` routing.
- Alert handling via auto-handle snapshot model (works around Playwright's reactive-listener deadlock).

### Added — pw events
- In-process W3C BiDi event pw — `Page.on('console'/'pageerror'/'request'/'response'/'framenavigated'/'load'/'domcontentloaded'/'dialog')` translated to BiDi-shaped emissions on the WDIO Client EventEmitter.
- `sessionSubscribe` / `sessionUnsubscribe` (and `browsingContextGetTree` stub) so `browser.on('log.entryAdded', cb)` works without a real WebSocket.
- Subscription gating — events only emitted when subscribed (zero-cost when nobody listens).

### Added — tracing (PW-specific extensions)
- **Option A**: `wdio:pwOptions.trace: true` auto-starts `context.tracing` at session creation and writes `{traceDir}/{sessionId}.zip` on `deleteSession`. Configurable via `traceDir`, `traceSnapshots`, `traceScreenshots`, `traceSources`.
- **Option B**: `pwStartTrace(opts?)` and `pwStopTrace(path?)` extension commands for explicit per-test control.

### Added — `wdioPW` CLI
- `wdioPW install [browser...|all]` — download browser binaries; routes to `playwright-core/cli.js install`.
- `wdioPW install-deps` — Linux OS-level browser dependencies.
- `wdioPW uninstall` — remove the cached browser binaries.
- `wdioPW trace <file.zip>` — open a PW trace zip in the trace viewer.
- `wdioPW --help` / `--version` with branded sub-help that doesn't leak the upstream package name.
- Color output (auto-disabled when `NO_COLOR` set or stdout not a TTY).

### Performance
- After the perf pass: PW headless ≈ 0.75 s/test, tied with native Playwright Test (0.74 s/test) across the OrangeHRM 52-test spec set. Faster than the W3C BiDi reference path (chromedriver) by ~10–15%.
- Key wins: dropped redundant `ensureFresh()` pre-flight on every element command (saves 1 IPC), lighter `materializeAndRegister` using `loc.waitFor({state:'attached'})` instead of `elementHandle({timeout}) + dispose` (saves 1 IPC), `navigateTo` uses `waitUntil: 'domcontentloaded'` instead of `'load'` so SPAs return promptly.

### Tests
- 116 driver tests (4 unit suites + smoke + Phase 2/3/4/5 integration + tracing + cross-browser + CLI).
- 50+ tests per runner across two demo projects (`pw-demo`, `playwright-demo`) running the same OrangeHRM scenarios via PW / W3C BiDi / native Playwright Test for comparison.

### Known limitations
- `playwright-core` is a peer dependency; visible in `package-lock.json` and `~/Library/Caches/ms-playwright/`. Branding is cleaned up but the dependency is not hidden — see Progress Log entry for the reasoning.
- Alert API has W3C-deviation costs: to make `confirm()` return false or send text to `prompt()`, tests must call `dismissAlert()` / `sendAlertText()` *before* triggering the dialog, not after.
- BiDi commands beyond the four shipped (`sessionSubscribe`, `sessionUnsubscribe`, `browsingContextGetTree`, plus the events) throw `NotImplementedError`. Expand on demand.

[Unreleased]: ../../compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: ../../releases/tag/v0.1.0-alpha.0
