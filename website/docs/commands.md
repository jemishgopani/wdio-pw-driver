---
sidebar_position: 2
title: Commands
description: "Every pw* extension command, signature + example"
---

PW driver attaches a set of Playwright-flavored commands onto the WDIO `browser` object beyond the standard W3C surface. They're all prefixed `pw*` and grouped by concern. All commands are typed via the `WebdriverIO.Browser` augmentation — no cast needed when you've activated the type augmentation (see **[configuration.md](./configuration.md#typescript-activation)**).

## Categories

- [Tracing](#tracing) — record action timelines for debugging
- [Storage state](#storage-state) — save/load auth across runs
- [Context lifecycle](#context-lifecycle) — fresh BrowserContexts mid-session
- [Device emulation](#device-emulation) — runtime device switching
- [Network mocking](#network-mocking) — route + HAR replay
- [Permissions / geolocation / headers / offline](#permissions--geolocation--headers--offline) — runtime context mutation
- [Video](#video) — recording metadata + saving

---

## Tracing

### `pwStartTrace(opts?)`

Start a fresh Playwright trace on the current BrowserContext. Returns `null`.

```ts
await browser.pwStartTrace({ snapshots: true, screenshots: true, sources: true })
```

| Option | Default | What it does |
|---|---|---|
| `snapshots` | `true` | Capture DOM snapshots before/after each action |
| `screenshots` | `true` | Screenshot on each action |
| `sources` | `true` | Embed source code links into the trace |

Pair with `pwStopTrace(path)` to write the zip. For session-level auto-trace use the `trace: true` capability instead.

### `pwStopTrace(path?)`

Stop the in-flight trace. With a `path` arg, save it; without, discard.

```ts
const writtenPath = await browser.pwStopTrace('./traces/login.zip')   // returns the absolute path
await browser.pwStopTrace()                                            // discard (test passed)
```

The standard "trace on failure" pattern: kick off in `beforeTest`, save-or-discard in `afterTest` based on `result.passed`. Sample at `pw-demo/wdio.trace-on-failure.conf.ts`.

Open a saved trace: `npx wdioPW trace ./traces/login.zip` (or drag onto trace.playwright.dev).

---

## Storage state

### `pwSaveStorage(path)`

Write the current BrowserContext's cookies + localStorage to a JSON file. Returns the absolute path written.

```ts
await browser.url('https://app.test/')
await login(browser)
await browser.pwSaveStorage('./.auth/admin.json')
```

Use the saved file in subsequent runs by setting `wdio:pwOptions.storageState: './.auth/admin.json'` in the capability — login is restored at session creation, no form-fill needed.

### `pwLoadStorage()`

Throws by design. Loading mid-session would require tearing down and rebuilding the BrowserContext, which would defeat the purpose. The load side is **capability-driven only** — set `wdio:pwOptions.storageState` to a path.

The throw exists so you get a clear error message rather than silent confusion if you reach for it.

---

## Context lifecycle

### `pwNewContext(overrides?)`

Rotate the BrowserContext: close the current one (and all its pages), open a fresh one with the same options. Equivalent to `@playwright/test`'s test-isolation model.

```ts
await browser.pwNewContext()      // re-use the original capabilities
await browser.pwNewContext({      // override individual fields
  device: 'iPhone 13',
  baseURL: 'https://m.app.test',
})
```

After this returns:
- `browser.sessionId` is unchanged (same WDIO session)
- The current Page is brand-new
- Cookies, localStorage, routes, dialogs, frames are all gone
- Element-id refs from before the rotation are stale (will throw `StaleElementReferenceError`)
- Any in-flight trace is stopped (start a new one if needed)

**Sticky overrides**: pass `device: 'iPhone 13'` once; subsequent plain `pwNewContext()` calls inherit it. To revert a field, pass `null`:

```ts
await browser.pwNewContext({ device: 'iPhone 13' })  // sticky from now on
await browser.pwNewContext()                           // inherits iPhone
await browser.pwNewContext({ device: null })           // back to launch caps
```

**Caveat**: `context.close()` deadlocks in `playwright-core` 1.59 when network routes were registered (they wait forever for handler completion). PW driver fire-and-forgets the close — old context becomes orphaned and is reaped at `browser.close()` time. Cost: ~1 BrowserContext-worth of memory leaks per rotation, until session teardown.

### `pwSwitchDevice(name)` / `pwSwitchDevice(null)`

Sugar over `pwNewContext({ device: name })`. Pass `null` to clear the device override.

```ts
await browser.pwSwitchDevice('iPhone 13')
await browser.pwSwitchDevice('Pixel 7')
await browser.pwSwitchDevice(null)         // back to launch defaults
```

---

## Device emulation

### `pwListDevices()`

Returns Playwright's full device-descriptor registry as `Record<string, DeviceInfo>`. Useful for REPL discovery, building UI dropdowns, or verifying the user's `playwright-core` version ships a specific preset.

```ts
const devices = await browser.pwListDevices()
console.log(Object.keys(devices))             // ['iPhone 13', 'Pixel 7', ... 140 more]
console.log(devices['iPhone 13'])
// {
//   userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 ...)',
//   viewport: { width: 390, height: 664 },
//   deviceScaleFactor: 3,
//   isMobile: true,
//   hasTouch: true,
//   defaultBrowserType: 'webkit',
// }
```

---

## Network mocking

### `pwRoute(pattern, response)`

Register a static mock for any URL matching the glob pattern. The response is JSON-shaped and rides over the WebDriver wire.

```ts
// Mock a JSON response (object body auto-serializes + sets content-type):
await browser.pwRoute('**/api/users', {
  status: 200,
  body: { users: [{ id: 1, name: 'jemish' }] },
})

// Plain text body with custom headers:
await browser.pwRoute('**/api/text', {
  status: 418,
  body: 'i am a teapot',
  contentType: 'text/plain',
  headers: { 'x-mocked-by': 'pw-driver' },
})

// Block requests entirely:
await browser.pwRoute('**/analytics/**', { abort: 'failed' })
```

Response spec fields: `status`, `body`, `contentType`, `headers`, `abort`.

For dynamic per-request logic (rewriting headers, conditional fulfillment), use `PWDriver.newSession()` standalone and call `context.route()` directly — JS callbacks don't ride the WebDriver wire.

### `pwUnroute(pattern)`

Remove a previously-registered mock. The next request matching the pattern hits the real network.

```ts
await browser.pwUnroute('**/api/users')
```

### `pwRouteFromHAR(path, options?)`

Replay network responses from a previously-recorded HAR file. Wraps `context.routeFromHAR()`.

```ts
// First run — record (in capability):
'wdio:pwOptions': { recordHar: { path: './har/run.har', mode: 'minimal' } }

// Subsequent runs — replay:
await browser.pwRouteFromHAR('./har/run.har', { notFound: 'fallback' })
```

| Option | Default | What it does |
|---|---|---|
| `notFound` | `'abort'` | What to do for un-recorded URLs. `'fallback'` lets them hit the real network. |
| `update` | `false` | When true, missing entries are added to the HAR. Use during HAR maintenance, not in normal runs. |
| `url` | `undefined` | URL pattern filter — only HAR entries matching apply. |

---

## Permissions / geolocation / headers / offline

These mutate the **current** BrowserContext. `pwNewContext()` resets them — re-apply in your `beforeEach` if you want them persistent across rotations.

### `pwGrantPermissions(permissions, opts?)`

Wraps `context.grantPermissions()`. Accepts a bare array or `{ permissions, origin }` envelope.

```ts
await browser.pwGrantPermissions(['geolocation', 'notifications'])
await browser.pwGrantPermissions({ permissions: ['camera'], origin: 'https://app.test' })
```

### `pwClearPermissions()`

Drop every permission previously granted on this context. Useful between phases of a single spec.

### `pwSetGeolocation(geo | null)`

Override `navigator.geolocation`. Pass `null` to reset. Caller must have already granted the `geolocation` permission.

```ts
await browser.pwGrantPermissions(['geolocation'])
await browser.pwSetGeolocation({ latitude: 48.8566, longitude: 2.3522, accuracy: 10 })
await browser.pwSetGeolocation(null)   // remove override
```

### `pwSetExtraHeaders(headers)`

Replace the BrowserContext's extra HTTP headers. To clear, pass `{}`. Headers apply to every request from this point onward, including subresources.

```ts
await browser.pwSetExtraHeaders({ 'x-trace-id': 'abc-123', 'authorization': 'Bearer …' })
await browser.pwSetExtraHeaders({})    // clear all extras
```

> Header replace, not merge. Pass the full set every time. Playwright's API isn't additive and pretending otherwise would be misleading.

### `pwSetOffline(flag)`

Toggle the BrowserContext's offline mode. Equivalent to the capability `offline: true` but mutable mid-session.

```ts
await browser.pwSetOffline(true)    // navigator.onLine = false; fetches fail
await browser.pwSetOffline(false)
```

---

## Video

### `pwGetVideo()`

Return the saved video file path for the current page. Only meaningful when `wdio:pwOptions.recordVideo` was set in capabilities.

```ts
const { path } = await browser.pwGetVideo()
// path === '/abs/path/to/page@<sha>.webm' (or null when recording is off)
```

**Caveat**: returns the *eventual* path — the file is finalized only when the page closes (`deleteSession` or `pwNewContext` rotation). Calling this mid-test is safe; the path is correct, but the file may not exist on disk yet.

### `pwSaveVideo(path)`

Save the current page's video to a user-specified path. Wraps Playwright's `Video.saveAs()`.

```ts
const { path } = await browser.pwSaveVideo('./videos-failed/login.webm')
```

**Important**: `saveAs()` waits for the page to close before resolving. Use it together with `pwNewContext()` or `deleteSession()` so the close actually happens — calling it without arranging a close means it hangs until the test timeout.

Standard pattern (video-on-failure):

```ts
async afterTest(test, _ctx, result) {
  if (result.passed) {
    await browser.pwNewContext()        // discard via rotation
  } else {
    const target = `./videos-failed/${safe(test)}.webm`
    const savePromise = browser.pwSaveVideo(target)   // begins waiting
    await browser.pwNewContext()                      // closes page → save resolves
    await savePromise
  }
}
```

Sample at `pw-demo/wdio.video-on-failure.conf.ts`.

---

## BiDi commands

When `webSocketUrl: true` is in capabilities, PW driver exposes a subset of WebDriver BiDi commands on the client. Most users don't call these directly — WDIO's BiDi-aware helpers (like `browser.on('log.entryAdded', cb)`) call them internally. List of implemented BiDi commands:

- `sessionSubscribe`, `sessionUnsubscribe`
- `scriptAddPreloadScript`, `scriptRemovePreloadScript`, `scriptEvaluate`, `scriptCallFunction`
- `browsingContextActivate`, `browsingContextCreate`, `browsingContextClose`
- `browsingContextNavigate`, `browsingContextReload`, `browsingContextTraverseHistory`
- `browsingContextSetViewport`, `browsingContextGetTree`
- `storageGetCookies`, `storageSetCookie`, `storageDeleteCookies`

Not yet implemented (will throw `NotImplementedError`): `network.*`, `emulation.*`, `webExtension.*`, `script.disown`, `script.getRealms`, `browsingContext.locateNodes/captureScreenshot/print`. See `docs/pw-driver-plan.md` Tier C #11 for the rationale.

---

## Composing commands

Most real specs use multiple of these together. Common combinations:

**Auth bootstrap + per-test fresh context:**
```ts
// One-time setup
beforeAll(async () => {
  await browser.url('https://app.test/login')
  await loginViaForm(browser)
  await browser.pwSaveStorage('./.auth/admin.json')
})

// In each spec's wdio.conf.ts capability:
'wdio:pwOptions': { storageState: './.auth/admin.json' }

// Per-test isolation without re-login on every test:
beforeEach(async () => { await browser.pwNewContext() })
```

**Network-mock + extra-header + offline burst:**
```ts
await browser.pwSetExtraHeaders({ 'x-test-run': process.env.CI_RUN_ID })
await browser.pwRoute('**/api/flaky', { abort: 'failed' })
await browser.pwSetOffline(true)
// ... assert offline-mode UX renders ...
await browser.pwSetOffline(false)
await browser.pwUnroute('**/api/flaky')
```

**Per-test trace + video on failure** (see [isolation.md](./isolation.md#pattern-3--per-test-trace-shared-state)):
```ts
afterEach(async function () {
  if (!this.currentTest.state || this.currentTest.state === 'failed') {
    await browser.pwStopTrace(`./traces/${safe(this.currentTest.title)}.zip`)
    const v = await browser.pwGetVideo()
    if (v?.path) console.log(`failed-test video: ${v.path}`)
  } else {
    await browser.pwStopTrace()    // discard
  }
})
```
