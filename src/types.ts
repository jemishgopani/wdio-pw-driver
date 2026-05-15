import type { Browser as EngineBrowser, BrowserContext, Frame, Page, Locator } from 'playwright-core'
import type { Capabilities, Options } from '@wdio/types'
// Force-resolve the `webdriverio` module so the `declare module 'webdriverio'`
// augmentation at the bottom of this file finds something to merge into.
// Type-only import — no runtime cost, no actual binding pulled in.
import type {} from 'webdriverio'

/**
 * The WebDriver "element-id" key that wraps every element reference in W3C protocol.
 */
export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
export const SHADOW_ELEMENT_KEY = 'shadow-6066-11e4-a52e-4f735466cecf'

/**
 * Wrapping shape for an element reference returned by findElement / findElements.
 */
export interface ElementReference {
  [ELEMENT_KEY]: string
}

/**
 * Wrapping shape for a shadow-root reference returned by getElementShadowRoot.
 */
export interface ShadowRootReference {
  [SHADOW_ELEMENT_KEY]: string
}

/**
 * Capabilities accepted by the PW driver. Superset of standard WDIO capabilities.
 * PW-specific options live under the `wdio:pwOptions` namespace.
 */
export interface PWCapabilities extends WebdriverIO.Capabilities {
  'wdio:pwOptions'?: PWOptions
}

export interface PWOptions {
  /** Override Playwright launch headless mode. Defaults to false in dev, true in CI. */
  headless?: boolean
  /** Extra args passed to the underlying browser launcher. */
  args?: string[]
  /** Override the engine binary path. */
  executablePath?: string
  /** Slow every action down by N ms (mirrors Playwright's slowMo). */
  slowMo?: number
  /** Default timeout in ms for element actions. */
  timeout?: number

  /**
   * Playwright trace recording. When `trace: true`, the session calls
   * `context.tracing.start` immediately and `context.tracing.stop` (writing
   * a zip) on `deleteSession`. Open the zip with:
   *   npx playwright show-trace <path>
   * or upload to https://trace.playwright.dev/.
   */
  trace?: boolean
  /** Directory for auto-mode trace zips. Default: './traces'. */
  traceDir?: string
  /** Capture DOM snapshots before/after each action. Default: true. */
  traceSnapshots?: boolean
  /** Capture screenshots on each action. Default: true. */
  traceScreenshots?: boolean
  /** Embed source code links into the trace. Default: true. */
  traceSources?: boolean

  /**
   * Path to a Playwright `storageState` JSON file (cookies + localStorage)
   * loaded into the BrowserContext at session creation. Use with
   * `pwSaveStorage(path)` to seed login state once and reuse it across
   * sessions:
   *
   *   await loginOnce()
   *   await browser.pwSaveStorage('./auth.json')
   *   // next session config:
   *   capabilities: [{ 'wdio:pwOptions': { storageState: './auth.json' } }]
   */
  storageState?: string

  /**
   * Device emulation preset name (e.g. `"iPhone 13"`, `"Pixel 7"`,
   * `"iPad Mini"`). Resolved against Playwright's built-in `devices` registry
   * — sets viewport, userAgent, deviceScaleFactor, isMobile, hasTouch in one
   * shot. Use `import { devices } from 'playwright-core'; Object.keys(devices)`
   * to list the ~140 available presets.
   */
  device?: string

  /**
   * Page viewport size. Playwright's BrowserContext default is 1280×720 — this
   * lets callers override it (e.g. to 1920×1080 to match chromedriver
   * `--window-size=1920,1080`). If `goog:chromeOptions.args` contains
   * `--window-size=W,H` and no explicit viewport is set, the driver parses
   * those dimensions as a fallback so existing chromedriver configs port over.
   */
  viewport?: { width: number; height: number }

  /**
   * Start the BrowserContext in offline mode — every navigation and fetch
   * fails as if the network is down. Toggle later with
   * `browser.pwSetOffline(true|false)`. Useful for testing offline
   * fallbacks and service-worker cache hits.
   */
  offline?: boolean

  /**
   * Base URL for the BrowserContext. Relative URLs in `browser.url()` and
   * `page.goto()` are resolved against this. Mirrors `@playwright/test`'s
   * `use.baseURL` fixture: configure once, write `browser.url('/login')`
   * everywhere instead of repeating the host.
   */
  baseURL?: string

  /**
   * When true, Playwright's locators throw when a selector matches more than
   * one element. Catches "I clicked the *first* of three buttons because
   * css picked one arbitrarily" bugs early. Default false (Playwright default).
   */
  strictSelectors?: boolean

  /**
   * Service worker policy for the BrowserContext.
   *  - `"allow"` (default): registered service workers run normally.
   *  - `"block"`: registration silently fails — useful when SW caching is
   *               getting between your test and the latest deploy.
   */
  serviceWorkers?: 'allow' | 'block'

  /**
   * Record video of every page in the BrowserContext. Playwright writes a
   * `.webm` per page; the path is finalized after the page closes.
   * `pwGetVideo()` returns the active page's video path.
   *
   *   recordVideo: { dir: './videos', size: { width: 800, height: 600 } }
   */
  recordVideo?: {
    dir: string
    size?: { width: number; height: number }
  }

  /**
   * Record an HAR file capturing every request/response in the
   * BrowserContext. Useful for offline replay via `pwRouteFromHAR(path)`
   * in subsequent runs — record once on a real backend, replay against the
   * frozen captures in CI.
   *
   *   recordHar: { path: './har/run.har', mode: 'minimal' }
   */
  recordHar?: {
    path: string
    omitContent?: boolean
    content?: 'omit' | 'embed' | 'attach'
    mode?: 'full' | 'minimal'
    urlFilter?: string | RegExp
  }
}

/**
 * Internal session handle held by the driver per `sessionId`.
 */
export interface PWSession {
  sessionId: string
  capabilities: WebdriverIO.Capabilities
  requestedCapabilities: WebdriverIO.Capabilities
  browser: EngineBrowser
  context: BrowserContext
  /** The current "top-level browsing context" — the active page in WebDriver terms. */
  currentPage: Page
  /**
   * The "current browsing context" for find/execute/getPageSource — usually
   * a child Frame after switchToFrame, or null meaning use mainFrame. Reset
   * to null on every navigation since old Frame refs become invalid.
   */
  currentFrame: Frame | null
  /** All pages opened in this session, keyed by a synthesized window handle. */
  pages: Map<string, Page>
  /** Per-session element store mapping WebDriver element-ids to Playwright Locators. */
  elementStore: ElementStore
  /** Default action timeout in ms (for actions like click/fill). */
  defaultTimeout: number
  /**
   * Implicit-wait timeout in ms (used by find* commands). W3C default is 0,
   * but Playwright requires a positive number to attempt at least one DOM
   * read; we use 100ms as the practical "no wait" baseline. setTimeouts can
   * raise this for tests that depend on implicit waiting.
   */
  implicitTimeout: number
  /**
   * Active dialog state. Playwright requires a listener to handle dialogs;
   * we capture them here so acceptAlert/dismissAlert can act on them later.
   * `pendingText` is the value queued by sendAlertText for the next accept.
   * `pressed` tracks keys/buttons currently held by performActions so
   * releaseActions can lift them in a single call.
   */
  dialogs: DialogState
  inputState: InputState
  /**
   * BiDi event support. `subscriptions` is the set of W3C BiDi event names
   * the user has subscribed to via sessionSubscribe (e.g. 'log.entryAdded').
   * `emitter` is the WDIO Client object — set after monad construction —
   * that the event pw calls .emit() on. Null until ready.
   */
  bidi: BidiState
  /**
   * Tracing state. `active` flips when start() succeeds; `autoStop` is true
   * for capability-driven sessions so deleteSession knows to dump the zip.
   * Explicit `pwStartTrace` calls leave autoStop=false — the user must
   * call `pwStopTrace(path)` themselves.
   */
  tracing: TracingState
}

export interface TracingState {
  active: boolean
  autoStop: boolean
  /** Resolved output path for the auto-stop case. */
  autoPath?: string
}

export interface BidiState {
  subscriptions: Set<string>
  emitter: { emit: (event: string, ...args: unknown[]) => boolean } | null
}

export interface DialogState {
  /**
   * Snapshot of the most recent dialog. Captured from the dialog event then
   * the dialog is *immediately* accepted/dismissed (per `nextAction`) so the
   * page never blocks. acceptAlert/dismissAlert/getAlertText/sendAlertText
   * read or update this snapshot — they don't talk to a live Dialog object.
   *
   * Trade-off: confirm()/prompt() return values are decided by the listener
   * before the user's acceptAlert/dismissAlert runs. Tests that need to
   * dismiss (return false from confirm) must call dismissAlert BEFORE
   * triggering the dialog. Documented limitation; cleaner alternatives all
   * require either patched Playwright or breaking W3C reactive semantics.
   */
  pending: DialogSnapshot | null
  /** What to do when the next dialog event fires. Reset after each dialog. */
  nextAction: 'accept' | 'dismiss'
  /** Text to send when the next prompt is accepted. Reset after each dialog. */
  pendingText: string | undefined
}

export interface DialogSnapshot {
  type: 'alert' | 'beforeunload' | 'confirm' | 'prompt'
  message: string
  defaultValue: string
}

export interface InputState {
  /** Currently held mouse buttons (0=left, 1=middle, 2=right). */
  buttonsDown: Set<number>
  /** Currently held keyboard keys (Playwright key strings). */
  keysDown: Set<string>
  /** Last known pointer position; used to anchor relative pointerMove. */
  pointerX: number
  pointerY: number
}

export interface ElementStore {
  register(loc: Locator): string
  get(id: string): Locator | undefined
  has(id: string): boolean
  clear(): void
  size(): number
  /**
   * Shadow roots are stored in a parallel namespace because W3C wraps them
   * in a different key (`shadow-6066-...`). Keeping them distinct from
   * regular elements lets the dispatch layer pick the right scope without
   * extra type tagging.
   */
  registerShadowRoot(loc: Locator): string
  getShadowRoot(id: string): Locator | undefined
}

/**
 * Public options for `remote()` — passthrough to WDIO Capabilities.RemoteConfig
 * with a PW-specific subset.
 */
export type RemoteOptions = Omit<Capabilities.RemoteConfig, 'capabilities'> & {
  capabilities: PWCapabilities
}

/**
 * Shape returned by PW's `remote()` — matches the WebdriverIO browser object.
 */
export type PWBrowser = WebdriverIO.Browser

/**
 * Reference to all per-session state passed into command handlers.
 */
export interface CommandContext {
  session: PWSession
}

export type AnyOptions = Options.WebDriver

/* -------------------------------------------------------------------------- */
/* Ambient augmentation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Extend WebdriverIO's Capabilities so users can add PW options without
 * casting. Pulled in automatically when the package is imported anywhere
 * the user's tsconfig sees these types — usually because tests import from
 * `wdio-pw-driver` already, or because @wdio/types resolves through us.
 *
 * Before this augmentation:
 *   capabilities: [{
 *     browserName: 'chromium',
 *     ...({ 'wdio:pwOptions': { headless: true } } as Record<string, unknown>),
 *   }]
 *
 * After:
 *   capabilities: [{
 *     browserName: 'chromium',
 *     'wdio:pwOptions': { headless: true },
 *   }]
 */
/**
 * Shared signatures for the PW extension commands. We have to apply the
 * same set to two interfaces — the global `WebdriverIO.Browser` (used by
 * `@wdio/globals`) and the module-level `webdriverio.Browser` (used when
 * a user does `import { remote, type Browser } from 'webdriverio'`). Both
 * exist as separate empty-shaped interfaces in WDIO's types and don't
 * extend each other, so augmentation has to hit both for `browser.pwX()`
 * calls to type-check in either spec or `webdriverio.remote()` setups.
 */
export interface PWExtensionCommands {
  // Tracing
  pwStartTrace(opts?: {
    snapshots?: boolean
    screenshots?: boolean
    sources?: boolean
  }): Promise<null>
  pwStopTrace(path?: string): Promise<string | null>

  // Storage state
  pwSaveStorage(path: string): Promise<string>
  pwLoadStorage(): Promise<unknown>

  // Context lifecycle + device switching
  pwNewContext(overrides?: Partial<PWOptions> | Record<string, unknown>): Promise<null>
  pwSwitchDevice(name: string | null): Promise<null>
  pwListDevices(): Promise<Record<string, {
    userAgent: string
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    isMobile: boolean
    hasTouch: boolean
    defaultBrowserType: 'chromium' | 'firefox' | 'webkit'
  }>>

  // Network mocking
  pwRoute(pattern: string, response: unknown): Promise<null>
  pwUnroute(pattern: string): Promise<null>
  pwRouteFromHAR(path: string, opts?: {
    notFound?: 'abort' | 'fallback'
    update?: boolean
    url?: string
  }): Promise<null>

  // Permissions / geolocation / headers / offline
  pwGrantPermissions(perms: string[] | { permissions: string[]; origin?: string }): Promise<null>
  pwClearPermissions(): Promise<null>
  pwSetGeolocation(geo: { latitude: number; longitude: number; accuracy?: number } | null): Promise<null>
  pwSetExtraHeaders(headers: Record<string, string>): Promise<null>
  pwSetOffline(flag: boolean): Promise<null>

  // Video
  pwGetVideo(): Promise<{ path: string | null }>
  pwSaveVideo(path: string): Promise<{ path: string | null }>

  // Network event waiters
  pwWaitForRequest(
    pattern:
      | string
      | { url?: string; regex?: { source: string; flags?: string }; timeout?: number },
  ): Promise<{
    url: string
    method: string
    resourceType: string
    headers: Record<string, string>
    postData: string | null
  }>
  pwWaitForResponse(
    pattern:
      | string
      | { url?: string; regex?: { source: string; flags?: string }; timeout?: number },
  ): Promise<{
    url: string
    status: number
    statusText: string
    headers: Record<string, string>
    request: {
      url: string
      method: string
      resourceType: string
      headers: Record<string, string>
      postData: string | null
    }
  }>

  // File chooser
  pwOnFileChooser(filesOrCancel: string[] | null): Promise<null>

  // Accessibility snapshot
  pwAriaSnapshot(opts?: {
    elementId?: string
    element?: { [k: string]: string }
    depth?: number
  }): Promise<string>
}

declare global {
  namespace WebdriverIO {
    interface Capabilities {
      'wdio:pwOptions'?: PWOptions
    }

    /**
     * PW extension commands on `@wdio/globals`'s `browser` (which is typed
     * `WebdriverIO.Browser`). After this augmentation:
     *
     *   await browser.pwSwitchDevice('iPhone 13')   // typed, no cast
     *
     * Users who want this in their own tsconfig need:
     *   "types": [..., "wdio-pw-driver"]
     *
     * Otherwise spec files that don't `import` from wdio-pw-driver won't
     * trigger augmentation loading.
     */
    interface Browser extends PWExtensionCommands {}
  }
}

/**
 * Same augmentation against the module-level Browser exported by the
 * `webdriverio` package. Tests that do `import { remote, type Browser }
 * from 'webdriverio'` get our methods on that Browser too — without this,
 * specs work but raw-WDIO setups fail to type-check.
 */
declare module 'webdriverio' {
  interface Browser extends PWExtensionCommands {}
}
