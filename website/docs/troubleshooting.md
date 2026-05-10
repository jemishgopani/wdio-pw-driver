---
sidebar_position: 8
title: Troubleshooting
description: "Common errors + fixes"
---

Common errors + their root causes + the fix. If your problem isn't here, run `wdioPW doctor` first — it surfaces 80% of environment issues in one go.

---

## "Dynamic require of \"playwright-core\" is not supported"

**Symptom**: WDIO launches, then crashes on the first session with this message.

**Cause**: A previous version of the driver used `require('playwright-core')` at runtime in `capabilities.ts`. That works under vitest (which transforms files in place) but fails in the published ESM bundle.

**Fix**: Update to `wdio-pw-driver` ≥ 0.1.0-alpha.x. The driver now uses a static `import { devices } from 'playwright-core'` at the top of the file — works in both ESM and CJS bundles.

If you're on a recent version and still see this, the demo's `pnpm` link may be stale (see next entry).

---

## pnpm `file:` link is stale (changes to driver source not picked up)

**Symptom**: You changed `wdio-pw-driver/src/`, ran `pnpm build`, but the consuming project (e.g. `pw-demo`) still uses the old code.

**Cause**: pnpm's `file:` install creates a snapshot copy in `.pnpm/`. Adding new files to the source (like `index.d.ts` from a tsup build) doesn't auto-refresh the snapshot.

**Fix**: 
```bash
cd consuming-project
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

For a faster path during heavy iteration: `rm -rf node_modules/.pnpm/wdio-pw-driver* node_modules/wdio-pw-driver && pnpm install` (just nukes the linked driver).

This isn't a PW bug — it's a pnpm `file:` semantic.

---

## Mobile viewport: `window.innerWidth` reports 980 on Chromium

**Symptom**: You set `device: 'iPhone 13'` in capabilities, but `window.innerWidth` is `980` instead of `390`.

**Cause**: Chromium's mobile emulation needs a `<meta name="viewport">` tag in the page to honor the mobile viewport. Without it, layout falls back to a 980px desktop layout — even when `isMobile: true` is set on the BrowserContext.

This is **Chromium behavior, not a PW bug**. WebKit applies the viewport unconditionally and behaves as expected.

**Fix**: Either add the meta tag to your page (the right fix for real apps), or in test fixtures use:

```html
<meta name="viewport" content="width=device-width,initial-scale=1">
```

The `pw-mobile.spec.ts` demo wraps its data: URLs in this meta tag for exactly this reason.

---

## `Invalid URL: /` when calling `browser.url('/')`

**Symptom**: You set `wdio:pwOptions.baseURL: 'https://app.test'` in capabilities expecting `browser.url('/path')` to resolve relatively, and instead WDIO throws "Invalid URL".

**Cause**: WDIO's `browser.url()` validates the input via `new URL()` BEFORE handing it to the driver. `new URL('/')` throws because there's no base. WDIO consults its **own** runner-level `baseUrl` config option for the base, not the PW driver-level `wdio:pwOptions.baseURL`.

**Fix**: Set both:

```ts
export const config = {
  baseUrl: 'https://app.test',                      // ← WDIO runner-level (for browser.url())

  capabilities: [{
    'wdio:pwOptions': { baseURL: 'https://app.test' }, // ← PW driver-level (for navigateTo + page.goto)
  }],
}
```

The driver-level `baseURL` covers the `navigateTo` protocol command and any raw `page.goto()` calls; WDIO's `baseUrl` covers the higher-level `browser.url()` wrapper. Set both to the same host and you get consistent behavior at both layers.

---

## `pwNewContext()` hangs for 30 seconds

**Symptom**: After registering routes via `pwRoute(...)`, calling `pwNewContext()` hangs for ~30 seconds before completing.

**Cause**: `context.close()` in `playwright-core` 1.59 deadlocks when network routes were registered on the context. It waits forever for a route handler to settle.

**Fix**: PW already works around this — `pwNewContext()` fire-and-forgets the close call rather than awaiting it. The old context becomes orphaned in memory (~1 BrowserContext-worth of state) and is reaped at `browser.close()` time at session teardown.

If you're seeing the hang anyway, you're probably on an older PW version that didn't have the workaround. Update to `wdio-pw-driver` ≥ 0.1.0-alpha.x.

---

## Tests pass but the trace zip is missing / empty

**Symptom**: Spec runs green, but `./traces/` is empty or the expected zip is missing.

**Possible causes**:

1. **Auto-trace not enabled**: `wdio:pwOptions.trace: true` must be in capabilities for the auto-trace path to write a zip. Without it, no trace happens unless your hooks call `pwStartTrace`/`pwStopTrace` themselves.

2. **`pwStopTrace` called without a path**: `pwStopTrace()` (no arg) discards the trace. To save, pass an explicit path: `pwStopTrace('./traces/my.zip')`.

3. **`pwStartTrace` was never called**: If you're using per-test trace pattern, verify the `beforeEach` / `beforeTest` hook actually fires. Add a console.log to confirm.

4. **Trace dir doesn't exist**: PW creates the dir before write, but custom paths in subdirectories may need pre-creation.

**Fix**: Run `wdioPW doctor` to verify the environment, then check your hook ordering with verbose logging.

---

## Embedded video player shows 0:00 / can't play

**Symptom**: Mochawesome report shows a `<video>` element but it's blank / 0:00.

**Possible causes**:

1. **No `recordVideo` capability set**: Without it Playwright doesn't record. Check capability includes `recordVideo: { dir, size }`.

2. **Video file not on disk yet**: The `.webm` is finalized only when the **page closes**. If you're rendering the report mid-session (rare), the file may not exist yet.

3. **`copyAssets` not enabled** (when serving the report over HTTP): If the video path is absolute and you're viewing the report via http://, the browser can't load `file:///...` URLs from an http page. Enable `copyAssets: true` in the reporter's `htmlReport` options — that copies videos into `assets/` and rewrites the path to relative.

**Fix**: Enable `copyAssets: true` and re-run. Verify `./reports/.../html/assets/page@<sha>.webm` exists.

---

## `Element not found` for selector that worked before

**Symptom**: A test that previously passed now fails with "Element not found" on a selector that visibly exists in the page.

**Possible causes**:

1. **You called `pwNewContext()`** — element-id refs from before the rotation are stale. The element store is wiped on rotation.

2. **You navigated away** — element refs are tied to a Page; navigation invalidates them.

3. **Frame switch not done** — if the element is inside an iframe and you didn't `switchToFrame`, PW looks at the wrong scope.

**Fix**: After `pwNewContext()` or any navigation, re-find the element with `findElement(...)` — don't reuse the old ref.

---

## "Invalid test object" from mochawesome

**Symptom**: Hooks run, but mochawesome rejects: `Error adding context: Invalid test object`.

**Cause**: You called `mochawesome/addContext(test, ...)` but `test` was WDIO's `TestStats` stub, not the actual Mocha test reference.

**Fix**: Don't use the upstream `mochawesome/addContext` with `wdio-mochawesome-reporter` — the reporter has its own channel:

```ts
process.emit('wdio-mochawesome-reporter:addContext', { title: '...', value: '...' })
```

The reporter listens for this event and pushes to the current test's context array. See **[reporting.md](./reporting.md#adding-per-test-metrics-with-addcontext)**.

---

## TypeScript: `Property 'pwSwitchDevice' does not exist on type 'Browser'`

**Symptom**: IDE shows red squiggle on `await browser.pwSwitchDevice(...)` even though it works at runtime.

**Cause**: The driver's type augmentation hasn't been activated in your project's tsconfig.

**Fix**: Drop a `globals.d.ts` at your project root:

```ts
/// <reference types="wdio-pw-driver" />
```

…and include it in `tsconfig.json`:

```json
{ "include": ["specs/**/*", "wdio.*.conf.ts", "globals.d.ts"] }
```

If the squiggle persists after this, restart your TypeScript server (VS Code: Cmd-Shift-P → "TypeScript: Restart TS Server"). The IDE's TS server caches the old `.d.ts` and doesn't auto-refresh.

---

## Spec runs ALL tests when you wanted just one

**Symptom**: `pnpm wdio --spec myfile.spec.ts` runs every spec in the project instead of just `myfile.spec.ts`.

**Cause**: WDIO's `--spec` needs a path-like value, not just a basename. `myfile.spec.ts` doesn't match anything, so WDIO falls back to running all specs from the configured glob.

**Fix**: Pass a relative or absolute path:

```bash
pnpm wdio --spec ./specs/myfile.spec.ts        # relative path, works
pnpm wdio --spec /abs/path/to/myfile.spec.ts   # absolute, works
pnpm wdio --spec specs/myfile.spec.ts          # relative without ./, also works
```

---

## Reports show same trace zip + same video for every test

**Symptom**: Every test in the report references the same `./traces/<sessionId>.zip` and the same video file.

**Cause**: You're using session-level trace + no context rotation. The default config behavior — one trace zip per session, one Page (and one .webm) per session, all tests share both.

**Fix**: Pick one of the per-test patterns from **[isolation.md](./isolation.md)**:
- `installPerTestHooks({ mode: 'per-test-isolated' })` inside the spec for per-test traces + videos
- `installPerTestHooks({ mode: 'per-test-trace' })` for per-test traces but session-shared video
- `wdio.isolated.conf.ts` to apply isolation to every spec in the run
- `wdio.per-test-trace.conf.ts` for per-test traces with stateful login flows

---

## "Spec Files: 0 passed, 1 failed" but no specific test failure shown

**Symptom**: The spec failed but you can't see which test.

**Cause**: A `before` / `beforeAll` / config hook threw before any tests ran.

**Fix**: Look at the full output (not just the tail). The hook error is logged earlier with a stack trace pointing at the failing function. Common culprits:
- `pwSwitchDevice('Bad Name')` throwing in a `before` hook
- A beforeAll's `browser.url(...)` failing
- Missing peer dep at session creation time

---

## CI: report was generated but shows 0 tests

**Symptom**: `index.html` is rendered with stats but the body is empty (no suites listed).

**Cause**: The merge logic in `onComplete` is reading the wrong field of the per-worker JSON. wdio-mochawesome-reporter writes `{ stats, suites: <root>, copyrightYear }` — NOT `{ stats, results: [...] }` like marge.

**Fix**: Use the merge helper exactly as the demo does:

```ts
const merged = {
  stats: sumStats,
  suites: {
    root: true,
    title: '',
    suites: reports.flatMap((r) => r.suites?.suites || []),
  },
}
```

The reporter's `generateHtml` accepts both `data.suites` (PW-native) and `data.results` (marge-style) shapes — but only if you pass the right one.
