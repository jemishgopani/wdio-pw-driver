---
sidebar_position: 7
title: Architecture
description: "How the driver works internally"
---

How `wdio-pw-driver` works internally. Useful when extending the driver, debugging odd behavior, or just curious about the wire shape.

## What it replaces

Stock WebdriverIO uses the `webdriver` package for protocol handling — every `browser.click(...)` becomes an HTTP request to a driver process (chromedriver, geckodriver, etc.) which talks to the browser via CDP/Marionette. That's two network hops + a process boundary per command.

PW driver replaces the `webdriver` package's role entirely:
- No HTTP — everything is in-process
- No driver subprocess — `playwright-core` talks to the browser directly
- Same WDIO command surface — `browser.click()`, `$()`, `executeScript()` etc. all behave identically

The plug-in point is `automationProtocol: 'wdio-pw-driver'` in the WDIO config. WDIO's `getProtocolDriver()` (in `webdriverio/packages/webdriverio/src/utils/driver.ts`) treats `automationProtocol` as a Node module specifier and dynamic-imports it, then calls `.newSession()` on the default export.

## High-level flow

```
WDIO test runner
   │
   │ getProtocolDriver(config)         ← reads automationProtocol
   │
   ▼
import('wdio-pw-driver')              ← Node module resolution
   │
   ▼
PWDriver.newSession(options)          ← src/driver.ts
   │
   │ launchEngine()                   ← lazy-imports playwright-core
   │   └─ chromium.launch(opts) → browser
   │      └─ browser.newContext(opts) → context
   │         └─ context.newPage() → page
   │
   │ Build per-session state          ← src/types.ts:PWSession
   │   { browser, context, page, elementStore, dialogState, ... }
   │
   │ Build prototype object           ← src/client.ts
   │   for every command in @wdio/protocols:
   │     attach handler from src/commands/*
   │   for every pw* extension command:
   │     attach handler
   │
   │ webdriverMonad(options, mod, prototype)
   │   ← @wdio/utils — same factory the standard
   │      `webdriver` package uses to build the
   │      browser object
   │
   ▼
client object → returned to WDIO
   │
   ▼
test code calls browser.click(elementId)
   │
   ▼
prototype function (set up earlier):
  1. Look up session by sessionId
  2. Find handler for 'elementClick' in registry
  3. Translate WebDriver element-id → Playwright Locator
  4. await locator.click(timeout)
  5. Translate any thrown PW error → W3C error
  6. Return null (W3C convention for void commands)
```

The key insight: **PW driver looks like the `webdriver` package to WDIO**. Same `newSession` signature, same prototype shape, same client-object guarantees. WDIO doesn't know it's running on Playwright instead of HTTP.

## File layout

```
wdio-pw-driver/
├── bin/
│   └── wdio-pw.js              CLI dispatcher (install / trace / shard / etc.)
├── src/
│   ├── index.ts                Public exports
│   ├── driver.ts               PWDriver.newSession + launchEngine
│   ├── service.ts              PWService — auto-injects binary path
│   ├── testHelpers.ts          installPerTestHooks for spec-level isolation
│   ├── client.ts               webdriverMonad wiring + prototype builders
│   ├── command.ts              CommandHandler type, error wrapping, dispatch
│   ├── capabilities.ts         WDIO caps → Playwright launch+context options
│   ├── elementStore.ts         WebDriver element-id ↔ Playwright Locator map
│   ├── errors.ts               W3C error classes + Playwright-error translator
│   ├── scope.ts                Frame/page resolution for find* commands
│   ├── listeners.ts            Dialog + BiDi event listener wiring
│   ├── logger.ts               @wdio/logger wrapper
│   ├── types.ts                PWSession, PWOptions, PWCapabilities + ambient
│   ├── bidi/
│   │   └── events.ts           Page event → BiDi event translator
│   └── commands/               One file per command group
│       ├── index.ts            Command registry — name → handler map
│       ├── session.ts          deleteSession, status, *Timeouts
│       ├── navigation.ts       navigateTo, getUrl, back, forward, refresh
│       ├── element.ts          findElement, click, sendKeys, getText, ...
│       ├── execute.ts          executeScript, executeAsyncScript
│       ├── window.ts           getWindowHandle, switchToWindow, ...
│       ├── frame.ts            switchToFrame, switchToParentFrame
│       ├── alert.ts            acceptAlert, dismissAlert, getAlertText, ...
│       ├── actions.ts          performActions, releaseActions
│       ├── cookies.ts          getAllCookies, addCookie, deleteCookie, ...
│       ├── screenshot.ts       takeScreenshot, takeElementScreenshot
│       ├── print.ts            printPage
│       ├── bidi.ts             sessionSubscribe/Unsubscribe, browsingContextGetTree
│       ├── bidiScript.ts       script.* BiDi commands
│       ├── bidiContext.ts      browsingContext.* BiDi commands
│       ├── bidiStorage.ts      storage.* BiDi commands
│       ├── tracing.ts          pwStartTrace, pwStopTrace
│       ├── storage.ts          pwSaveStorage, pwLoadStorage
│       ├── context.ts          pwNewContext, pwSwitchDevice
│       ├── devices.ts          pwListDevices
│       ├── route.ts            pwRoute, pwUnroute
│       ├── har.ts              pwRouteFromHAR
│       ├── permissions.ts      pwGrantPermissions, pwSetGeolocation, ...
│       └── video.ts            pwGetVideo, pwSaveVideo
└── tests/                      Vitest unit + integration
```

## Session state

Per-session state lives in a `PWSession` object (`src/types.ts`) — one per `PWDriver.newSession()` call. The driver maintains a module-level `Map<sessionId, PWSession>` so multiple sessions can coexist in one Node process.

```ts
interface PWSession {
  sessionId: string                    // UUID for this session
  capabilities: PWCapabilities         // resolved (server-style)
  requestedCapabilities: PWCapabilities // user-provided (mutable for overrides)
  browser: PWBrowser                   // playwright-core Browser
  context: BrowserContext              // current BrowserContext
  currentPage: Page                    // active Page
  currentFrame: Frame | null           // current frame after switchToFrame
  pages: Map<string, Page>             // all pages by window handle
  elementStore: ElementStore           // element-id ↔ Locator
  defaultTimeout: number
  implicitTimeout: number
  dialogs: DialogState                 // alert/confirm/prompt snapshot + queued action
  inputState: InputState               // mouse/keyboard pressed-state for action chains
  bidi: BidiState                      // event subscriptions + emitter
  tracing: TracingState                // active flag + autoStop + autoPath
}
```

Commands are pure functions over this state. The session is passed in via `CommandContext.session`.

## Command dispatch

Each protocol command is registered in `src/commands/index.ts:registry` as `name → handler`. The handler signature:

```ts
type CommandHandler = (ctx: CommandContext, ...args: unknown[]) => Promise<unknown>
```

`src/client.ts:buildProtocolPrototype(registry)` walks every command in `@wdio/protocols`'s `WebDriverProtocol` and creates a prototype function that:

1. Resolves the session from `this.sessionId`
2. Looks up the handler in the registry
3. Wraps it with `wrapCommand` for error translation + logging
4. Calls it with `(ctx, ...args)`

Commands without a handler still appear on the prototype — they throw `NotImplementedError` when called. This matches WDIO's expectation that every protocol command exists.

The same pattern applies to BiDi commands (`buildBidiPrototype`) and PW extensions (`buildExtensionsPrototype`), which use their own command-name lists.

## Element store

WebDriver element references are W3C-spec strings of the form `element-6066-11e4-a52e-4f735466cecf: <uuid>`. PW maps each one to a Playwright `Locator`:

- `findElement(...)` resolves the selector → `loc = scope.locator(query).first()` → `await loc.waitFor({state:'attached'})` to confirm it materializes → register the locator in `session.elementStore` → return `{ element-...: <id> }`.
- Subsequent commands like `elementClick(elementId)` look up the locator by id and await `loc.click(...)`.

Locators are used (not `ElementHandle`s) because they're cheaper, auto-retry, and survive re-renders. The downside: a stale element rejection happens at the *action* time, not at the find time. PW translates Playwright's stale-locator errors to W3C `StaleElementReferenceError`.

Shadow roots get a parallel namespace (`shadow-6066-...`) since W3C wraps them differently.

## Error translation

Playwright throws errors with specific message shapes (`element is not attached to the DOM`, `target page, context or browser has been closed`, `waiting for selector ... timeout exceeded`, etc.). `src/errors.ts:translatePlaywrightError` maps them to W3C-shaped errors WDIO's higher-level expectations work with:

- `TimeoutError`, `NoSuchElementError`, `StaleElementReferenceError`, `ElementNotInteractableError`, `NoSuchWindowError`, `InvalidArgumentError`, `InvalidSessionIdError`, `NotImplementedError`

Anything else falls through to a generic `WebDriverError` with the raw Playwright message preserved.

## BiDi event bridge

When `webSocketUrl: true` is in capabilities, PW enables an in-process BiDi event bridge. There's no real WebSocket — the bridge listens to Playwright `Page` events and emits them on the WDIO Client EventEmitter in BiDi-shaped envelopes.

`src/bidi/events.ts:wireBidiEvents` registers listeners for:
- `console` → `log.entryAdded` (BiDi logging)
- `pageerror` → `log.entryAdded` with level: error
- `request` → `network.beforeRequestSent`
- `response` → `network.responseCompleted`
- `framenavigated` → `browsingContext.navigationStarted`
- `load` → `browsingContext.load`
- `domcontentloaded` → `browsingContext.domContentLoaded`
- `dialog` → `browsingContext.userPromptOpened`

Subscriptions are gated through `session.bidi.subscriptions` so events are only emitted when the user has called `sessionSubscribe([...])`.

## TypeScript augmentation

The driver augments two `Browser` interfaces:

1. **`WebdriverIO.Browser`** (the global namespace, used by `@wdio/globals`)
2. **`webdriverio.Browser`** (the package-level export, used by `import { remote, type Browser } from 'webdriverio'`)

Both get all `pw*` extension methods (`pwSwitchDevice`, `pwSaveVideo`, `pwListDevices`, etc.). The shared `PWExtensionCommands` interface is declared once in `types.ts` and applied to both via `interface Browser extends PWExtensionCommands {}`.

To bring the augmentation into module scope, `types.ts` does `import type {} from 'webdriverio'` — type-only, no runtime cost.

User activation: a one-line `globals.d.ts` with `/// <reference types="wdio-pw-driver" />`. Reason this is preferred over `tsconfig.types[]`: pnpm's nested `.pnpm/` layout sometimes hides the package from `types[]` resolution; the triple-slash always works.

## Why the engine import is lazy

`src/driver.ts:launchEngine` does `await import('playwright-core')` rather than a top-level static import. Two reasons:

1. **Cost**: `playwright-core` pulls in a moderate amount of code at module load. Users who only import the type definitions or the CLI shouldn't pay that cost.
2. **Error message**: if the user hasn't installed `playwright-core` (it's a peer dep), the dynamic import throws at session-launch time with a clear message pointing them at the install instructions. A top-level import would crash at module load with a less helpful stack.

Caveat: `src/capabilities.ts` *does* statically import `{ devices }` from `playwright-core`. The devices registry is just a JSON object, the cost is negligible, and the static import means the published ESM bundle works without falling into the "Dynamic require of playwright-core is not supported" trap that `require()` hit.

## Why no chromedriver

The whole driver replaces the W3C HTTP layer. Playwright already has its own native automation channel (`CDPSession` for chromium, GeckoDriver-style for firefox via WebDriver BiDi, etc.) — there's no benefit to wrapping it in HTTP just to unwrap it. Removing the HTTP layer is the entire performance win:

| Operation | Standard `webdriver` | PW driver |
|---|---|---|
| Element click | `WDIO → HTTP → chromedriver → CDP → browser` (4 hops) | `WDIO → in-process call → CDP → browser` (2 hops) |
| Session start | spawn chromedriver, wait for ready, HTTP `newSession` | direct `chromium.launch()` |
| Per-command latency | ~5-15ms | ~1-3ms |

Real test suites see ~10-20% speedup on the per-command latency win alone.

## See also

- **[configuration.md](./configuration.md)** — every `wdio:pwOptions` field
- **[commands.md](./commands.md)** — every `pw*` extension command
- **[isolation.md](./isolation.md)** — three test-isolation patterns
- **[service.md](./service.md)** — `PWService` deep dive
- **[reporting.md](./reporting.md)** — `wdio-mochawesome-reporter` integration
- **[cli.md](./cli.md)** — `wdioPW` CLI commands
- **[troubleshooting.md](./troubleshooting.md)** — common errors + fixes
