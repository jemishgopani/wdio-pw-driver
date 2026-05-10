import type { ElementHandle, Locator, JSHandle } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import type { CommandContext, ElementReference } from '../types.js'
import { ELEMENT_KEY } from '../types.js'
import { StaleElementReferenceError } from '../errors.js'
import { currentScope } from '../scope.js'

/**
 * POST /session/:sessionId/execute/sync   body: { script, args }
 *
 * WebDriver scripts are written as a function body — an explicit `return` is
 * required to send a value back. We dispatch through Playwright's
 * page.evaluate(), which accepts (function, single-arg). To preserve the
 * WebDriver contract that args are spread positionally, we wrap the user's
 * body in an IIFE applied with the provided args array.
 *
 * Element-reference args (`{ [ELEMENT_KEY]: id }`) are resolved to live
 * ElementHandles before reaching the page; Playwright unwraps handles inside
 * the args array so the script sees a real DOM Element.
 *
 * Element return values are detected post-evaluate (via JSHandle.asElement)
 * and registered as new W3C element references.
 *
 * Perf note: `marshalResult` now tries jsonValue() first (works for null,
 * primitives, plain objects, arrays-of-primitives) and only falls back to
 * the per-item array walk when jsonValue throws. Saves 1 IPC for the
 * common case of a script returning a primitive or plain object.
 */
export const executeScript: CommandHandler = async (ctx, script, args) => {
  if (typeof script !== 'string') {
    throw new TypeError('executeScript: expected script string')
  }
  const argList = Array.isArray(args) ? args : []
  const resolved = hasElementRef(argList) ? await resolveArgs(ctx, argList) : argList

  const pageFn = new Function(
    'args',
    `return (function() { ${script} }).apply(null, args);`,
  ) as (a: unknown[]) => unknown

  const handle = await currentScope(ctx.session).evaluateHandle(pageFn, resolved)
  try {
    return await marshalResult(ctx, handle)
  } finally {
    await handle.dispose().catch(() => {})
  }
}

/**
 * POST /session/:sessionId/execute/async   body: { script, args }
 *
 * The script is given a `done` callback as its last argument; calling
 * `done(value)` resolves the command with `value`. We adapt by injecting a
 * resolver into args and wrapping the body in a Promise.
 */
export const executeAsyncScript: CommandHandler = async (ctx, script, args) => {
  if (typeof script !== 'string') {
    throw new TypeError('executeAsyncScript: expected script string')
  }
  const argList = Array.isArray(args) ? args : []
  const resolved = hasElementRef(argList) ? await resolveArgs(ctx, argList) : argList

  const pageFn = new Function(
    'args',
    `return new Promise(function(__resolve) {
      var allArgs = args.concat([__resolve]);
      (function() { ${script} }).apply(null, allArgs);
    });`,
  ) as (a: unknown[]) => Promise<unknown>

  const handle = await currentScope(ctx.session).evaluateHandle(pageFn, resolved)
  try {
    return await marshalResult(ctx, handle)
  } finally {
    await handle.dispose().catch(() => {})
  }
}

/* -------------------------------------------------------------------------- */
/* Fast-path predicates                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Cheap structural check — does the args array (top-level only) include a
 * W3C element reference? If yes we must take the slow path so the ref can
 * be unwrapped to a real ElementHandle on the page side.
 */
function hasElementRef(args: unknown[]): boolean {
  for (const a of args) {
    if (a && typeof a === 'object' && ELEMENT_KEY in (a as object)) return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/* Argument marshaling (Node → page)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Walk the args array, swapping every element-reference for the actual
 * ElementHandle from the session's element store. Other values pass through
 * untouched. Playwright unwraps handles inside arrays/objects automatically
 * when they reach the page side.
 */
async function resolveArgs(ctx: CommandContext, args: unknown[]): Promise<unknown[]> {
  const resolved: unknown[] = []
  for (const a of args) {
    resolved.push(await resolveOne(ctx, a))
  }
  return resolved
}

async function resolveOne(ctx: CommandContext, value: unknown): Promise<unknown> {
  if (value && typeof value === 'object' && ELEMENT_KEY in (value as object)) {
    const id = (value as Record<string, unknown>)[ELEMENT_KEY]
    if (typeof id !== 'string') {
      throw new TypeError(`Invalid element reference: expected string id`)
    }
    const loc = ctx.session.elementStore.get(id)
    if (!loc) {
      throw new StaleElementReferenceError(`Unknown element-id "${id}"`)
    }
    const handle = await loc.elementHandle({ timeout: ctx.session.implicitTimeout })
    if (!handle) {
      throw new StaleElementReferenceError(`Element "${id}" no longer attached`)
    }
    return handle
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* Result marshaling (page → Node)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn a JSHandle into the W3C-shaped JSON value WDIO expects.
 *
 * - DOM Element → registered + wrapped as `{ [ELEMENT_KEY]: id }`.
 * - Array of values → each item marshaled recursively.
 * - Plain JSON value → returned as-is.
 *
 * Plain objects with element-typed values aren't recursed (deep marshaling
 * of nested elements is a Phase 5+ enhancement); they round-trip as JSON.
 */
async function marshalResult(ctx: CommandContext, handle: JSHandle): Promise<unknown> {
  // Synchronous element check first — no IPC.
  const asElement = handle.asElement()
  if (asElement) {
    return registerHandle(ctx, asElement)
  }

  // Detect arrays via evaluate (1 IPC). Note: we *can't* short-circuit by
  // calling jsonValue() first — current Playwright versions stringify
  // returned DOM nodes to a "ref: <Node>" placeholder rather than throwing,
  // so a jsonValue-first fast path would silently drop element wrapping.
  const isArray = await handle.evaluate((v: unknown) => Array.isArray(v)).catch(() => false)
  if (isArray) {
    const length = await handle.evaluate((v: unknown[]) => v.length)
    const out: unknown[] = []
    for (let i = 0; i < length; i++) {
      const item = await handle.evaluateHandle(
        (arr: unknown[], idx: number) => (arr as unknown[])[idx],
        i,
      )
      try {
        out.push(await marshalResult(ctx, item))
      } finally {
        await item.dispose().catch(() => {})
      }
    }
    return out
  }

  // Plain JSON value (number, string, boolean, null, plain object).
  return handle.jsonValue()
}

/**
 * Convert an ElementHandle returned from a script into a stored Locator + ref.
 *
 * Playwright doesn't have "locator from handle". We use the same DOM-marker
 * pattern as getActiveElement so the registered Locator stays usable across
 * subsequent commands. The marker stays attached for the page lifetime —
 * intentional trade-off, see commands/element.ts:getActiveElement.
 */
async function registerHandle(ctx: CommandContext, el: ElementHandle): Promise<ElementReference> {
  const marker = await el.evaluate((node: Element) => {
    const name = `data-pw-script-${Math.random().toString(36).slice(2)}`
    node.setAttribute(name, '1')
    return name
  })
  const loc: Locator = currentScope(ctx.session).locator(`[${marker}]`).first()
  const id = ctx.session.elementStore.register(loc)
  return { [ELEMENT_KEY]: id }
}
