import { WebDriverProtocol } from '@wdio/protocols'
// `webdriverMonad` is the same factory the standard `webdriver` package uses
// to build the `browser` object. Reusing it gives us instant compatibility
// with WDIO's `addCommand`, `overwriteCommand`, event emitter, etc.
import { webdriverMonad } from '@wdio/utils'

import type { PWSession } from './types.js'
import type { CommandRegistry } from './command.js'
import { wrapCommand } from './command.js'
import { InvalidSessionIdError } from './errors.js'

/**
 * Module-level registry of live sessions, keyed by sessionId. The protocol
 * function bound onto each WDIO Client instance reaches in here at call time
 * to get its session — that lets us share one prototype across many sessions
 * without leaking state between them.
 */
const sessions = new Map<string, PWSession>()

export function registerSession(session: PWSession): void {
  sessions.set(session.sessionId, session)
}

export function unregisterSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function getSession(sessionId: string): PWSession | undefined {
  return sessions.get(sessionId)
}

/**
 * Build the prototype map for the WDIO monad. We walk every command in the
 * standard WebDriver protocol (the same source-of-truth WDIO itself uses) and
 * generate a function that:
 *
 *   1. resolves the PWSession from `this.sessionId`
 *   2. looks up our handler in the registry
 *   3. wraps it for error translation + logging
 *   4. calls it with `(ctx, ...args)`
 *
 * Commands without a registered handler still appear on the prototype but
 * throw NotImplementedError when invoked — this matches WDIO's expectation
 * that every protocol command exists, while making coverage gaps obvious.
 */
export function buildProtocolPrototype(registry: CommandRegistry): PropertyDescriptorMap {
  const prototype: PropertyDescriptorMap = {}

  for (const endpoint of Object.values(WebDriverProtocol)) {
    for (const commandData of Object.values(endpoint)) {
      const name = commandData.command
      const handler = registry[name]
      const wrapped = wrapCommand(name, handler)

      prototype[name] = {
        value: function pwProtocolFn(
          this: { sessionId: string },
          ...args: unknown[]
        ): Promise<unknown> {
          const session = sessions.get(this.sessionId)
          if (!session) {
            return Promise.reject(
              new InvalidSessionIdError(
                `Session "${this.sessionId}" is not active in the PW driver.`,
              ),
            )
          }
          return wrapped({ session }, ...args)
        },
        writable: true,
        configurable: true,
      }
    }
  }

  return prototype
}

/**
 * Build the environment-flag prototype that WDIO's monad expects on every
 * client (`isW3C`, `isChromium`, etc). PW always reports W3C-style and
 * the engine that was actually launched — there's no JSONWP fallback.
 *
 * `bidiEnabled` controls whether `isBidi` reports true. PW supports BiDi
 * events natively (no WebSocket needed) so this flag is on whenever the
 * caller hasn't explicitly opted out via `wdio:enforceWebDriverClassic`.
 */
export function buildEnvironmentPrototype(
  engine: 'chromium' | 'firefox' | 'webkit',
  bidiEnabled: boolean,
): PropertyDescriptorMap {
  return {
    isW3C: { value: true },
    isChromium: { value: engine === 'chromium' },
    isFirefox: { value: engine === 'firefox' },
    isMobile: { value: false },
    isIOS: { value: false },
    isAndroid: { value: false },
    isSauce: { value: false },
    isSeleniumStandalone: { value: false },
    isWindowsApp: { value: false },
    isMacApp: { value: false },
    isBidi: { value: bidiEnabled },
  }
}

/**
 * Add WebDriver BiDi commands to the prototype. Unlike Classic commands
 * (which are HTTP endpoints in `WebDriverProtocol` that we iterate over),
 * BiDi commands are WebSocket messages and live in a different protocol
 * file. PW only implements the small subset users actually call from
 * WDIO (`sessionSubscribe`, `sessionUnsubscribe`) — anything else can still
 * be added later without breaking changes.
 */
export function buildBidiPrototype(registry: CommandRegistry): PropertyDescriptorMap {
  const proto: PropertyDescriptorMap = {}
  const bidiCommands = [
    // session
    'sessionSubscribe',
    'sessionUnsubscribe',
    // script
    'scriptAddPreloadScript',
    'scriptRemovePreloadScript',
    'scriptEvaluate',
    'scriptCallFunction',
    // browsingContext
    'browsingContextActivate',
    'browsingContextCreate',
    'browsingContextClose',
    'browsingContextNavigate',
    'browsingContextReload',
    'browsingContextTraverseHistory',
    'browsingContextSetViewport',
    'browsingContextGetTree',
    // storage
    'storageGetCookies',
    'storageSetCookie',
    'storageDeleteCookies',
  ]
  for (const name of bidiCommands) {
    const handler = registry[name]
    const wrapped = wrapCommand(name, handler)
    proto[name] = {
      value: function pwBidiFn(this: { sessionId: string }, ...args: unknown[]): Promise<unknown> {
        const session = sessions.get(this.sessionId)
        if (!session) {
          return Promise.reject(
            new InvalidSessionIdError(
              `Session "${this.sessionId}" is not active in the PW driver.`,
            ),
          )
        }
        return wrapped({ session }, ...args)
      },
      writable: true,
      configurable: true,
    }
  }
  return proto
}

/**
 * PW-specific extension commands that aren't in any W3C protocol but
 * are always available on the client (regardless of BiDi opt-in). Currently
 * just the trace controls; more extensions can be added the same way
 * without changing the BiDi gating.
 */
export function buildExtensionsPrototype(registry: CommandRegistry): PropertyDescriptorMap {
  const proto: PropertyDescriptorMap = {}
  const extensionCommands = [
    'pwStartTrace',
    'pwStopTrace',
    'pwSaveStorage',
    'pwLoadStorage',
    'pwNewContext',
    'pwSwitchDevice',
    'pwListDevices',
    'pwRoute',
    'pwUnroute',
    // Tier D — context mutation
    'pwGrantPermissions',
    'pwClearPermissions',
    'pwSetGeolocation',
    'pwSetExtraHeaders',
    'pwSetOffline',
    // Tier D — video + HAR
    'pwGetVideo',
    'pwSaveVideo',
    'pwRouteFromHAR',
    // Quick wins pass — network + a11y + file chooser
    'pwWaitForRequest',
    'pwWaitForResponse',
    'pwOnFileChooser',
    'pwAriaSnapshot',
  ]
  for (const name of extensionCommands) {
    const handler = registry[name]
    const wrapped = wrapCommand(name, handler)
    proto[name] = {
      value: function pwExtensionFn(this: { sessionId: string }, ...args: unknown[]): Promise<unknown> {
        const session = sessions.get(this.sessionId)
        if (!session) {
          return Promise.reject(
            new InvalidSessionIdError(
              `Session "${this.sessionId}" is not active in the PW driver.`,
            ),
          )
        }
        return wrapped({ session }, ...args)
      },
      writable: true,
      configurable: true,
    }
  }
  return proto
}

/**
 * Convenience re-export so call sites can keep the import surface small.
 */
export { webdriverMonad }
