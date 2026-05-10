import type { CommandContext } from './types.js'
import { NotImplementedError, translatePlaywrightError, WebDriverError } from './errors.js'
import { log } from './logger.js'

/**
 * A handler implements one WebDriver protocol command. It receives the
 * per-session CommandContext plus whatever positional arguments WDIO would
 * pass over HTTP (URL variables come first, then body parameters in order).
 *
 * Example:
 *   findElement(ctx, using, value)        -> ElementReference
 *   elementClick(ctx, elementId)          -> null
 *   navigateTo(ctx, url)                  -> null
 */
export type CommandHandler = (
  ctx: CommandContext,
  ...args: unknown[]
) => Promise<unknown>

/**
 * Registry mapping protocol command names to their PW implementations.
 *
 * The set of keys here defines what commands PW actually supports. Any
 * command in `@wdio/protocols/WebDriverProtocol` that is NOT in this map will
 * throw NotImplementedError at call time so users get a clear error rather
 * than a silent no-op.
 */
export type CommandRegistry = Record<string, CommandHandler>

/**
 * Wrap a registered handler so that:
 *   - Playwright errors are translated to WebDriver shapes.
 *   - Calls are logged at the `pw` channel.
 *   - Unhandled commands throw NotImplementedError consistently.
 */
export function wrapCommand(name: string, handler: CommandHandler | undefined): CommandHandler {
  return async (ctx, ...args) => {
    if (!handler) {
      throw new NotImplementedError(name)
    }
    log.debug(`-> ${name}(${stringifyArgs(args)})`)
    try {
      const result = await handler(ctx, ...args)
      log.debug(`<- ${name} ok`)
      return result
    } catch (err) {
      const translated = err instanceof WebDriverError ? err : translatePlaywrightError(err)
      log.debug(`<- ${name} ${translated.name}: ${translated.message}`)
      throw translated
    }
  }
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return JSON.stringify(a)
      if (a === null || a === undefined) return String(a)
      try {
        const s = JSON.stringify(a)
        return s.length > 80 ? s.slice(0, 80) + '…' : s
      } catch {
        return '[unserializable]'
      }
    })
    .join(', ')
}
