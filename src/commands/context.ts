import type { CommandHandler } from '../command.js'
import { toContextOptions } from '../capabilities.js'
import { InvalidArgumentError } from '../errors.js'
import { attachContextListeners } from '../listeners.js'
import type { PWCapabilities } from '../types.js'

/**
 * PW `pwNewContext(overrides?)` — close the current BrowserContext and
 * open a fresh one inside the same browser process. Mirrors
 * `@playwright/test`'s test-isolation model where every test gets a clean
 * context (no cookies, no localStorage, no leftover tabs).
 *
 * After this returns, `session.currentPage` is a brand-new Page on a fresh
 * context, the element store is wiped (old element-ids would be stale
 * anyway), the dialog/input state is reset, and any active trace is
 * stopped (a fresh trace would need to be started explicitly via
 * pwStartTrace).
 *
 * Optional `overrides`: a partial `PWOptions` object that gets merged into
 * `session.requestedCapabilities['wdio:pwOptions']` before the new context
 * is built. Lets callers switch device preset, baseURL, viewport, etc.
 * mid-session:
 *
 *   await browser.pwNewContext({ device: 'iPhone 13' })
 *   await browser.pwNewContext({ baseURL: 'https://staging.app.test' })
 *
 * The override is **sticky** — subsequent `pwNewContext()` calls without
 * args inherit the new options, matching how `pwSetExtraHeaders` and
 * friends behave (set once, stays changed). Pass an explicit `null` field
 * to reset that field back to the original launch capability.
 *
 * Use case: per-test fresh sessions without paying the browser-launch
 * cost. Faster than full session teardown + rebuild because the browser
 * process stays alive — only the context is rotated.
 */
export const pwNewContext: CommandHandler = async ({ session }, body) => {
  // 0. Merge any caller overrides into the session's stored capabilities
  //    BEFORE teardown — if parsing throws we want to fail with the old
  //    context still intact, not mid-rotation.
  const overrides = parseOverrides(body)
  if (overrides) {
    session.requestedCapabilities = mergeOverrides(
      session.requestedCapabilities as PWCapabilities,
      overrides,
    )
  }

  // 1. Stop any in-flight trace (we don't lose the action history because
  //    auto-trace's deleteSession path will write its own zip; explicit
  //    traces require the user to have called pwStopTrace already).
  if (session.tracing.active) {
    try {
      await session.context.tracing.stop()
    } catch {
      /* ignore */
    }
    session.tracing.active = false
    session.tracing.autoStop = false
    session.tracing.autoPath = undefined
  }

  // 2. Tear down the old context. `context.close()` deadlocks in Playwright
  //    1.59 when network routes were registered on the context (probably
  //    waits forever for a route handler to settle). We work around it by
  //    detaching listeners + closing pages, but NOT awaiting close() —
  //    fire-and-forget. The old context is effectively orphaned and will
  //    be cleaned up when `browser.close()` runs at session teardown.
  //    Memory cost: ~1 BrowserContext worth of state, until deleteSession.
  const oldContext = session.context
  oldContext.removeAllListeners()
  for (const p of oldContext.pages()) {
    p.removeAllListeners()
    p.close({ runBeforeUnload: false }).catch(() => { /* fire-and-forget */ })
  }
  oldContext.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => { /* fire-and-forget */ })
  oldContext.close({ reason: 'pwNewContext rotation' }).catch(() => { /* fire-and-forget */ })

  // 3. Open a new context with the same options the original session was
  //    built with. Reusing the requested capabilities keeps viewport /
  //    ignoreHTTPSErrors / mobileEmulation / storageState consistent.
  session.context = await session.browser.newContext(toContextOptions(session.requestedCapabilities))
  session.context.setDefaultTimeout(session.defaultTimeout)

  // 4. Open a fresh page and reset the per-session state that was tied to
  //    the old context.
  session.currentPage = await session.context.newPage()
  session.currentFrame = null
  session.pages.clear()
  session.pages.set('page-1', session.currentPage)
  session.elementStore.clear()
  session.dialogs.pending = null
  session.dialogs.nextAction = 'accept'
  session.dialogs.pendingText = undefined
  session.inputState.buttonsDown.clear()
  session.inputState.keysDown.clear()
  session.inputState.pointerX = 0
  session.inputState.pointerY = 0

  // 5. Re-attach dialog + BiDi listeners on the new context. Without this,
  //    `browser.on('log.entryAdded')` would silently stop firing after a
  //    pwNewContext() call.
  attachContextListeners(session, session.context)

  return null
}

/**
 * `pwSwitchDevice(name)` — sugar over `pwNewContext({ device: name })`.
 *
 * Switches the BrowserContext to a Playwright device preset mid-session.
 * Same caveats as `pwNewContext`: cookies, localStorage, routes, dialog
 * state are all reset, and any element-id references from before the
 * switch become stale.
 *
 * Pass an empty string or `null` to clear the device override and revert
 * to the original launch capability:
 *
 *   await browser.pwSwitchDevice('iPhone 13')   // emulate iPhone
 *   await browser.pwSwitchDevice(null)          // back to launch defaults
 */
export const pwSwitchDevice: CommandHandler = async (ctx, body) => {
  // Distinguish three caller intents:
  //   pwSwitchDevice('iPhone 13') → set device override
  //   pwSwitchDevice(null)        → clear override (revert to launch caps)
  //   pwSwitchDevice() / ''       → bad call, throw
  if (body === null || (Array.isArray(body) && body[0] === null)) {
    // Forward null through pwNewContext's merger which deletes the key.
    return pwNewContext(ctx, { device: null } as unknown as Record<string, unknown>)
  }
  const name = parseDeviceName(body)
  if (!name) {
    throw new InvalidArgumentError(
      'pwSwitchDevice: a non-empty device name is required, or pass null to reset',
    )
  }
  return pwNewContext(ctx, { device: name })
}

/* -------------------------------------------------------------------------- */
/* Body parsing + override merge                                              */
/* -------------------------------------------------------------------------- */

/**
 * Override values can include `null` (meaning "clear this field; revert to
 * the launch capability"), so we use a wider type than `Partial<PWOptions>`
 * which only allows undefined. The mergeOverrides helper interprets null
 * as a deletion.
 */
type Overrides = Record<string, unknown>

function parseOverrides(body: unknown): Overrides | undefined {
  if (body === undefined || body === null) return undefined
  // WDIO sometimes wraps args in arrays when a method takes one positional
  // argument. Unwrap if so.
  if (Array.isArray(body)) {
    if (body.length === 0) return undefined
    return parseOverrides(body[0])
  }
  if (typeof body !== 'object') {
    throw new InvalidArgumentError(
      'pwNewContext: overrides must be a plain object (e.g. { device: "iPhone 13" })',
    )
  }
  return body as Overrides
}

function parseDeviceName(body: unknown): string | undefined {
  // Accept: 'iPhone 13'  |  null  |  ['iPhone 13']  |  { device: 'iPhone 13' }
  if (body === null) return undefined
  if (typeof body === 'string') return body || undefined
  if (Array.isArray(body)) return parseDeviceName(body[0])
  if (body && typeof body === 'object' && 'device' in (body as object)) {
    const v = (body as { device: unknown }).device
    return typeof v === 'string' ? v || undefined : undefined
  }
  throw new InvalidArgumentError(
    'pwSwitchDevice: expected a device name string (e.g. "iPhone 13") or null to reset',
  )
}

/**
 * Merge caller overrides into the session's stored capabilities. Sticky:
 * the next plain `pwNewContext()` will inherit the merged result. To
 * actually clear a previously-set field, the caller passes `null` for
 * that field — the merge drops null-valued keys back to undefined so
 * `toContextOptions` falls through to the launch defaults.
 */
function mergeOverrides(
  caps: PWCapabilities,
  overrides: Overrides,
): PWCapabilities {
  const current = (caps['wdio:pwOptions'] ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) {
      delete merged[k]
    } else if (v !== undefined) {
      merged[k] = v
    }
  }
  return { ...caps, 'wdio:pwOptions': merged as PWCapabilities['wdio:pwOptions'] }
}
