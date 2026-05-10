---
sidebar_position: 5
title: Reporting
description: "wdio-mochawesome-reporter integration + theming"
---

The PW driver pairs naturally with [wdio-mochawesome-reporter](https://github.com/jemishgopani/wdio-mochawesome-reporter) (the project's own fork — v8.0.0+ ships a built-in HTML renderer so you don't need `mochawesome-report-generator` / marge / React).

## Setup

Install the reporter:

```bash
pnpm add -D wdio-mochawesome-reporter
```

Wire it in `wdio.conf.ts`:

```ts
reporters: [
  'spec',                                              // keep live console output
  ['mochawesome', {
    outputDir: './reports/mochawesome/json',           // per-worker JSON
    outputFileFormat: ({ cid, capabilities }) =>
      `wdio-${cid}-${capabilities.browserName}.json`,
    htmlReport: {                                      // ← v8 inline HTML
      dir: './reports/mochawesome/html',
      reportTitle: 'My Project',
      reportPageTitle: 'CI run #1234',
      brandText: 'My Project • test report',
      copyAssets: true,                                // copy referenced media
      // theme: { brandPrimary: '#...', ... }          // optional brand
    },
  }],
],
```

After every WDIO worker exits, the reporter writes:
- `reports/mochawesome/json/wdio-<cid>-<browser>.json` — raw test results
- `reports/mochawesome/html/wdio-<cid>-<browser>.html` — themed self-contained HTML
- `reports/mochawesome/html/assets/<file>` — copied media (videos, screenshots) when `copyAssets: true`

For a combined cross-worker `index.html` (multiple workers' results merged into one file), use `generateHtml` from the reporter directly in your `onComplete` hook — see `pw-demo/wdio.conf.ts` for the template.

---

## `htmlReport` options

| Option | Type | Default | What it does |
|---|---|---|---|
| `dir` | `string` | `outputDir` | Where to write the per-worker HTML (and the assets/ subdir) |
| `reportTitle` | `string` | `'Test Report'` | The big H1 in the topbar (left side) |
| `reportPageTitle` | `string` | `reportTitle` | Subtitle under H1 + the browser tab `<title>` |
| `brandText` | `string` | `'wdio-mochawesome-reporter'` | Text in the top gradient banner |
| `copyAssets` | `boolean \| { dir }` | `false` | Copy media file paths in context entries into `dir/assets/` and rewrite to relative URLs |
| `theme` | `Record<string,string>` | (light theme defaults) | Override CSS variables — see Theming below |

---

## Theming

The HTML report's design is driven entirely by CSS variables defined on `:root`. Pass `theme: { ... }` to override any of them:

```ts
htmlReport: {
  // ...
  theme: {
    brandPrimary: '#0d9488',           // teal — accents, key numbers, banner gradient start
    brandPrimaryDark: '#0f766e',
    brandAccent: '#db2777',            // pink — banner gradient end, link hover
    brandSuccess: '#15803d',           // pass status pill / count
    brandDanger: '#dc2626',            // fail status pill / count
    brandWarning: '#d97706',           // pending
    pageBg: '#f8fafc',                 // page background
    cardBg: '#ffffff',                 // suite/test cards
    text: '#0f172a',                   // primary text
    textMute: '#64748b',               // secondary text + labels
    border: '#e2e8f0',                 // hairlines
    bodyFont: '-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif',
    monoFont: '"SF Mono",Menlo,Consolas,monospace',
  },
}
```

Dark theme example (full):

```ts
theme: {
  brandPrimary: '#14b8a6',
  brandPrimaryDark: '#0f766e',
  brandAccent: '#ec4899',
  brandSuccess: '#10b981',
  brandDanger: '#ef4444',
  brandWarning: '#f59e0b',
  pageBg: '#0f172a',
  cardBg: '#1e293b',
  text: '#e2e8f0',
  textMute: '#94a3b8',
  border: '#334155',
}
```

Note: status-pill background colors use `rgba(<channel>, 0.1)` overlays of the brand colors, so they tint correctly under both light and dark themes automatically.

---

## Adding per-test metrics with `addContext`

`wdio-mochawesome-reporter` listens on a `process.emit` channel. Emit `{ title, value }` objects from any hook to add a row to the test's "Additional Test Context" block.

```ts
process.emit('wdio-mochawesome-reporter:addContext', {
  title: 'Browser',
  value: `${browser.capabilities.browserName} ${browser.capabilities.browserVersion}`,
})
```

The PW demo's `attachPWContext()` helper (`pw-demo/specs/_pw-context.ts`) emits a standard set of metrics:
- Browser engine + version
- Device preset (when set)
- Base URL (when set)
- Trace zip path (per-test or session-level)
- Video path (when `recordVideo` is on)
- Duration

```ts
async afterTest(test, ctx, result) {
  await attachPWContext(ctx, result.duration, { tracePath: '...' })
}
```

Drop the helper into your project as a starting point.

---

## Embedded video / image / link rendering

When `copyAssets: true` is set, the reporter scans context values for absolute file paths to media (`.webm`, `.mp4`, `.mov`, `.png`, `.jpg`, `.gif`), copies them into `<dir>/assets/`, and renders them as `<video controls>` / `<img>` instead of plain text:

```ts
process.emit('wdio-mochawesome-reporter:addContext', {
  title: 'Video',
  value: '/abs/path/to/recording.webm',          // copied → 'assets/recording.webm'
})
```

The report stays portable — zip the html dir, share it, host on any static server, the embedded video still plays.

For values that aren't on the local filesystem (URLs, etc.), pass a structured object directly:

```ts
process.emit('wdio-mochawesome-reporter:addContext', {
  title: 'Trace',
  value: { type: 'link', src: 'https://trace.playwright.dev/?trace=...', label: 'Open trace' },
})
```

Recognized structured shapes:

| Shape | Renders as |
|---|---|
| `{ type: 'video', src, mime? }` | `<video controls><source src=… type=…></video>` |
| `{ type: 'image', src, alt? }` | `<img src=… alt=…>` |
| `{ type: 'link', src, label? }` | `<a href=… target="_blank">label</a>` |

---

## Combined cross-worker report

For a single `index.html` that aggregates multiple workers' results, import `generateHtml` + `transformMediaContexts` from the reporter and merge in `onComplete`:

```ts
import { generateHtml, transformMediaContexts } from 'wdio-mochawesome-reporter/src/htmlReport.js'
// (TS shim in globals.d.ts; see pw-demo/globals.d.ts)

async onComplete() {
  const reports = readdirSync(jsonDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(jsonDir, f), 'utf8')))

  // Sum stats, concatenate suites under one synthesized root.
  const merged = {
    stats: reports.reduce((acc, r) => {
      for (const k of Object.keys(r.stats))
        if (typeof r.stats[k] === 'number') acc[k] = (acc[k]||0) + r.stats[k]
      return acc
    }, {}),
    suites: { root: true, suites: reports.flatMap(r => r.suites?.suites || []) },
  }

  transformMediaContexts(merged, htmlDir, {})       // copy media + rewrite paths
  const html = generateHtml(merged, { reportTitle: '...' })
  writeFileSync(join(htmlDir, 'index.html'), html)
}
```

Working example: `pw-demo/wdio.conf.ts:onComplete`.

---

## Why not marge?

`mochawesome-report-generator` (marge) is the upstream HTML renderer. It ships a 1+ MB React bundle that loads the JSON client-side and renders via React + Chartist. The result: a 580 KB+ report dir that needs JavaScript at view time.

The fork's built-in renderer is pure server-side template — emits a single self-contained HTML file (~25 KB) with all CSS inlined. Native `<details>/<summary>` handles collapse/expand. No React, no Chartist, no client-side JS framework.

Trade-off: marge has more features baked in (test-result history charts, config-driven sidebar, etc.). The built-in renderer is intentionally minimal — covers the standard "stats + suites + tests + per-test context" view. Stick with marge if you need its specific features; switch to the fork when you want a lighter, themable report.

---

## Lint clean: TypeScript shims

The reporter packages (`mochawesome-merge`, `mochawesome-report-generator`, `mochawesome/addContext.js`, `wdio-mochawesome-reporter/src/htmlReport.js`) ship no `.d.ts` files. Add ambient declarations to a `globals.d.ts` in your project root:

```ts
// globals.d.ts
/// <reference types="wdio-pw-driver" />

declare module 'wdio-mochawesome-reporter/src/htmlReport.js' {
  export function generateHtml(results: unknown, options?: {
    reportTitle?: string
    reportPageTitle?: string
    brandText?: string
    theme?: Record<string, string>
  }): string
  export function transformMediaContexts(
    data: unknown,
    htmlDir: string,
    opts?: { dir?: string }
  ): unknown
}
```

Then add `globals.d.ts` to your tsconfig's `include`. Sample at `pw-demo/globals.d.ts`.
