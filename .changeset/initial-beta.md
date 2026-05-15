---
'wdio-pw-driver': minor
---

First public release as `0.1.0-beta.0`. Pre-1.0 — APIs may change.

This release rolls up everything shipped so far:

**Core**

- `PWDriver.newSession()` plus the full set of W3C Classic + WebDriver BiDi
  command handlers needed to power a WebdriverIO 9 session through
  `playwright-core` (no chromedriver, no HTTP).
- `PWService` — WDIO launcher service that injects Playwright's bundled
  browser binaries into capabilities (replacing WDIO's auto-download)
  and overrides `click` / `waitForExist` / `waitForDisplayed` to use
  Playwright's actionability primitives.
- Suppresses redundant chromedriver / geckodriver / edgedriver downloads —
  ~10 MB saved per cold-cache CI run. Escape hatch:
  `wdio:pwOptions.skipDriverDownload: false`.

**Playwright extensions**

- Tracing: `pwStartTrace`, `pwStopTrace` plus capability-driven auto-trace.
- Storage: `pwSaveStorage`, `pwLoadStorage`, `wdio:pwOptions.storageState`.
- Network mocking: `pwRoute`, `pwUnroute`, `pwRouteFromHAR`.
- Context lifecycle: `pwNewContext`, `pwSwitchDevice`, `pwListDevices`.
- Permissions / geo / headers / offline: `pwGrantPermissions`,
  `pwClearPermissions`, `pwSetGeolocation`, `pwSetExtraHeaders`, `pwSetOffline`.
- Video: `pwGetVideo`, `pwSaveVideo`, `recordVideo` capability.
- Network event waiters: `pwWaitForRequest`, `pwWaitForResponse`.
- File chooser: `pwOnFileChooser` for native dialog handling.
- A11y: `pwAriaSnapshot`, `getElementComputedRole`, `getElementComputedLabel`.

**Tooling**

- `wdioPW` CLI — `install`, `trace`, `doctor`, `shard`.
- `installPerTestHooks({ mode })` — spec-level helper for per-test trace
  + context isolation, no `wdio.conf.ts` edit required.
- TypeScript augmentation of `WebdriverIO.Browser` so `browser.pw*()` calls
  type-check without casts.

**Stability**

- 228 vitest tests covering protocol commands, integration scenarios,
  cross-browser smoke, and the auto-wait override layer.
- CI matrix: Ubuntu + macOS × Node 20 + 22.
- Documentation site at https://jemishgopani.github.io/wdio-pw-driver/.
