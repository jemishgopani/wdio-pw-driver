# Examples

Reference projects that use `wdio-pw-driver` against real public sites.
Each example is a standalone WebdriverIO project — clone, install, run.

| Example | Tier | Target | What it covers |
|---|---|---|---|
| [`minimal/`](./minimal/) | hello-world | https://example.com | 5 files, one spec, one assertion. The smallest viable wiring of the driver. |
| [`saucedemo/`](./saucedemo/) | full | https://www.saucedemo.com | Login (5 user types) + inventory sort (4 axes) + cart + checkout + side menu. ~25 specs. |

## Why these exist

Two purposes:

1. **Regression-finding** — a nightly CI run (see
   `.github/workflows/examples-nightly.yml`) executes every example
   against the latest driver build. Real third-party sites with real
   network latency, real DOM mutations, and real animations expose bugs
   that synthetic unit tests miss.

2. **User-facing reference** — when adopting the driver, copy the
   structure of the closest example into your project. Each example uses
   the page-object pattern, fixtures, a single `wdio.conf.ts`, and the
   recommended `wdio-pw-driver` features (auto-wait, capability-driven
   tracing, `PWService`).

## Adding a new example

1. `mkdir examples/<name>` and copy `saucedemo/` as a starting template.
2. Update `package.json#name` and the README's intro line.
3. Add the new example to the matrix in
   `.github/workflows/examples-nightly.yml`.
4. Open a PR — the workflow will run against your branch on push.

## Running locally

```bash
cd examples/saucedemo
pnpm install
node node_modules/playwright-core/cli.js install chromium    # one-time
pnpm test                            # headless
pnpm test:headed                     # headed (HEADLESS=false)
```

The example uses the driver via a `file:../..` dependency, so any change
to `src/` in the parent driver is picked up after a `pnpm build` in the
parent directory.
