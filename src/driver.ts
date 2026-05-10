import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { Browser as EngineBrowser, BrowserContext, Page } from 'playwright-core'

import {
  buildResponseCapabilities,
  DEFAULT_IMPLICIT_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  resolveEngine,
  toContextOptions,
  toLaunchOptions,
  type Engine,
} from './capabilities.js'
import { DefaultElementStore } from './elementStore.js'
import {
  buildBidiPrototype,
  buildEnvironmentPrototype,
  buildExtensionsPrototype,
  buildProtocolPrototype,
  registerSession,
  webdriverMonad,
} from './client.js'
import { registry } from './commands/index.js'
import { attachContextListeners } from './listeners.js'
import { log } from './logger.js'
import type {
  PWCapabilities,
  PWSession,
  RemoteOptions,
} from './types.js'

/**
 * The PW driver — a drop-in replacement for the standard `webdriver`
 * package's `WebDriver` class, but powered by a native automation engine
 * instead of W3C HTTP.
 *
 * Public surface mirrors WebDriver.newSession / attachToSession exactly so
 * a host that knows how to construct one can construct the other.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Modifier = (...args: any[]) => any

export default class PWDriver {
  /**
   * Launch a fresh browser session. Returns a WDIO-compatible client object
   * with all WebDriver protocol commands attached as methods.
   */
  static async newSession(
    options: RemoteOptions,
    modifier?: Modifier,
    userPrototype: PropertyDescriptorMap = {},
    customCommandWrapper?: Modifier,
    implicitWaitExclusionList: string[] = [],
  ): Promise<unknown> {
    const requested: PWCapabilities = options.capabilities
    const engine = resolveEngine(requested.browserName)
    log.info(`launching ${engine} via PW`)

    const { browser, context, page, version } = await launchEngine(engine, requested)

    const sessionId = randomUUID()
    const responseCaps = buildResponseCapabilities(requested, engine, version)
    const elementStore = new DefaultElementStore()
    const pages = new Map<string, Page>()
    pages.set('page-1', page)

    const session: PWSession = {
      sessionId,
      capabilities: responseCaps,
      requestedCapabilities: requested,
      browser,
      context,
      currentPage: page,
      currentFrame: null,
      pages,
      elementStore,
      defaultTimeout: DEFAULT_TIMEOUT_MS,
      implicitTimeout: DEFAULT_IMPLICIT_TIMEOUT_MS,
      dialogs: { pending: null, nextAction: 'accept', pendingText: undefined },
      inputState: {
        buttonsDown: new Set(),
        keysDown: new Set(),
        pointerX: 0,
        pointerY: 0,
      },
      bidi: { subscriptions: new Set(), emitter: null },
      tracing: { active: false, autoStop: false },
    }
    context.setDefaultTimeout(DEFAULT_TIMEOUT_MS)
    attachContextListeners(session, context)
    await maybeStartAutoTrace(session, requested)
    registerSession(session)

    // Note: the "context closed → browser.close()" safety hook is registered
    // by `attachContextListeners` below alongside the dialog + BiDi listeners
    // so a rotation via pwNewContext picks it up automatically.

    // Build the prototype WDIO's monad expects: protocol commands first,
    // environment flags, BiDi commands, then any user-provided prototype
    // overrides on top.
    const bidiEnabled = wantsBidi(requested)
    const protocolPrototype = buildProtocolPrototype(registry)
    const envPrototype = buildEnvironmentPrototype(engine, bidiEnabled)
    const bidiPrototype = bidiEnabled ? buildBidiPrototype(registry) : {}
    // PW-specific extensions (tracing, etc.) are always available
    // regardless of BiDi gating — they don't ride the W3C BiDi protocol.
    const extensionsPrototype = buildExtensionsPrototype(registry)
    const propertiesObject: PropertyDescriptorMap = {
      ...protocolPrototype,
      ...envPrototype,
      ...bidiPrototype,
      ...extensionsPrototype,
      ...userPrototype,
    }

    const monad = webdriverMonad(
      { ...options, requestedCapabilities: requested },
      modifier,
      propertiesObject,
    )
    const client = monad(sessionId, customCommandWrapper, implicitWaitExclusionList)

    // Now that the client EventEmitter exists, route BiDi events through it.
    if (bidiEnabled) {
      session.bidi.emitter = client as { emit: (event: string, ...args: unknown[]) => boolean }
    }

    return client
  }

  /**
   * Attach to an existing session. PW sessions live in-process only, so
   * "attaching" means looking up the in-memory session by id and rebuilding
   * a client around it. Useful for `wdio repl` and watch-mode scenarios.
   */
  static attachToSession(
    options: { sessionId: string },
    modifier?: Modifier,
    userPrototype: PropertyDescriptorMap = {},
    commandWrapper?: Modifier,
  ): unknown {
    if (!options?.sessionId) {
      throw new Error('PW.attachToSession: sessionId is required')
    }
    // Note: in v0.1 we don't persist sessions across processes, so this only
    // works within the same Node instance that called newSession().
    const protocolPrototype = buildProtocolPrototype(registry)
    const envPrototype = buildEnvironmentPrototype('chromium', false)
    const monad = webdriverMonad(
      { capabilities: {} as PWCapabilities, requestedCapabilities: {} },
      modifier,
      { ...protocolPrototype, ...envPrototype, ...userPrototype },
    )
    return monad(options.sessionId, commandWrapper)
  }

  static async reloadSession(): Promise<string> {
    throw new Error('PW.reloadSession is not implemented in v0.1')
  }
}

/**
 * Attach a dialog listener to every page in the context (current + future).
 *
 * The listener takes a snapshot of the dialog (type, message, default value)
 * for `getAlertText` to read later, then *immediately* accepts or dismisses
 * the dialog so the page never blocks. Whether to accept or dismiss is
 * decided by `session.dialogs.nextAction` — set by dismissAlert when a test
 * wants the next dialog dismissed.
 *
 * Why this design:
 *   The W3C-reactive model (capture, leave the dialog open until acceptAlert
 *   runs) deadlocks Playwright across test boundaries: any executeScript
 *   issued while a dialog is "captured but unhandled" hangs because the page
 *   is frozen. Auto-handling in the listener keeps every command responsive
 *   at the cost of one corner: tests that need confirm() to return false
 *   must call `dismissAlert()` *before* triggering the dialog, not after.
 */
/**
 * BiDi is opt-in via explicit `webSocketUrl: true` in capabilities. Default
 * is *off* so the WDIO `ContextManager` (auto-installed when isBidi=true)
 * doesn't try to call BiDi commands like `browsingContextGetTree` that
 * PW hasn't implemented yet. Users who want `browser.on('log.entryAdded')`
 * etc. set `webSocketUrl: true` explicitly and accept that some WDIO
 * higher-level features may not work until Phase 7 expands BiDi coverage.
 */
function wantsBidi(caps: PWCapabilities): boolean {
  const c = caps as Record<string, unknown>
  if (c['wdio:enforceWebDriverClassic'] === true) return false
  return c.webSocketUrl === true
}

/**
 * Capability-driven auto-tracing (Option A in the trace plan). When the user
 * sets `wdio:pwOptions.trace: true`, we call `context.tracing.start`
 * during session creation and stash the resolved zip path on the session.
 * `commands/session.ts:deleteSession` reads `tracing.autoStop` and writes
 * the zip on tear-down. Defaults match Playwright's recommended starting
 * config: snapshots + screenshots + sources all on.
 */
async function maybeStartAutoTrace(session: PWSession, caps: PWCapabilities): Promise<void> {
  const opts = caps['wdio:pwOptions']
  if (!opts?.trace) return

  const dir = opts.traceDir ?? './traces'
  // Resolve relative to cwd at session start so the path is stable across
  // any later directory changes the user might do in their tests.
  const path = resolve(dir, `${session.sessionId}.zip`)
  await mkdir(dirname(path), { recursive: true }).catch(() => {})

  await session.context.tracing.start({
    name: `pw-${session.sessionId}`,
    snapshots: opts.traceSnapshots ?? true,
    screenshots: opts.traceScreenshots ?? true,
    sources: opts.traceSources ?? true,
  })

  session.tracing.active = true
  session.tracing.autoStop = true
  session.tracing.autoPath = path
  log.info(`tracing started — will write to ${path} on session close`)
}

// Listener wiring (dialog + BiDi events) lives in src/listeners.ts so
// commands/context.ts:pwNewContext can re-attach them after rotating
// the BrowserContext. Keeps this file focused on session lifecycle.

interface LaunchedEngine {
  browser: EngineBrowser
  context: BrowserContext
  page: Page
  version: string
}

/**
 * Lazy-import the engine modules so users only pay the cost of the engine
 * they actually use. Also keeps `playwright-core` a true peer dependency:
 * if the user hasn't installed it, the failure happens at launch with a
 * clear stack rather than at module load time.
 */
async function launchEngine(engine: Engine, caps: PWCapabilities): Promise<LaunchedEngine> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any
  try {
    mod = await import('playwright-core')
  } catch (err) {
    throw new Error(
      `PW driver requires "playwright-core" as a peer dependency. ` +
      `Install it with: npm install playwright-core && npx playwright install ${engine}\n` +
      `Original error: ${(err as Error).message}`,
    )
  }

  const launcher = mod[engine]
  if (!launcher) {
    throw new Error(`playwright-core has no "${engine}" launcher (incompatible version?)`)
  }

  const browser: EngineBrowser = await launcher.launch(toLaunchOptions(caps))
  const context = await browser.newContext(toContextOptions(caps))
  const page = await context.newPage()

  return {
    browser,
    context,
    page,
    version: browser.version(),
  }
}
