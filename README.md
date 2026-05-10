# wdio-pw-driver

> **Status:** pre-alpha. APIs and behavior may change before `v1.0`.

A WebdriverIO 9 driver that runs your tests through Playwright's native automation engine instead of W3C WebDriver HTTP — no chromedriver, no geckodriver, no remote endpoint. Same WDIO commands, faster session startup, lower per-command latency.

**What you get**

- **Faster startup** — no driver process to spawn.
- **Lower per-command latency** — no HTTP roundtrip; commands dispatch in-process.
- **Same WDIO API** — your existing test code does not change.
- **Cross-browser** — Chromium, Firefox, WebKit, all via Playwright's engines.
- **Built-in trace + video** — recording controlled by capabilities or per-test hooks.
- **Playwright extensions** — `pwRoute`, `pwSwitchDevice`, `pwGrantPermissions`, `pwOnFileChooser`, `pwAriaSnapshot`, `pwWaitForResponse`, `pwSaveStorage`, and more.

**What you give up**

- A subset of W3C WebDriver commands (covers the WDIO command surface; full matrix in the docs).
- No mobile / Appium. No Selenium Grid.

## Install

```bash
npm install --save-dev wdio-pw-driver playwright-core
npx wdioPW install              # downloads chromium (default)
# or:
npx wdioPW install all          # chromium + firefox + webkit
```

`playwright-core` is a peer dependency — pin whatever version you want.

## Minimal config

```ts
// wdio.conf.ts
import PWService from 'wdio-pw-driver'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',     // tells WDIO to load this driver
  services: [[PWService, {}]],              // auto-injects the browser binary path

  capabilities: [{
    browserName: 'chromium',                // chromium / firefox / webkit
    'wdio:pwOptions': { headless: true },
  }],

  framework: 'mocha',
  specs: ['./test/specs/**/*.spec.ts'],
  reporters: ['spec'],
}
```

```ts
// test/specs/example.spec.ts
import { browser, expect } from '@wdio/globals'

describe('site', () => {
  it('loads', async () => {
    await browser.url('https://example.com')
    expect(await browser.getTitle()).toMatch(/Example/)
  })
})
```

```bash
npx wdio
```

## Standalone (no test runner)

```ts
import { remote } from 'wdio-pw-driver'

const browser = await remote({
  capabilities: { browserName: 'chromium' },
})

await browser.url('https://example.com')
console.log(await browser.getTitle())
await browser.deleteSession()
```

## TypeScript

Drop a one-line `globals.d.ts` at your project root so `browser.pw*()` calls type-check without casts:

```ts
/// <reference types="wdio-pw-driver" />
```

…and include it in your `tsconfig.json`:

```json
{ "include": ["test/**/*", "wdio.*.conf.ts", "globals.d.ts"] }
```

## CLI

The package ships a `wdioPW` CLI for browser-binary management and trace inspection:

```bash
npx wdioPW install [browser…]   # download browser binaries
npx wdioPW trace <file.zip>     # open a trace zip in the trace viewer
npx wdioPW doctor               # diagnose the environment
npx wdioPW --help               # full help
```

## Documentation

Full docs: **https://jemishgopani.github.io/wdio-pw-driver/**

| Topic | Where |
|---|---|
| All `wdio:pwOptions` fields + capability examples | [Configuration](https://jemishgopani.github.io/wdio-pw-driver/docs/configuration) |
| Every `pw*` extension command (signatures + examples) | [Commands](https://jemishgopani.github.io/wdio-pw-driver/docs/commands) |
| Per-test trace + video isolation patterns | [Test isolation](https://jemishgopani.github.io/wdio-pw-driver/docs/isolation) |
| `PWService` reference (binary injection, multiremote) | [PWService](https://jemishgopani.github.io/wdio-pw-driver/docs/service) |
| `wdioPW` CLI reference | [CLI](https://jemishgopani.github.io/wdio-pw-driver/docs/cli) |
| How the driver works internally | [Architecture](https://jemishgopani.github.io/wdio-pw-driver/docs/architecture) |
| Common errors + fixes | [Troubleshooting](https://jemishgopani.github.io/wdio-pw-driver/docs/troubleshooting) |

Markdown source for the site lives in [`website/docs/`](./website/docs/) and deploys automatically on push to `main` via [`.github/workflows/deploy-docs.yml`](./.github/workflows/deploy-docs.yml).

## License

MIT — see [LICENSE](./LICENSE).
