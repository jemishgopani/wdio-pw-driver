# SauceDemo example — wdio-pw-driver

A complete WebdriverIO 9 project that runs an e-commerce flow
(login → browse → sort → add to cart → checkout) against the public
SauceDemo site at https://www.saucedemo.com.

## Running

```bash
pnpm install
node node_modules/playwright-core/cli.js install chromium    # one-time
pnpm test                            # headless
HEADLESS=false pnpm test             # headed, for debugging
```

`pnpm test` runs all 4 spec files (login, inventory sort, cart + checkout,
side menu) in sequence — about 25 seconds total against a warm cache.

## Structure

```
examples/saucedemo/
  wdio.conf.ts                 # WDIO config — uses our driver + PWService
  globals.d.ts                 # pulls in WebdriverIO.Browser augmentation
  test/
    fixtures/
      users.ts                 # known SauceDemo accounts
    page-objects/
      base.page.ts             # common open() pattern
      login.page.ts
      inventory.page.ts
      cart.page.ts
      checkout.page.ts
      header.component.ts      # persistent burger menu + cart icon
      index.ts                 # barrel
    specs/
      login.spec.ts
      inventory-sort.spec.ts
      cart-checkout.spec.ts
      menu-state.spec.ts
```

## What the driver does for you here

| Spec | Driver feature exercised |
|---|---|
| `login.spec.ts` | `setValue` → Playwright `pressSequentially`; `waitForDisplayed` on inline error → in-page polling |
| `inventory-sort.spec.ts` | `selectByAttribute` → `<option>` click special-case (routes to `parentSelect.selectOption()`); without this, each sort would hang for 30 s |
| `cart-checkout.spec.ts` | Multi-page navigation, `$$().map()`, badge-presence assertions across re-renders |
| `menu-state.spec.ts` | `not.toBeExisting()` on the cart badge after reset — relies on our driver returning the not-found body shape rather than throwing |

## Configuration highlights (`wdio.conf.ts`)

- `automationProtocol: 'wdio-pw-driver'` — the only setting that switches WDIO to this driver
- `services: [[PWService, {}]]` — auto-injects Playwright's bundled binary AND skips chromedriver download
- `wdio:pwOptions.trace: true` — every session writes a trace zip to `./traces/`. Open with `npx wdioPW trace ./traces/<file>.zip`
- `wdio:pwOptions.recordVideo: { dir: './videos' }` — webm per page, useful for debugging headless failures

## Adapting for your own project

1. Copy this directory to your project root.
2. Change `baseUrl` in `wdio.conf.ts` to your app.
3. Replace `test/page-objects/*.ts` and `test/specs/*.ts` with selectors and assertions for your app.
4. Keep `wdio:pwOptions` and the `PWService` line — those are what give you the auto-wait + tracing benefits.
