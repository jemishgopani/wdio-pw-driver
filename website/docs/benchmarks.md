---
sidebar_position: 5
title: Benchmarks
---

# Benchmarks

Real-world execution-time comparison between **wdio + chromedriver** (`automationProtocol: "webdriver"`) and **wdio + pw-driver** (`automationProtocol: "wdio-pw-driver"`) on the same WebdriverIO 9 test suite.

## Test suite

A production-grade Angular Material SPA with **15 spec files / 51 individual tests** covering:

- Auth: login (positive + negative), registration (positive + negative)
- CRUD: form-heavy create / edit / delete / search / view flows
- UI interactions: mat-select dropdowns, country-code phone pickers, CDK overlays, dialogs, snackbars
- Long workflows: a multi-step plugin marketplace install/remove cycle

Same source code, same backend, same machine. Only the automation protocol changes.

## Setup

| | |
|---|---|
| Machine | macOS arm64, mid-range dev laptop |
| Backend | Real (localhost, no mocks) |
| WebdriverIO | 9.x |
| `maxInstances` | 4 |
| Viewport | 1920×1080 |
| Browser | Chrome / Chromium |
| Mocha retries | 1 (headed) / 2 (headless, `CI=1`) |

Each cell below is the WebdriverIO-reported wall clock for the spec file (`"N passing (Xs)"`). The total row is from WDIO's launcher summary (`"Spec Files: 15 passed in HH:MM:SS"`).

## Per-spec wall-clock

Spec names anonymized to reflect what each exercises rather than the application's domain.

| Spec (what it exercises) | wdio (Headed) | wdio (Headless) | PW (Headed) | PW (Headless) |
|---|---:|---:|---:|---:|
| Form validation — negative | 37.0s | 36.4s | 22.5s | 21.4s |
| Form create + table refresh | 43.3s | 42.6s | 27.4s | 26.2s |
| Confirm-dialog cancel | 46.8s | 45.4s | 29.6s | 28.2s |
| List + filter UI | 47.0s | 45.5s | 31.9s | 31.8s |
| Multi-step delete → restore → trash | 101.6s | 99.3s | 75.6s | 74.8s |
| Delete with snackbar confirmation | 90.7s | 90.6s | 69.5s | 68.4s |
| Search input + filtered list | 49.3s | 48.3s | 34.8s | 34.1s |
| Toggle row state | 48.3s | 49.6s | 34.3s | 34.3s |
| Edit form (mat-select + multi-field) | 109.2s | 107.4s | 80.8s | 79.9s |
| Detail panel open/close | 34.2s | 35.0s | 20.6s | 20.4s |
| Multi-step registration (negative) | 96.6s\* | 31.6s | 4.4s | 3.5s |
| Multi-step registration (positive) | 44.3s | 48.2s | 12.4s | 11.2s |
| Login form validation (negative) | 42.6s | 44.7s | 7.7s | 6.8s |
| Login + logout + toggle | 37.2s | 37.9s | 14.1s | 12.7s |
| Marketplace install + remove (network-heavy) | 162.4s | 162.7s | 96.6s | 96.2s |
| **Wall-clock total** | **5m 17s** | **5m 13s** | **3m 22s** | **3m 19s** |

\* One transient retry in this run.

## Headline numbers

- **PW vs wdio (Headed):** ~36% faster (3:22 vs 5:17)
- **PW vs wdio (Headless):** ~36% faster (3:19 vs 5:13)
- **Headed vs Headless (wdio):** within ~1% — not a meaningful axis
- **Headed vs Headless (PW):** within ~1.5% — not a meaningful axis

## Where the gains come from

The relative speedup varies a lot per spec, and the pattern is consistent: **PW eliminates per-command protocol overhead, but cannot make backend / network operations faster**.

| Spec | wdio Headed | PW Headed | Speedup |
|---|---:|---:|---:|
| Login form validation (negative) | 42.6s | 7.7s | **5.5×** |
| Multi-step registration (positive) | 44.3s | 12.4s | **3.6×** |
| Detail panel open/close | 34.2s | 20.6s | **1.7×** |
| Multi-step delete → restore → trash | 101.6s | 75.6s | **1.3×** |
| Marketplace install + remove | 162.4s | 96.6s | **1.7×** |

Specs with **many small DOM interactions** (form-fill + button-click chains) see 3–6× speedups because per-command overhead dominates. Specs with **long network operations or backend waits** see modest gains because backend latency dominates regardless of automation protocol.

## Headed vs headless

For both drivers the difference is **within measurement noise**. Modern Chromium's `--headless=new` still runs the GPU rendering pipeline; the only thing skipped is the final blit to the screen, bounded by your monitor's refresh rate (~16ms per frame). Over a multi-minute test run that's negligible compared to network and page-load time.

**Takeaway:** pick headed/headless for debuggability (screenshots, watching the run), not for speed.

## Caveats

- **Single run per cell** — not statistical. Variance between runs of the same config is small (~1–2%) in our experience, but a flaky test can swing one cell by tens of seconds.
- **Hardware-dependent absolutes** — slower CI machines will show larger absolute numbers; the *relative* shape of the comparison should be preserved.
- **Localhost backend** — testing against staging/prod over the internet would shift the network/driver ratio toward network, shrinking PW's relative advantage.
- **Chromium only** — Firefox / WebKit benchmarks are not included; engine support there is still maturing.
- **Wall-clock includes everything** — Mocha setup, beforeEach/afterEach overhead, screenshot writes, parallel-runner scheduling, etc. — not just driver overhead. Per-command microbenchmarks would show a larger PW advantage.

## Reproducing

```bash
# wdio + chromedriver
npx wdio run ./wdio.conf.ts

# wdio + pw-driver (same suite, different config)
npx wdio run ./wdio-pw.conf.ts
```

The pw config differs from a chromedriver config by ~5 lines — see [Configuration](./configuration). Re-run with `CI=1` to switch both drivers to headless. Capture the per-spec lines from WDIO's spec reporter to populate your own version of this table.

## Why this matters

A 36% drop in wall-clock time on a real suite compounds:

- **PR feedback loop**: a CI run that took 5:15 now takes 3:20 — over hundreds of PRs per week, that's measurable engineer time saved
- **Cost**: CI minutes are billed; a 36% reduction in test-job duration directly reduces spend
- **Iteration**: faster local runs make developers more likely to run the full suite before pushing, catching regressions earlier

The trade-off: pw-driver is a faster execution surface, which sometimes exposes **pre-existing test races** that chromedriver's natural latency hid. Those are real bugs in the test code, not driver bugs — see [Troubleshooting](./troubleshooting) for the common patterns and fixes.
