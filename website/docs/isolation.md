---
sidebar_position: 3
title: Test isolation
description: "Three patterns for per-test trace + context rotation"
---

WebdriverIO has two layers of test state — the **WDIO session** (one `PWDriver.newSession()` per worker) and the **Mocha lifecycle** (suites + tests inside a session). PW gives you three different ways to control where the boundaries land for trace recording, video recording, and BrowserContext rotation.

## TL;DR

| Pattern | Granularity | Login persists across tests? | Per-test trace? | Per-test video? | Setup |
|---|---|---|---|---|---|
| Default (no setup) | session | yes | no (one zip / session) | no (one .webm / session) | nothing — `wdio.conf.ts` as-is |
| **1. Spec-level helper** | per spec file | depends on mode | yes | yes (in `per-test-isolated`) | one import in the spec |
| **2. Whole-config isolation** | every spec in the run | no — each test fresh | yes | yes | dedicated config file |
| **3. Per-test trace, shared state** | every spec in the run | yes | yes | no (one .webm / session) | dedicated config file |

**Picking guide:**
- **Mixed suite** (some specs are stateful, some are self-contained) → Pattern 1
- **All specs are self-contained, you want isolation everywhere** → Pattern 2
- **All specs are stateful** but you want per-test trace zips for easier debugging → Pattern 3
- **Don't care about per-test diagnostics** → no setup, default config

---

## Pattern 1 — Spec-level helper

**Per-spec-file granularity. No `wdio.conf.ts` changes.** Each spec opts into the isolation level it wants by calling `installPerTestHooks` once at the top of the `describe`.

### Setup

Run with the **default config** (`pnpm wdio`). Inside any spec:

```ts
import { installPerTestHooks } from 'wdio-pw-driver'

describe('my self-contained suite', () => {
  installPerTestHooks({ mode: 'per-test-isolated' })

  it('starts fresh, gets its own trace + video', async () => {
    await browser.url('https://example.com')
    // ...
  })
})
```

That's literally it. Other specs in the same run that don't call the helper stay session-level.

### Options

```ts
installPerTestHooks({
  mode: 'per-test-trace' | 'per-test-isolated',
  traceDir: './traces',                // where to save per-test zips (default './traces')
  emitMetrics: true,                    // emit Trace zip + Duration to mochawesome (default true)
  extraContext: async (test, durationMs, { tracePath, mode }) => {
    // optional callback for additional context entries (Browser engine, video path, etc.)
  },
})
```

| Mode | Behavior |
|---|---|
| `'per-test-trace'` | `pwStartTrace` at `beforeEach` → `pwStopTrace(<traceDir>/<safeName>.zip)` at `afterEach`. Page + login persist. |
| `'per-test-isolated'` | Same as `per-test-trace` PLUS `pwNewContext()` at the end of `afterEach`. Fresh BrowserContext per test (cookies / login / routes reset). Each test gets its own video file too. |

### How it works

The helper installs Mocha `beforeEach` + `afterEach` hooks inside the current `describe`. Mocha runs them around every test in the block. WDIO's `browser` global is available, so the helper calls `pwStartTrace` / `pwStopTrace` / `pwNewContext` directly.

### When to use

You have one suite mixing stateful flows (login → navigate across tests) and self-contained tests. The default config keeps the stateful flows working; the helper opts the self-contained specs into isolation without touching the config.

Working example: `pw-demo/specs/pw-features.spec.ts`.

---

## Pattern 2 — Whole-config isolation

**Every spec in the run gets isolation.** Use a dedicated config (`wdio.isolated.conf.ts`) with `beforeTest`/`afterTest` hooks at the top level.

### Setup

The demo ships `pw-demo/wdio.isolated.conf.ts`. The minimal shape:

```ts
// wdio.isolated.conf.ts
import PWService from 'wdio-pw-driver'
import { attachPWContext } from './specs/_pw-context.js'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',
  services: [[PWService, {}]],

  capabilities: [{
    browserName: 'chrome',
    'wdio:pwOptions': {
      // Auto-trace OFF — hooks drive trace lifecycle.
      headless: true,
      recordVideo: { dir: './videos', size: { width: 800, height: 600 } },
    },
  }],

  framework: 'mocha',
  specs: ['./specs/**/*.spec.ts'],

  async beforeTest() {
    try { await (browser as any).pwStartTrace?.() } catch {}
  },

  async afterTest(test, ctx, result) {
    const safeName = (test.fullName ?? test.title).replace(/[^a-z0-9-]+/gi, '_').slice(0, 120)
    const tracePath = `./traces/${safeName}.zip`
    try { await (browser as any).pwStopTrace?.(tracePath) } catch {}
    try { await attachPWContext(ctx, result?.duration, { tracePath }) } catch {}
    try { await (browser as any).pwNewContext?.() } catch {}    // ← rotation is what makes it "isolated"
  },
}
```

Add a script:

```json
"scripts": {
  "wdio:isolated": "wdio run wdio.isolated.conf.ts"
}
```

Run:

```bash
pnpm wdio:isolated
pnpm wdio:isolated --spec ./specs/foo.spec.ts
```

### When to use

You're sure every spec in the run is self-contained — typically the case for a CI matrix slice that targets only `@playwright/test`-style suites. Cleaner than calling the helper in every spec file when the policy is uniform.

### Why hooks live in the config (not a service)

WDIO 9 services don't expose `beforeTest` / `afterTest`. Those are Mocha framework hooks, configured at the top-level config or via Mocha's own `beforeEach` / `afterEach`. There's no service-shaped escape from this — even if a service implements `beforeTest`, WDIO won't call it.

---

## Pattern 3 — Per-test trace, shared state

**Same as Pattern 2 but skip the `pwNewContext()` call.** Per-test trace zips for easy debugging, but cookies / login / Page persist across tests like the default config.

### Setup

The demo ships `pw-demo/wdio.per-test-trace.conf.ts`. The diff vs. Pattern 2 is exactly one line:

```ts
async afterTest(test, ctx, result) {
  const safeName = (test.fullName ?? test.title).replace(/[^a-z0-9-]+/gi, '_').slice(0, 120)
  const tracePath = `./traces/${safeName}.zip`
  try { await (browser as any).pwStopTrace?.(tracePath) } catch {}
  try { await attachPWContext(ctx, result?.duration, { tracePath }) } catch {}
  // NO pwNewContext() — login / cookies / Page persist
},
```

Add a script:

```json
"scripts": {
  "wdio:per-test-trace": "wdio run wdio.per-test-trace.conf.ts"
}
```

Run:

```bash
pnpm wdio:per-test-trace --spec ./specs/orangehrm-forms.spec.ts
```

### Trade-off

- ✅ Per-test trace zip — failed test #14? Just open `./traces/<test-14-name>.zip`, no need to scrub through 500 actions of session-level trace.
- ✅ Stateful specs work — log in once, navigate across tests as before.
- ❌ Video stays session-level — Playwright records video per Page; without `pwNewContext` we don't rotate the Page, so all tests share one `.webm`. If you need per-test video AND login persistence, you need a more elaborate setup (rotate context but pre-restore login state from a saved `storageState` file in `beforeEach`).

### When to use

Stateful suites (OrangeHRM-style: login → navigate through 25 modules → assert) where you'd otherwise have to scroll through a giant session-level trace to find the failing action. This pattern keeps the spec semantics identical to the default config — only the trace boundary changes.

---

## Decision matrix (full)

| Goal | Spec semantics | Pick |
|---|---|---|
| Fast iteration, don't care about diagnostics | any | Default `wdio.conf.ts` |
| Mixed suite — one self-contained spec needs isolation | mixed | **Pattern 1** |
| All specs self-contained, want isolation as project default | all self-contained | **Pattern 2** |
| Stateful suite, want per-test trace zips for debugging | stateful | **Pattern 3** |
| Stateful suite + per-test video | stateful + per-test video | Custom: Pattern 2 hooks + restore `storageState` in `beforeEach` |

---

## Capability auto-trace vs. hook-driven trace

Don't combine both — pick one:

| Approach | What it does | Use when |
|---|---|---|
| `wdio:pwOptions.trace: true` | PW starts trace at session creation, dumps one zip at `deleteSession`. Path: `<traceDir>/<sessionId>.zip` | You want a single session-level zip that captures everything |
| `pwStartTrace` / `pwStopTrace` in hooks | Each hook controls a trace zip explicitly | You want per-test or per-suite zips |

If both are set, the auto-trace start happens first; the hook's `pwStartTrace` would throw "already in progress." Hook-driven control assumes auto-trace is OFF.

---

## Mocha vs. Jasmine vs. Cucumber

The patterns above use Mocha hook names (`beforeTest`, `afterTest` for WDIO config; `beforeEach`, `afterEach` for spec-level). For Jasmine, the WDIO hook names are the same; for Cucumber, use `beforeStep` / `afterStep`. The driver commands (`pwStartTrace`, `pwNewContext`, etc.) are framework-agnostic — you call them the same way regardless.

The `installPerTestHooks` helper is currently Mocha-only since it uses Mocha's `beforeEach`/`afterEach`. For Jasmine/Cucumber projects, hand-roll the equivalent in the spec or in WDIO's framework-specific hooks.
