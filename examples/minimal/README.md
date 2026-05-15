# Minimal example — wdio-pw-driver

Five-file hello-world. Use this as a copy-paste starting point when
adopting `wdio-pw-driver` in a new project.

## Files

```
examples/minimal/
  package.json     # WDIO + this driver, nothing else
  wdio.conf.ts     # 25 lines, three driver-specific
  test.spec.ts     # one spec, one assertion
  tsconfig.json    # standard strict TS
  README.md
```

## Run it

```bash
pnpm install
node node_modules/playwright-core/cli.js install chromium    # one-time
pnpm test
```

Should complete in ~3 seconds: launches headless Chromium via Playwright,
navigates to https://example.com, asserts the heading text + page title.

## What to copy into your project

The three driver-specific lines from `wdio.conf.ts`:

```ts
import { PWService } from 'wdio-pw-driver'

export const config = {
  automationProtocol: 'wdio-pw-driver',
  services: [[PWService, {}]],
  // ... your existing capabilities
}
```

Everything else in the config is stock WebdriverIO 9.

## Next step

For a more substantial example with page objects, fixtures, multi-page
flows, and capability-driven tracing, see [`examples/saucedemo/`](../saucedemo/).
