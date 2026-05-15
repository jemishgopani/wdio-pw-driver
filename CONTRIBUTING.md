# Contributing to wdio-pw-driver

Thanks for considering a contribution. The driver is pre-1.0; the surface
area is moving but the contribution loop is straightforward.

## Local development

```bash
git clone git@github.com:jemishgopani/wdio-pw-driver.git
cd wdio-pw-driver
pnpm install
node ./bin/wdio-pw.js install chromium      # one-time browser install
pnpm build                                   # tsup → ./build
pnpm test                                    # vitest, ~40s
pnpm lint                                    # eslint
pnpm typecheck                               # tsc --noEmit
```

`pnpm` is required — the driver is a pnpm workspace and uses
`pnpm-lock.yaml`. `npm install` will produce a different dependency
tree.

## Repository layout

```
wdio-pw-driver/
  bin/                  # wdioPW CLI
  src/                  # driver source
    commands/           # one file per command group (element, alert, etc.)
    bidi/               # WebDriver BiDi event sources
    capabilities.ts     # WDIO caps → Playwright launch + context options
    client.ts           # builds the Browser prototype WDIO consumes
    driver.ts           # PWDriver class — newSession entry point
    service.ts          # PWService — WDIO launcher service + command overrides
    types.ts            # PWOptions, PWCapabilities, augmentation
    errors.ts           # WebDriverError + translatePlaywrightError
  tests/
    unit/               # vitest unit tests, no browser
    integration/        # vitest integration tests, real Chromium
  website/              # Docusaurus 3 docs site → jemishgopani.github.io/wdio-pw-driver/
  .github/workflows/    # CI + docs deploy
```

## Test conventions

- **Unit tests** in `tests/unit/` — no real browser. Use `PWService`
  directly with mock browsers; mock `playwright-core` only when the
  test asserts driver-internal behavior.
- **Integration tests** in `tests/integration/` — real headless Chromium
  via `PWDriver.newSession`. Each test uses a `data:text/html` URL with
  the inline app it needs; no network dependencies.
- **Coverage**: every new command handler needs at least one
  integration test exercising the success path and one asserting the
  failure mode (timeout / not-found / invalid args).

## Commit style

Conventional Commits. Examples from history:

```
feat(service): suppress redundant WDIO WebDriver-binary downloads
fix(cli): doctor resolves the cache path per-platform
docs(readme): trim to essentials
ci(docs): auto-enable Pages on first run
```

Subject under 70 chars. Use the body for the *why*, not the *what*
(the diff covers the *what*).

## Pull requests

1. Open a draft PR early — don't disappear into a 50-commit branch for
   weeks. The driver moves; rebases get expensive.
2. Run `pnpm test && pnpm lint && pnpm typecheck` before pushing.
3. CI must be green before review.
4. If your change touches the `wdio:pwOptions` schema or any exported
   command shape, add a CHANGELOG entry under `[Unreleased]`.

## Releasing

Releases are automated via `changesets`. Don't bump version manually:

```bash
pnpm changeset            # create a changeset describing your changes
git commit -am "..."
```

The release PR is opened automatically when changesets land on `main`.
Merging the release PR publishes to npm with provenance.

## Filing issues

Before opening an issue, check:

- The [troubleshooting docs](https://jemishgopani.github.io/wdio-pw-driver/docs/troubleshooting)
- Existing issues for duplicates
- That the bug is in the *driver*, not in `playwright-core` or `webdriverio` upstream

Include in the issue:

- `wdio-pw-driver` version (`pnpm list wdio-pw-driver`)
- `playwright-core` version
- Node version + OS
- A minimal `wdio.conf.ts` + spec reproducing the issue
- Output of `npx wdioPW doctor`

## Code of conduct

Be civil. Disagreements about technical approach are welcome; ad
hominem isn't. Maintainers reserve the right to close issues / PRs and
ban contributors who don't engage in good faith.
