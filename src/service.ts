/**
 * PWService — the WDIO launcher service that auto-resolves Playwright's
 * browser-binary path and injects it into each capability set before
 * WDIO's own launcher tries to download its own Chromium.
 *
 *   import PWService from 'wdio-pw-driver'
 *
 *   services: [[PWService, {}]]
 *
 * Per-test trace + context rotation (the "isolation" feature) lives in
 * a separate spec-level helper at `wdio-pw-driver` → `installPerTestHooks`
 * — see that module for usage. WDIO 9 doesn't expose `beforeTest` /
 * `afterTest` as service hooks (those are Mocha-framework hooks
 * configured at the top-level config OR via Mocha's own `beforeEach` /
 * `afterEach`), so isolation can't be a service concern; it has to be
 * either inline in `wdio.conf.ts` or installed by the spec itself.
 */
import { resolveEngine } from './capabilities.js'
import { log } from './logger.js'
import type { PWOptions } from './types.js'

export interface PWServiceOptions {
  /**
   * If true, the service silently skips capabilities whose browserName
   * isn't one PW supports. If false (default), unsupported names raise
   * an error during onPrepare so misconfigured runs fail fast.
   */
  ignoreUnsupportedBrowsers?: boolean
}

type CapsRecord = Record<string, unknown> & {
  browserName?: string
  'goog:chromeOptions'?: { binary?: string; args?: string[] }
  'moz:firefoxOptions'?: { binary?: string; args?: string[] }
  'wdio:pwOptions'?: PWOptions
}

/**
 * Minimal duck-typed interface for the WDIO browser inside `before()`.
 * We don't import the WDIO types here so the service stays usable in
 * mixed setups (e.g. monorepos that pin a different @wdio/types).
 */
interface BrowserWithOverwrite {
  overwriteCommand(
    name: string,
    fn: (this: BrowserContextThis, origFn: (...a: unknown[]) => unknown, ...args: unknown[]) => unknown,
    attachToElement?: boolean,
  ): void
  pwClickElement?: (elementId: string, opts: unknown) => Promise<unknown>
  pwWaitElementFor?: (elementId: string, opts: unknown) => Promise<unknown>
  options?: { waitforTimeout?: number; capabilities?: CapsRecord }
  capabilities?: CapsRecord
}

interface BrowserContextThis {
  elementId?: string
  selector?: string
  options?: { waitforTimeout?: number }
}

interface WdioWaitForOpts {
  timeout?: number
  reverse?: boolean
  timeoutMsg?: string
  interval?: number
}

export default class PWService {
  private readonly options: PWServiceOptions

  constructor(options: PWServiceOptions = {}) {
    this.options = options
  }

  /**
   * Launcher hook fired once before any worker is spawned. Mutates the
   * capabilities array in place — that's the convention WDIO services
   * have followed since v5; returning a new array doesn't propagate.
   */
  async onPrepare(
    _config: unknown,
    capabilities: CapsRecord | CapsRecord[] | Record<string, { capabilities: CapsRecord }>,
  ): Promise<void> {
    const targets = collectCapabilitySets(capabilities)
    if (!targets.length) return

    let pw: typeof import('playwright-core')
    try {
      pw = await import('playwright-core')
    } catch (err) {
      throw new Error(
        'PWService: requires "playwright-core" as a peer dependency. ' +
        'Install with: npm install playwright-core && npx wdioPW install\n' +
        `Original error: ${(err as Error).message}`,
      )
    }

    for (const caps of targets) {
      let engine: 'chromium' | 'firefox' | 'webkit'
      try {
        engine = resolveEngine(caps.browserName)
      } catch (err) {
        if (this.options.ignoreUnsupportedBrowsers) continue
        throw err instanceof Error ? err : new Error(String(err))
      }

      const existing = readExistingBinary(caps, engine)
      if (existing) {
        log.info(`PWService: skipping ${engine} — caller already set binary at ${existing}`)
        continue
      }

      const binary = pw[engine].executablePath()
      writeBinary(caps, engine, binary)
      log.info(`PWService: ${engine} binary → ${binary}`)
    }
  }

  /**
   * Per-worker hook fired AFTER the browser session is created. Uses
   * WDIO's `overwriteCommand` to swap the implementation of a handful
   * of high-level commands so they route through Playwright's native
   * actionability primitives instead of WDIO's protocol-roundtrip
   * polling.
   *
   * Currently overrides:
   *
   *   - `click`           → routes to `pwClickElement` so options like
   *                         `{ force, trial, position, timeout, button,
   *                         modifiers, clickCount, delay, noWaitAfter }`
   *                         pass through directly.
   *   - `waitForExist`    → routes to `pwWaitElementFor` with
   *                         state=`attached`/`detached` so the wait
   *                         polls inside the page instead of via HTTP.
   *   - `waitForDisplayed`→ same but state=`visible`/`hidden`. Uses
   *                         Playwright's stricter visibility check
   *                         (handles `content-visibility`,
   *                         `aria-hidden`, etc.).
   *
   * Escape hatch: set `wdio:pwOptions.strictActionability: false` in
   * capabilities to skip the override and use WDIO's native behavior.
   * Use this if a test relied on chromedriver's looser actionability
   * check (e.g., clicking through an `aria-disabled` element).
   *
   * Both `click` and the waitFor commands fall back to the original
   * implementation when `this.elementId` is unset — i.e., when the
   * chainable hasn't yet resolved the selector. This means
   * `await $('#x').waitForExist()` for an element that doesn't exist
   * yet still goes through WDIO's poll-and-retry path (which calls our
   * `findElement` repeatedly), because we can't wait on a Playwright
   * locator we don't yet have. Once the element resolves, subsequent
   * commands in the chain use the fast path.
   */
  async before(
    capabilities: CapsRecord,
    _specs: string[],
    browser: BrowserWithOverwrite,
  ): Promise<void> {
    const pwOptions = (capabilities['wdio:pwOptions'] ?? {}) as PWOptions
    if (pwOptions.strictActionability === false) {
      log.info('PWService: strictActionability=false — skipping command overrides')
      return
    }

    // click(opts) → pwClickElement(elementId, opts)
    browser.overwriteCommand(
      'click',
      async function pwClickOverride(this: BrowserContextThis, origClick, ...args: unknown[]) {
        if (!this.elementId) {
          return (origClick as (...a: unknown[]) => unknown).apply(this, args)
        }
        return browser.pwClickElement!(this.elementId, args[0] ?? {})
      },
      true,
    )

    // waitForExist({reverse, timeout, timeoutMsg}) → state attached/detached
    browser.overwriteCommand(
      'waitForExist',
      async function pwWaitForExistOverride(this: BrowserContextThis, origFn, ...args: unknown[]) {
        const opts = (args[0] ?? {}) as WdioWaitForOpts
        if (!this.elementId) {
          return (origFn as (...a: unknown[]) => unknown).apply(this, args)
        }
        return runPwWait(browser, this, opts, opts.reverse ? 'detached' : 'attached', origFn, args)
      },
      true,
    )

    // waitForDisplayed({reverse, timeout, timeoutMsg}) → state visible/hidden
    browser.overwriteCommand(
      'waitForDisplayed',
      async function pwWaitForDisplayedOverride(this: BrowserContextThis, origFn, ...args: unknown[]) {
        const opts = (args[0] ?? {}) as WdioWaitForOpts
        if (!this.elementId) {
          return (origFn as (...a: unknown[]) => unknown).apply(this, args)
        }
        return runPwWait(browser, this, opts, opts.reverse ? 'hidden' : 'visible', origFn, args)
      },
      true,
    )
  }
}

/**
 * Shared wait body — calls pwWaitElementFor, returns true on success,
 * translates timeouts via the user's optional `timeoutMsg` for parity
 * with WDIO's wait commands.
 */
async function runPwWait(
  browser: BrowserWithOverwrite,
  ctx: BrowserContextThis,
  opts: WdioWaitForOpts,
  state: 'attached' | 'detached' | 'visible' | 'hidden',
  origFn: unknown,
  origArgs: unknown[],
): Promise<boolean> {
  const timeout = typeof opts.timeout === 'number'
    ? opts.timeout
    : (browser.options?.waitforTimeout ?? ctx.options?.waitforTimeout ?? 5000)
  try {
    await browser.pwWaitElementFor!(ctx.elementId!, { state, timeout })
    return true
  } catch (err) {
    // If user gave a custom timeoutMsg, honor it. Otherwise fall through
    // to the original implementation, which may produce its own error
    // shape that downstream test reporters recognize.
    if (opts.timeoutMsg && (err as { name?: string })?.name === 'no such element') {
      throw new Error(opts.timeoutMsg)
    }
    if ((err as { name?: string })?.name === 'no such element') {
      // Re-invoke the original (will throw WDIO's standard wait timeout
      // error) so error messages stay familiar.
      return (origFn as (...a: unknown[]) => Promise<boolean>).apply(ctx, origArgs)
    }
    throw err
  }
}

/* -------------------------------------------------------------------------- */
/* internal helpers                                                            */
/* -------------------------------------------------------------------------- */

function collectCapabilitySets(
  capabilities: CapsRecord | CapsRecord[] | Record<string, { capabilities: CapsRecord }> | unknown,
): CapsRecord[] {
  if (!capabilities || typeof capabilities !== 'object') return []
  if (Array.isArray(capabilities)) {
    return capabilities.map((c) => c as CapsRecord)
  }
  const values = Object.values(capabilities as Record<string, unknown>)
  const looksLikeMultiremote = values.some(
    (v) => v && typeof v === 'object' && 'capabilities' in (v as object),
  )
  if (looksLikeMultiremote) {
    return values
      .map((v) => {
        if (v && typeof v === 'object' && 'capabilities' in (v as object)) {
          return (v as { capabilities: CapsRecord }).capabilities
        }
        return v as CapsRecord
      })
      .filter((c): c is CapsRecord => Boolean(c) && typeof c === 'object')
  }
  return [capabilities as CapsRecord]
}

function readExistingBinary(caps: CapsRecord, engine: 'chromium' | 'firefox' | 'webkit'): string | undefined {
  if (caps['wdio:pwOptions']?.executablePath) return caps['wdio:pwOptions'].executablePath
  if (engine === 'chromium' && caps['goog:chromeOptions']?.binary) return caps['goog:chromeOptions'].binary
  if (engine === 'firefox' && caps['moz:firefoxOptions']?.binary) return caps['moz:firefoxOptions'].binary
  return undefined
}

function writeBinary(caps: CapsRecord, engine: 'chromium' | 'firefox' | 'webkit', binary: string): void {
  caps['wdio:pwOptions'] = { ...(caps['wdio:pwOptions'] ?? {}), executablePath: binary }
  if (engine === 'chromium') {
    caps['goog:chromeOptions'] = { ...(caps['goog:chromeOptions'] ?? {}), binary }
  } else if (engine === 'firefox') {
    caps['moz:firefoxOptions'] = { ...(caps['moz:firefoxOptions'] ?? {}), binary }
  }
}
