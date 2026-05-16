---
sidebar_position: 0
title: Introduction
slug: /
---

# wdio-pw-driver

A WebdriverIO driver that runs your tests through **Playwright's native automation engine** instead of W3C WebDriver HTTP — no chromedriver, no geckodriver, no remote endpoint. Same WDIO commands, dramatically faster session startup and per-command latency.

## Why

The standard `webdriver` package in WebdriverIO sends every command as an HTTP request to a driver process (chromedriver, geckodriver, etc.). That's a roundtrip per click. **PW** drops that layer: it talks to the browser in-process via Playwright.

What you get:
- ⚡ **Faster startup** — no driver process to spawn
- ⚡ **Lower per-command latency** — no HTTP roundtrip
- 🧩 **Same WDIO API** — your existing test code does not change
- 🌐 **Cross-browser** — Chromium, Firefox, WebKit
- 📹 **Built-in trace + video** — without paying the chromedriver tax

## Install

```bash
npm install --save-dev wdio-pw-driver playwright-core
npx wdioPW install            # downloads chromium (default)
# or:
npx wdioPW install all        # chromium + firefox + webkit
```

## 30-second setup

```ts title="wdio.conf.ts"
import { PWService } from 'wdio-pw-driver'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',     // ← tells WDIO to load this driver
  services: [[PWService, {}]],              // ← auto-injects browser binary path

  capabilities: [{
    browserName: 'chromium',
    'wdio:pwOptions': { headless: true },
  }],

  framework: 'mocha',
  specs: ['./specs/**/*.spec.ts'],
  reporters: ['spec'],
}
```

```ts title="specs/example.spec.ts"
import { browser, expect } from '@wdio/globals'

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

## Where to go next

import DocCardList from '@theme/DocCardList'

<DocCardList />
