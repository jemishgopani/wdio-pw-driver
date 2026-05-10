# wdio-pw-driver

> **Status:** pre-alpha. APIs and behavior will change.

A WebdriverIO driver that runs your tests through Playwright's native automation engine instead of W3C WebDriver HTTP — no chromedriver, no geckodriver, no remote endpoint. Same WDIO commands, dramatically faster session startup and per-command latency.

## Why

The standard `webdriver` package in WebdriverIO sends every command as an HTTP request to a driver process (chromedriver, geckodriver, etc.). That's a roundtrip per click. **PW** drops that layer: it talks to the browser in-process via Playwright.

What you get:
- **Faster startup** — no driver process to spawn.
- **Lower per-command latency** — no HTTP roundtrip.
- **Same WDIO API** — your existing test code does not change.
- **Cross-browser** — Chromium, Firefox, WebKit (via Playwright's engines).
- **Built-in trace + video** — without paying the chromedriver tax.

What you give up (in v0.1):
- A subset of WebDriver commands. See [docs/commands.md](./docs/commands.md).
- No mobile / Appium. No Selenium Grid.

## Install

```bash
npm install --save-dev wdio-pw-driver playwright-core
npx wdioPW install            # downloads chromium (default)
# or:
npx wdioPW install all        # chromium + firefox + webkit
```

## 30-second setup

```ts
// wdio.conf.ts
import PWService from 'wdio-pw-driver'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',     // ← tells WDIO to load this driver
  services: [[PWService, {}]],              // ← auto-injects browser binary path

  capabilities: [{
    browserName: 'chromium',                // chromium / firefox / webkit
    'wdio:pwOptions': { headless: true },
  }],

  framework: 'mocha',
  specs: ['./specs/**/*.spec.ts'],
  reporters: ['spec'],
}
```

```ts
// specs/example.spec.ts
import { browser, expect, $ } from '@wdio/globals'

describe('site', () => {
  it('loads', async () => {
    await browser.url('https://example.com')
    expect(await browser.getTitle()).toMatch(/Example/)
  })
})
```

```bash
pnpm wdio
```

## Documentation

Full docs site: **https://jemishgopani.github.io/wdio-pw-driver/** (or run locally: `cd website && pnpm install && pnpm start`).

The markdown source lives in [`website/docs/`](./website/docs/). Edits on `main` deploy automatically via `.github/workflows/deploy-docs.yml`. Quick links:

| Topic | Where |
|---|---|
| **All `wdio:pwOptions` fields + capability examples** | [Configuration](https://jemishgopani.github.io/wdio-pw-driver/docs/configuration) |
| **Every `pw*` extension command (signatures + examples)** | [Commands](https://jemishgopani.github.io/wdio-pw-driver/docs/commands) |
| **Per-test trace + video isolation patterns** | [Test isolation](https://jemishgopani.github.io/wdio-pw-driver/docs/isolation) |
| **`PWService` deep dive (binary injection, multiremote, etc.)** | [PWService](https://jemishgopani.github.io/wdio-pw-driver/docs/service) |
| **`wdioPW` CLI reference (install / trace / shard / doctor)** | [CLI](https://jemishgopani.github.io/wdio-pw-driver/docs/cli) |
| **Mochawesome reporter integration + custom themes** | [Reporting](https://jemishgopani.github.io/wdio-pw-driver/docs/reporting) |
| **How the driver works internally** | [Architecture](https://jemishgopani.github.io/wdio-pw-driver/docs/architecture) |
| **Common errors + fixes** | [Troubleshooting](https://jemishgopani.github.io/wdio-pw-driver/docs/troubleshooting) |

## Quick reference

### Standalone (no test runner)

```ts
import { remote } from 'wdio-pw-driver'

const browser = await remote({
  capabilities: { browserName: 'chromium' },
})

await browser.url('https://example.com')
console.log(await browser.getTitle())
await browser.deleteSession()
```

### Storage state — log in once, reuse across runs

```ts
// First run:
await browser.url('https://app.test/')
await login(browser)
await browser.pwSaveStorage('./.auth/admin.json')

// Subsequent runs (in capabilities):
'wdio:pwOptions': { storageState: './.auth/admin.json' }
```

### Per-test isolation (one trace + one video per test)

```ts
import { installPerTestHooks } from 'wdio-pw-driver'

describe('my isolated suite', () => {
  installPerTestHooks({ mode: 'per-test-isolated' })
  it('starts fresh, gets its own trace + video', async () => { ... })
})
```

See [docs/isolation.md](./docs/isolation.md) for full pattern reference.

### Trace recording

```ts
// Capability-driven (one zip per session):
'wdio:pwOptions': { trace: true, traceDir: './traces' }

// Per-test (one zip per test, only kept on failure — `pw-demo/wdio.trace-on-failure.conf.ts`):
async beforeTest() { await browser.pwStartTrace?.() }
async afterTest(test, _ctx, result) {
  if (result.passed) await browser.pwStopTrace?.()
  else                await browser.pwStopTrace?.(`./traces/${safeName(test)}.zip`)
}
```

Open: `npx wdioPW trace ./traces/<file>.zip`

### Network mocking

```ts
await browser.pwRoute('**/api/users', { status: 200, body: { users: [...] } })
await browser.pwRoute('**/analytics/**', { abort: 'failed' })
await browser.pwUnroute('**/api/users')
```

### Mobile emulation

```ts
// At launch:
'wdio:pwOptions': { device: 'iPhone 13' }

// Or runtime:
await browser.pwSwitchDevice('iPhone 13')
await browser.pwSwitchDevice(null)         // back to launch defaults
```

### CI sharding

```bash
pnpm wdio --spec $(npx wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 2)
```

## TypeScript activation

The driver augments `WebdriverIO.Browser` with all `pw*` methods so user specs don't need casts. Drop a one-line `globals.d.ts` at your project root:

```ts
/// <reference types="wdio-pw-driver" />
```

…and include it in `tsconfig.json`:

```json
{ "include": ["specs/**/*", "wdio.*.conf.ts", "globals.d.ts"] }
```

After this, `await browser.pwSwitchDevice('iPhone 13')` is fully typed.

## Status

| Phase | Status |
|---|---|
| 0. Scaffolding | ✅ done |
| 1. Hello World (url / title / click / getText) | ✅ done |
| 2. Element coverage | ✅ done |
| 3. Browser-level coverage | ✅ done |
| 4. Frames, alerts, actions | ✅ done |
| 5. BiDi events | ✅ done (8 events + sessionSubscribe/Unsubscribe) |
| 6. Cross-browser (firefox / webkit) | ✅ done |
| 7. Tier A polish (doctor, type augmentation, CHANGELOG) | ✅ done |
| 8. Tier B (storage state, network mocking, fresh context) | ✅ done |
| 9. Tier C (cross-browser matrix, GH Actions, BiDi expansion) | ✅ done |
| 10. Tier D (devices, offline, baseURL, video, HAR, etc.) | ✅ done |

## Sample project

`pw-demo/` is a complete WDIO project that uses this driver. It ships with working configs for every common scenario (default, mobile, video, BiDi, isolated, per-test trace, trace-on-failure, video-on-failure) plus a real test suite against the public OrangeHRM demo. See `pw-demo/README.md`.

## License

MIT
