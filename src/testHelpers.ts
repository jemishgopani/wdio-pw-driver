/**
 * Spec-level helpers — installed via Mocha's `beforeEach` / `afterEach`
 * so each spec file can opt into per-test trace + context rotation
 * WITHOUT touching `wdio.conf.ts`.
 *
 *   import { installPerTestHooks } from 'wdio-pw-driver'
 *
 *   describe('my isolated suite', () => {
 *     installPerTestHooks({ mode: 'per-test-isolated' })
 *
 *     it('starts fresh, has its own trace + video', async () => {
 *       await browser.url('https://example.com')
 *       // ...
 *     })
 *   })
 *
 * WDIO's service surface doesn't expose `beforeTest` / `afterTest` —
 * those are Mocha framework hooks. So the only places to wire per-test
 * isolation are (a) inline in the wdio.conf.ts top-level config or (b)
 * inside the spec via Mocha's `beforeEach` / `afterEach`. This helper
 * is the (b) path: zero config-file changes, per-spec granularity.
 *
 * Modes:
 *   - `'per-test-trace'`    — start trace at beforeEach, save+stop at
 *                             afterEach to <traceDir>/<safeName>.zip.
 *                             Page + login state persist between tests.
 *   - `'per-test-isolated'` — same as `per-test-trace` PLUS a
 *                             `pwNewContext()` after each test, so each
 *                             test gets a fresh BrowserContext (cookies
 *                             / login / routes reset). Each test gets
 *                             its own video file too.
 *
 * Metric emission: by default emits `Trace zip` + `Duration` context
 * entries to wdio-mochawesome-reporter. Pass `emitMetrics: false` to
 * opt out, or pass an `extraContext` callback for more.
 */

export type PWHooksMode = 'per-test-trace' | 'per-test-isolated'

export interface InstallPerTestHooksOptions {
  mode: PWHooksMode
  /** Where to write per-test trace zips. Defaults to './traces'. */
  traceDir?: string
  /** Emit Trace zip + Duration to mochawesome (default: true). */
  emitMetrics?: boolean
  /**
   * Optional callback fired in afterEach after trace stop. Receives the
   * Mocha test, the duration in ms, and the resolved tracePath. Use to
   * attach extra per-test context entries (Browser engine, Video path,
   * any custom data) without writing your own afterEach.
   */
  extraContext?: (
    test: { fullTitle?: () => string; title?: string },
    durationMs: number,
    extras: { tracePath: string; mode: PWHooksMode },
  ) => unknown | Promise<unknown>
}

interface PWBrowser {
  pwStartTrace?: (opts?: unknown) => Promise<unknown>
  pwStopTrace?: (path?: string) => Promise<unknown>
  pwNewContext?: (overrides?: unknown) => Promise<unknown>
}

// Mocha's beforeEach / afterEach are global functions inside any describe.
// Declare them so the helper file type-checks even when the consumer
// hasn't separately pulled in @types/mocha.
declare const beforeEach: (fn: () => unknown | Promise<unknown>) => void
declare const afterEach: (fn: (this: { currentTest?: unknown }) => unknown | Promise<unknown>) => void

/**
 * Install Mocha beforeEach + afterEach inside the current describe so
 * every test in the block runs the trace lifecycle (and optionally
 * context rotation). MUST be called inside a `describe` block.
 */
export function installPerTestHooks(options: InstallPerTestHooksOptions): void {
  const traceDir = options.traceDir ?? './traces'
  const emitMetrics = options.emitMetrics ?? true

  beforeEach(async function () {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (globalThis as any).browser as PWBrowser | undefined
      await b?.pwStartTrace?.()
    } catch { /* never let a hook failure mask a test */ }
  })

  afterEach(async function () {
    // Mocha test object lives on `this.currentTest`. Use it to compute
    // the per-test trace zip filename.
    const test = (this as { currentTest?: { title?: string; fullTitle?: () => string; duration?: number } }).currentTest
    const titleStr = (test?.fullTitle?.() ?? test?.title ?? 'unnamed')
    const safeName = titleStr.replace(/[^a-z0-9-]+/gi, '_').slice(0, 120)
    const tracePath = `${traceDir}/${safeName}.zip`
    const durationMs = test?.duration ?? 0

    // 1. Stop trace.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (globalThis as any).browser as PWBrowser | undefined
      await b?.pwStopTrace?.(tracePath)
    } catch { /* swallow */ }

    // 2. Emit basic metrics to mochawesome.
    if (emitMetrics) {
      try {
        ;(process as unknown as { emit: (e: string, p: unknown) => void }).emit(
          'wdio-mochawesome-reporter:addContext',
          { title: 'Trace zip', value: tracePath },
        )
        ;(process as unknown as { emit: (e: string, p: unknown) => void }).emit(
          'wdio-mochawesome-reporter:addContext',
          { title: 'Duration', value: `${durationMs} ms` },
        )
      } catch { /* swallow */ }
    }

    // 3. Caller's extra-context callback.
    if (options.extraContext && test) {
      try {
        await options.extraContext(test, durationMs, { tracePath, mode: options.mode })
      } catch { /* swallow */ }
    }

    // 4. Context rotation only in per-test-isolated mode.
    if (options.mode === 'per-test-isolated') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (globalThis as any).browser as PWBrowser | undefined
        await b?.pwNewContext?.()
      } catch { /* swallow */ }
    }
  })
}
