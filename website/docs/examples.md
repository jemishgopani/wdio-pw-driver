---
sidebar_position: 11
title: Examples
description: Reference projects that use wdio-pw-driver against real public sites.
---

# Examples

Each example is a standalone WebdriverIO project that runs against a real
public site — copy any one of them into your own repo as a starting point.

A nightly CI workflow runs every example against the latest driver build,
so they double as a regression-finding mechanism.

## Available examples

| Example | Tier | Target | What it covers |
|---|---|---|---|
| [`minimal/`](https://github.com/jemishgopani/wdio-pw-driver/tree/main/examples/minimal) | hello-world | https://example.com | 5 files, one spec — the smallest viable driver wiring |
| [`saucedemo/`](https://github.com/jemishgopani/wdio-pw-driver/tree/main/examples/saucedemo) | full | https://www.saucedemo.com | Page objects + fixtures + ~25 specs (login / sort / cart / checkout / menu) |

More targets coming — OrangeHRM and demowebshop are next.

**Adoption path**: start with `minimal/` to verify the driver wires up
in your environment. Once that passes, copy the structure of `saucedemo/`
(page-object pattern + fixtures + capability-driven tracing) into your
own repo as the foundation.

## Running the SauceDemo example

```bash
git clone https://github.com/jemishgopani/wdio-pw-driver.git
cd wdio-pw-driver
pnpm install && pnpm build              # build the driver

cd examples/saucedemo
pnpm install
node node_modules/playwright-core/cli.js install chromium
pnpm test                               # ~25s headless
```

## Why this structure?

Each example uses the **page-object pattern** with selectors centralized
under `test/page-objects/`, fixtures (test data) under `test/fixtures/`,
and specs under `test/specs/`. This is the structure most adopting teams
end up at; we use it so the example is directly copy-pasteable into a
real project.

The example's `package.json` depends on the driver via `file:../..`, so
edits to the driver source flow through after a `pnpm build` in the
parent directory. When adapting for your own project, replace that with
the published version:

```diff
-"wdio-pw-driver": "file:../.."
+"wdio-pw-driver": "^0.1.0-beta.0"
```

## Adding a new example

If you maintain a public WDIO test suite that hits an interesting edge
case the existing examples don't cover, contributions are welcome —
open a PR adding `examples/<your-name>/` and a row in the table here.

See [CONTRIBUTING.md](https://github.com/jemishgopani/wdio-pw-driver/blob/main/CONTRIBUTING.md)
for the full contribution flow.
