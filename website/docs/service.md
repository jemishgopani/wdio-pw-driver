---
sidebar_position: 4
title: PWService
description: "Auto-injects Playwright binary path into capabilities"
---

The WDIO launcher service that auto-resolves Playwright's browser binary path and writes it into your capabilities. Without it, every WDIO config has to import `chromium.executablePath()` from `playwright-core` by hand.

## Install

```ts
import PWService from 'wdio-pw-driver'

export const config = {
  // ...
  services: [[PWService, {}]],
}
```

That's it. Your capabilities can now skip the binary-path dance:

```ts
// before:
import { chromium } from 'playwright-core'
const binary = chromium.executablePath()
capabilities: [{
  browserName: 'chromium',
  'goog:chromeOptions': { binary },              // ← short-circuits WDIO's
                                                 //   setupPuppeteerBrowser
}]

// after:
capabilities: [{ browserName: 'chromium' }]      // PWService fills in the rest
```

---

## What it does

`onPrepare` is the launcher-side hook WDIO calls **once before any worker is spawned**. PWService's implementation:

1. Lazy-imports `playwright-core` (so module load stays cheap when nobody actually launches a session).
2. For each capability set in your config:
   - Resolves `browserName` to one of `chromium` / `firefox` / `webkit`.
   - If the user already set `wdio:pwOptions.executablePath` or the vendor-prefixed binary cap, **respect it and skip**.
   - Otherwise: call `playwright[engine].executablePath()` and write the path into:
     - `wdio:pwOptions.executablePath` — the driver's own driver reads this
     - `goog:chromeOptions.binary` (chromium only) — short-circuits WDIO's `setupPuppeteerBrowser` so it doesn't try to download its own Chromium via Puppeteer
     - `moz:firefoxOptions.binary` (firefox only) — same idea
     - WebKit has no W3C-standard binary cap; relying on `wdio:pwOptions.executablePath` is enough.

3. Logs each binary path it injected.

The mutation is in-place because that's the convention WDIO services have followed since v5 — returning a new array doesn't propagate to workers.

---

## Options

```ts
services: [[PWService, {
  ignoreUnsupportedBrowsers: false,    // throw fast on unknown browserName (default)
}]]
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `ignoreUnsupportedBrowsers` | `boolean` | `false` | When `false`: unsupported `browserName` values (e.g. `'safari-mobile'`) raise an error during `onPrepare`. When `true`: silently skip them. Useful for mixed-driver multiremote setups where one browser uses PW and another uses chromedriver. |

---

## Capability shapes the service handles

WDIO accepts capabilities in three shapes; PWService normalizes all of them:

```ts
// 1. Single-capability (one session at a time)
capabilities: { browserName: 'chromium' }

// 2. Parallel-array (N parallel sessions)
capabilities: [
  { browserName: 'chromium' },
  { browserName: 'firefox' },
]

// 3. Multiremote map (named sessions inside one test)
capabilities: {
  driverA: { capabilities: { browserName: 'chromium' } },
  driverB: { capabilities: { browserName: 'firefox' } },
}
```

The service walks all three shapes and applies the binary injection to each. For multiremote, it pokes into `.capabilities` automatically.

---

## When the service short-circuits

If you've already set a binary path in your capabilities, PWService notices and skips:

```ts
capabilities: [{
  browserName: 'chromium',
  'goog:chromeOptions': { binary: '/custom/path/chrome' },   // ← respected
}]
// PWService logs: "skipping chromium — caller already set binary at /custom/path/chrome"
```

Detection priority:
1. `wdio:pwOptions.executablePath` — PW-native field
2. `goog:chromeOptions.binary` (chromium) / `moz:firefoxOptions.binary` (firefox)

Either of those present = service skips that capability.

---

## What about per-test trace + context rotation?

Not a service concern — see **[isolation.md](./isolation.md)**. WDIO 9 doesn't expose `beforeTest` / `afterTest` as service hooks (those are Mocha framework hooks). For per-test isolation you either:

1. Add hooks at the top-level `wdio.conf.ts` (Pattern 2 / 3 in isolation.md), or
2. Call `installPerTestHooks()` inside the spec (Pattern 1 in isolation.md).

PWService is **launcher-only** — its only WDIO hook is `onPrepare`.

---

## Standalone usage (no service)

You can still use the driver without `PWService` — you just have to wire the binary path yourself in every config:

```ts
import { chromium } from 'playwright-core'
const playwrightChromium = chromium.executablePath()

capabilities: [{
  browserName: 'chromium',
  'goog:chromeOptions': { binary: playwrightChromium },
}]
```

This is the pre-PWService pattern. PWService just removes the boilerplate. If you have multiple configs (firefox / webkit / mobile / etc.), the boilerplate adds up — service is recommended.

---

## TypeScript activation

The driver also augments `WebdriverIO.Browser` (and the module-level `webdriverio.Browser`) with all `pw*` extension commands. To activate the augmentation in your project:

1. Drop a `globals.d.ts` at your project root:
   ```ts
   /// <reference types="wdio-pw-driver" />
   ```
2. Include it in your `tsconfig.json`:
   ```json
   { "include": ["specs/**/*", "wdio.*.conf.ts", "globals.d.ts"] }
   ```

After this, `await browser.pwSwitchDevice('iPhone 13')` is fully typed — no cast needed.

> **Why not just put `wdio-pw-driver` in `tsconfig.types[]`?** That works for flat npm layouts, but pnpm's nested `.pnpm/` store sometimes hides the package from the `types[]` resolution. The triple-slash always resolves regardless of layout.

---

## Common errors

### "PWService: requires playwright-core as a peer dependency"

`playwright-core` is a peer dep of `wdio-pw-driver`. Install it explicitly:

```bash
pnpm add -D playwright-core
npx wdioPW install
```

### "PWService: unsupported browserName"

You set a `browserName` the driver doesn't recognize. Supported: `chromium`, `chrome`, `edge`, `msedge`, `firefox`, `safari`, `webkit`. For mixed-driver multiremote (PW + chromedriver in one config), set `ignoreUnsupportedBrowsers: true`.

### Tests run but no browser opens

Probably WDIO's launcher is going down a Puppeteer path. Verify PWService is in `services: [...]` AND the capability has either `browserName: 'chromium'` (not just `'chrome'` if PWService isn't injecting) or you've manually set `goog:chromeOptions.binary`. Run `wdioPW doctor` to confirm a binary is cached.
