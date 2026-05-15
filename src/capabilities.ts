import { devices } from 'playwright-core'
import type { LaunchOptions, BrowserContextOptions } from 'playwright-core'
import type { PWCapabilities, PWOptions } from './types.js'

/**
 * Resolve which Playwright engine to use for a given WDIO browserName.
 * v0.1 supports Chromium only; Firefox/WebKit are placeholders for Phase 6.
 */
export type Engine = 'chromium' | 'firefox' | 'webkit'

export function resolveEngine(browserName?: string): Engine {
  switch ((browserName ?? '').toLowerCase()) {
    case '':
    case 'chrome':
    case 'chromium':
    case 'edge':
    case 'msedge':
      return 'chromium'
    case 'firefox':
      return 'firefox'
    case 'safari':
    case 'webkit':
      return 'webkit'
    default:
      throw new Error(`PW driver: unsupported browserName "${browserName}"`)
  }
}

/**
 * Translate WDIO capabilities into Playwright launch options.
 *
 * Capability shapes that aren't part of the standard `WebdriverIO.Capabilities`
 * interface (e.g. vendor extensions like `goog:chromeOptions`) are accessed via
 * index lookup so this module stays decoupled from any one type version.
 */
export function toLaunchOptions(caps: PWCapabilities): LaunchOptions {
  const pw: PWOptions = caps['wdio:pwOptions'] ?? {}
  const chromeOpts =
    (caps as Record<string, unknown>)['goog:chromeOptions'] as
      | { args?: string[]; binary?: string }
      | undefined

  const args = [...(pw.args ?? []), ...(chromeOpts?.args ?? [])]

  return {
    headless: pw.headless ?? !process.env.PW_HEADED,
    args,
    executablePath: pw.executablePath ?? chromeOpts?.binary,
    slowMo: pw.slowMo,
    proxy: extractProxy(caps),
  }
}

function extractProxy(caps: PWCapabilities): LaunchOptions['proxy'] {
  const proxy = (caps as Record<string, unknown>).proxy as
    | { httpProxy?: string; sslProxy?: string; noProxy?: string[] }
    | undefined
  const server = proxy?.httpProxy ?? proxy?.sslProxy
  if (!server) return undefined
  return {
    server,
    bypass: proxy?.noProxy?.join(','),
  }
}

/**
 * Translate WDIO capabilities into Playwright browser context options.
 * Context options control viewport, user agent, locale, timezone, etc.
 *
 * Resolution order matters: device preset first (sets defaults for viewport
 * / userAgent / hasTouch), then explicit caps override individual fields.
 * That mirrors `@playwright/test`'s precedence so a user can pick a device
 * profile and selectively override one field without losing the rest.
 */
export function toContextOptions(caps: PWCapabilities): BrowserContextOptions {
  const opts: BrowserContextOptions = {}
  const pw = caps['wdio:pwOptions']

  // 1. Device preset — looked up lazily so we don't import playwright-core's
  //    devices registry just to launch a non-mobile session.
  if (pw?.device) {
    const preset = resolveDevice(pw.device)
    Object.assign(opts, preset)
  }

  if ((caps as Record<string, unknown>).acceptInsecureCerts) {
    opts.ignoreHTTPSErrors = true
  }

  // 2. Honor goog:chromeOptions.mobileEmulation.deviceMetrics if present.
  //    Other viewport sources are handled later via setWindowRect.
  const mobileMetrics = (
    (caps as Record<string, unknown>)['goog:chromeOptions'] as
      | { mobileEmulation?: { deviceMetrics?: { width?: number; height?: number } } }
      | undefined
  )?.mobileEmulation?.deviceMetrics

  if (mobileMetrics?.width && mobileMetrics?.height) {
    opts.viewport = { width: mobileMetrics.width, height: mobileMetrics.height }
  }

  // 2a. Explicit viewport in wdio:pwOptions wins over device preset / mobile
  //     emulation. This is the main way to match chromedriver's 1920×1080
  //     window without setting up a device preset.
  if (pw?.viewport?.width && pw?.viewport?.height) {
    opts.viewport = { width: pw.viewport.width, height: pw.viewport.height }
  }

  // 2b. Fallback: if no viewport has been set yet, parse --window-size=W,H
  //     from goog:chromeOptions.args. Lets existing chromedriver configs
  //     port over without editing capabilities.
  if (!opts.viewport) {
    const chromeArgs = (
      (caps as Record<string, unknown>)['goog:chromeOptions'] as
        | { args?: string[] }
        | undefined
    )?.args
    const sizeArg = chromeArgs?.find((a) => a.startsWith('--window-size='))
    if (sizeArg) {
      const m = sizeArg.match(/^--window-size=(\d+)\s*,\s*(\d+)$/)
      if (m) {
        opts.viewport = { width: Number(m[1]), height: Number(m[2]) }
      }
    }
  }

  // 3. Restore previously-saved cookies + localStorage. Playwright accepts
  //    either an absolute file path string or a parsed StorageState object.
  //    We pass the string so Playwright reads + parses, matching the public
  //    file-path API users see in `pwSaveStorage(path)`.
  if (pw?.storageState) {
    opts.storageState = pw.storageState
  }

  // 4. Tier D capability passthroughs. Each is a direct mapping to a
  //    BrowserContextOptions field — Playwright is the source of truth on
  //    behavior. We pass undefined-on-undefined so users who don't set a
  //    field get Playwright defaults rather than explicit nulls.
  if (pw?.offline !== undefined) opts.offline = pw.offline
  if (pw?.baseURL !== undefined) opts.baseURL = pw.baseURL
  if (pw?.strictSelectors !== undefined) opts.strictSelectors = pw.strictSelectors
  if (pw?.serviceWorkers !== undefined) opts.serviceWorkers = pw.serviceWorkers
  if (pw?.recordVideo !== undefined) opts.recordVideo = pw.recordVideo
  if (pw?.recordHar !== undefined) opts.recordHar = pw.recordHar

  return opts
}

/**
 * Look up a device descriptor by name (case-sensitive, matching Playwright).
 * Throws a clear error if the name isn't in the registry — silent typos are
 * worse than fast failures when emulating the wrong hardware skews layout.
 */
function resolveDevice(name: string): Partial<BrowserContextOptions> {
  // `devices` is a static import at the top — it's just a JSON object, not
  // a heavy module. Bundlers mark playwright-core external (peer dep) so
  // the imported binding resolves at runtime against the user's installed
  // copy. We previously used a synchronous `require()` here but that broke
  // when the published ESM bundle ran in a real WDIO worker (`Dynamic
  // require of "playwright-core" is not supported`); the static import
  // works identically in both ESM and CJS outputs.
  const registry = devices as unknown as Record<string, Partial<BrowserContextOptions>>
  const preset = registry[name]
  if (!preset) {
    const close = Object.keys(registry)
      .filter((k) => k.toLowerCase().includes(name.toLowerCase().slice(0, 4)))
      .slice(0, 5)
    const hint = close.length ? ` Did you mean: ${close.map((c) => JSON.stringify(c)).join(', ')}?` : ''
    throw new Error(
      `PW: unknown device preset "${name}". ` +
      `See \`Object.keys(require('playwright-core').devices)\` for the full list.${hint}`,
    )
  }
  return preset
}

/**
 * The capabilities object PW reports back after a session is created.
 * Mirrors the shape a real WebDriver server would return in the new-session
 * response so WDIO's `sessionEnvironmentDetector` recognizes the session.
 */
export function buildResponseCapabilities(
  requested: PWCapabilities,
  engine: Engine,
  browserVersion: string,
): PWCapabilities {
  return {
    ...requested,
    browserName: engine,
    browserVersion,
    platformName: process.platform,
    'wdio:enforceWebDriverClassic': true,
  } as PWCapabilities
}

export const DEFAULT_TIMEOUT_MS = 30_000
/**
 * Default implicit-wait for find* commands.
 *
 * W3C strict default is 0, and chromedriver / geckodriver / safaridriver all
 * ship this default. We can't pass 0 through to Playwright (which interprets
 * timeout=0 as "wait forever"), so we use a small positive value as the
 * effective floor.
 *
 * Why this matters: a larger implicit wait silently collapses fine-grained
 * polling done by helpers like `waitForDisplayed` (default 500 ms interval)
 * into one find per implicit period. With the previous 5000 ms default, a
 * 15 s `waitForDisplayed` only got 3–4 polls — enough to miss brief UI
 * states such as Material snackbars (~4 s lifetime) entirely.
 *
 * Tests that genuinely need an implicit wait should set it explicitly via
 * `browser.setTimeouts({ implicit: <ms> })` or `wdio:pwOptions.timeout`.
 */
export const DEFAULT_IMPLICIT_TIMEOUT_MS = 100
