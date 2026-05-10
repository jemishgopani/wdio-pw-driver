---
sidebar_position: 1
title: Configuration
description: "Every wdio:pwOptions field + capability examples"
---

Everything you can put in your WDIO config to customize PW driver behavior. All driver-specific settings live under the `wdio:pwOptions` capability.

## Minimal config

```ts
// wdio.conf.ts
import PWService from 'wdio-pw-driver'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',   // tells WDIO to load this driver
  services: [[PWService, {}]],            // auto-injects Playwright binary path

  capabilities: [{
    browserName: 'chromium',              // chromium / firefox / webkit (also chrome / edge / safari)
    'wdio:pwOptions': {
      headless: true,
    },
  }],

  framework: 'mocha',
  specs: ['./specs/**/*.spec.ts'],
}
```

That's the whole minimum — no `goog:chromeOptions.binary`, no `chromedriver` to manage.

---

## `wdio:pwOptions` reference

All fields optional. Listed in the order they're typically reached for.

### Launch behavior

| Field | Type | Default | What it does |
|---|---|---|---|
| `headless` | `boolean` | `true` (or `!process.env.PW_HEADED` if you wire it) | Whether Playwright launches the browser visible. Set `PW_HEADED=1` then `headless: !process.env.PW_HEADED` for a CLI-toggleable run. |
| `args` | `string[]` | `[]` | Extra args passed to the engine launcher. Concatenated with `goog:chromeOptions.args`. |
| `executablePath` | `string` | `playwright-core`'s bundled binary | Override the engine binary. `PWService` auto-fills this from `chromium.executablePath()` etc., so you usually don't set it manually. |
| `slowMo` | `number` (ms) | `undefined` | Pause every action by N ms. Mirrors Playwright's `slowMo`. |
| `timeout` | `number` (ms) | `30_000` | Default timeout for element actions (click, fill, waitFor). |

### Storage state

| Field | Type | Default | What it does |
|---|---|---|---|
| `storageState` | `string` (path to JSON) | `undefined` | Load a previously-saved cookies + localStorage snapshot at session creation. Pair with `pwSaveStorage(path)` to record state once and reuse it across runs. |

```ts
// Save once:
await browser.pwSaveStorage('./.auth/admin.json')

// Reload in subsequent runs:
'wdio:pwOptions': { storageState: './.auth/admin.json' }
```

### Tracing

| Field | Type | Default | What it does |
|---|---|---|---|
| `trace` | `boolean` | `false` | When true, auto-trace starts at session creation and saves one zip at `deleteSession`. Path: `<traceDir>/<sessionId>.zip`. |
| `traceDir` | `string` | `'./traces'` | Output directory for the auto-trace zip. |
| `traceSnapshots` | `boolean` | `true` | Capture DOM snapshots before/after each action (huge, but lets the trace viewer show actual page state). |
| `traceScreenshots` | `boolean` | `true` | Capture screenshots on each action. |
| `traceSources` | `boolean` | `true` | Embed source code links into the trace. |

For per-test traces (one zip per test) see **[isolation.md](./isolation.md)** — that's the `pwStartTrace` / `pwStopTrace` path, not auto-trace.

### Device emulation

| Field | Type | Default | What it does |
|---|---|---|---|
| `device` | `string` | `undefined` | Playwright device preset name. Resolves to viewport / userAgent / deviceScaleFactor / isMobile / hasTouch in one shot. |

```ts
'wdio:pwOptions': { device: 'iPhone 13' }
```

> Chromium quirk: the page needs `<meta name="viewport" content="width=device-width">` for the mobile viewport to take effect. Without it Chromium falls back to a 980px desktop layout even when `isMobile: true`. WebKit applies the viewport unconditionally.

To list available devices: `Object.keys(require('playwright-core').devices)` — or call `browser.pwListDevices()` at runtime.

For runtime device switching see **[commands.md](./commands.md#pwswitchdevicename--pwswitchdevicenull)**.

### Network + permissions

| Field | Type | Default | What it does |
|---|---|---|---|
| `offline` | `boolean` | `false` | Start the BrowserContext offline. Toggle later with `pwSetOffline(bool)`. |
| `baseURL` | `string` | `undefined` | Base URL for the BrowserContext. Relative URLs in `page.goto()` and `navigateTo` resolve against this. Set WDIO's runner-level `baseUrl` too if you want `browser.url('/path')` to work. |
| `serviceWorkers` | `'allow' \| 'block'` | `'allow'` | Service worker policy. Block when SW caching gets between your test and the latest deploy. |

### Selector behavior

| Field | Type | Default | What it does |
|---|---|---|---|
| `strictSelectors` | `boolean` | `false` | Raw `page.locator()` calls throw on multi-match. the driver's own `findElement` chains `.first()` per W3C semantics, so it intentionally bypasses strict mode — this only affects `executeScript` calls that hit raw `page.locator()`. |

### Recording

| Field | Type | Default | What it does |
|---|---|---|---|
| `recordVideo` | `{ dir: string, size?: { width, height } }` | `undefined` | Record video of every page in the BrowserContext. One `.webm` per Page. Finalized when the page closes. |
| `recordHar` | `{ path, mode?, content?, urlFilter? }` | `undefined` | Capture every request/response into a HAR. Pair with `pwRouteFromHAR(path)` for offline replay in subsequent runs. |

```ts
'wdio:pwOptions': {
  recordVideo: { dir: './videos', size: { width: 800, height: 600 } },
  recordHar:   { path: './har/run.har', mode: 'minimal' },
}
```

---

## WDIO runner-level options worth setting

These aren't `wdio:pwOptions` — they're WDIO's own config keys that interact with PW driver behavior.

| Field | Why it matters |
|---|---|
| `automationProtocol: 'wdio-pw-driver'` | **Required.** Tells WDIO to load this driver instead of `webdriver`. |
| `services: [[PWService, {}]]` | **Recommended.** Auto-injects the Playwright binary path. Without it you have to import `chromium.executablePath()` yourself in the config. See **[service.md](./service.md)**. |
| `baseUrl: 'https://app.test'` | WDIO's own runner-level base URL. Used by `browser.url('/path')` (which validates with `new URL()` first). Pair with `wdio:pwOptions.baseURL` to keep both layers consistent. |
| `maxInstances: N` | Spawns N parallel WDIO worker processes — each gets its own browser. The `PW_HEADED=1` env var only really makes sense with `maxInstances: 1`. |

---

## Multi-browser config

PW driver supports Chromium, Firefox, WebKit. The `browserName` capability picks which engine `PWService` resolves the binary for.

```ts
// wdio.firefox.conf.ts
capabilities: [{
  browserName: 'firefox',           // also: chromium, webkit, chrome, edge, safari
  'wdio:pwOptions': { headless: true },
}]
```

Run a single config: `pnpm wdio:firefox`. For a full multi-engine matrix run all three configs in sequence — see `pw-demo/package.json:wdio:all`.

For a parallel multi-engine run in one process, WDIO supports an array of capabilities. Note: `PWService` will inject the right binary for each entry independently.

---

## Capability passthroughs

A few standard WDIO capabilities affect PW behavior:

| Capability | Effect on PW |
|---|---|
| `browserName` | Selects the engine (chromium / firefox / webkit). Aliases mapped: chrome/edge/msedge → chromium, safari → webkit. |
| `acceptInsecureCerts: true` | Sets `ignoreHTTPSErrors: true` on the BrowserContext. |
| `goog:chromeOptions.binary` | Overrides the Chromium binary path (PWService writes this for you). |
| `goog:chromeOptions.args` | Concatenated with `wdio:pwOptions.args`. |
| `goog:chromeOptions.mobileEmulation.deviceMetrics.{width,height}` | Sets the BrowserContext viewport. |
| `moz:firefoxOptions.binary` | Overrides the Firefox binary path. |
| `proxy: { httpProxy, sslProxy, noProxy }` | Passed to Playwright as launch-level proxy config. |
| `webSocketUrl: true` | Opts into BiDi mode. Without it, BiDi event subscriptions are silently ignored to keep WDIO's `ContextManager` from calling unimplemented BiDi commands. |
| `wdio:enforceWebDriverClassic: true` | Forces PW to advertise as W3C Classic only — useful when WDIO is auto-trying BiDi paths the driver doesn't fully implement. |

---

## TypeScript activation

The driver augments `WebdriverIO.Browser` and `webdriverio.Browser` with all `pw*` extension commands so user specs don't need casts. To activate the augmentation in your project, drop a one-line file at the project root:

```ts
// globals.d.ts
/// <reference types="wdio-pw-driver" />
```

…and include it in your `tsconfig.json`:

```json
{
  "include": ["specs/**/*", "wdio.*.conf.ts", "globals.d.ts"]
}
```

After this, `await browser.pwSwitchDevice('iPhone 13')` is fully typed — no `as unknown as PWBrowser` cast needed. See **[architecture.md](./architecture.md#typescript-augmentation)** for why this pattern (instead of `tsconfig.types[]`).

---

## Sample configs

The demo project (`pw-demo/`) has working configs for every common scenario:

| File | Use case |
|---|---|
| `wdio.conf.ts` | Default — session-level state, auto-trace |
| `wdio.firefox.conf.ts` | Same as default but on Firefox |
| `wdio.webkit.conf.ts` | Same as default but on WebKit |
| `wdio.mobile.conf.ts` | iPhone 13 device preset + baseURL |
| `wdio.video.conf.ts` | Video recording demo |
| `wdio.bidi.conf.ts` | BiDi mode (`webSocketUrl: true`) |
| `wdio.trace-on-failure.conf.ts` | Discard traces on pass, keep on failure |
| `wdio.video-on-failure.conf.ts` | Same idea for videos |
| `wdio.isolated.conf.ts` | Per-test BrowserContext rotation |
| `wdio.per-test-trace.conf.ts` | Per-test trace zip, session-shared state |

Copy any of these as a starting point.
