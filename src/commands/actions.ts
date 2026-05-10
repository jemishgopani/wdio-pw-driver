import type { CommandHandler } from '../command.js'
import type { CommandContext, InputState } from '../types.js'
import { ELEMENT_KEY } from '../types.js'
import { StaleElementReferenceError } from '../errors.js'

/**
 * W3C Actions API — performActions / releaseActions.
 *
 * The W3C model is "input sources" (mouse, keyboard, etc.) each producing a
 * tick-aligned sequence of low-level actions. We support:
 *   - pointer / mouse — pointerMove (viewport, pointer, element origins),
 *     pointerDown, pointerUp
 *   - key — keyDown, keyUp (with W3C special-key Unicode mapping)
 *   - none / pause
 *
 * Not yet supported: pen/touch pointer types, wheel source, true parallel
 * dispatch within a tick (sources are dispatched sequentially in source
 * order). These are uncommon in real-world test suites and can be added
 * incrementally.
 */

interface ActionSequence {
  type: 'pointer' | 'key' | 'none' | 'wheel'
  id: string
  parameters?: { pointerType?: 'mouse' | 'pen' | 'touch' }
  actions: TickAction[]
}

type TickAction =
  | { type: 'pointerMove'; x?: number; y?: number; duration?: number; origin?: 'viewport' | 'pointer' | { [k: string]: string } }
  | { type: 'pointerDown'; button?: number }
  | { type: 'pointerUp'; button?: number }
  | { type: 'keyDown'; value: string }
  | { type: 'keyUp'; value: string }
  | { type: 'pause'; duration?: number }
  | { type: 'pointerCancel' }
  | { type: string; [k: string]: unknown }

/**
 * POST /session/:sessionId/actions   body: { actions: ActionSequence[] }
 *
 * Accepts both the W3C body shape `{ actions: [...] }` and a bare array
 * positional argument `[...]`. WDIO's `KeyAction.perform()` (and friends)
 * calls `instance.performActions([this.toJSON()])` — passing the sequences
 * as a positional array — so honoring both keeps drop-in compatibility.
 */
export const performActions: CommandHandler = async (ctx, body) => {
  const sources: ActionSequence[] | undefined = Array.isArray(body)
    ? (body as ActionSequence[])
    : (body as { actions?: ActionSequence[] } | undefined)?.actions
  if (!Array.isArray(sources)) {
    throw new TypeError('performActions: expected ActionSequence[] (bare or under .actions)')
  }

  const totalTicks = sources.reduce((m, s) => Math.max(m, s.actions.length), 0)
  for (let tick = 0; tick < totalTicks; tick++) {
    for (const source of sources) {
      const action = source.actions[tick]
      if (!action) continue
      await dispatch(ctx, source, action)
    }
  }
  return null
}

/**
 * DELETE /session/:sessionId/actions
 *
 * Lifts any keys/buttons we've recorded as pressed during prior performActions
 * calls. Per W3C, this also clears the input state, but we keep pointer
 * coordinates so subsequent pointerMove with origin: 'pointer' still works.
 */
export const releaseActions: CommandHandler = async ({ session }) => {
  const { inputState } = session
  for (const button of inputState.buttonsDown) {
    await session.currentPage.mouse.up({ button: numToButton(button) })
  }
  inputState.buttonsDown.clear()
  for (const key of inputState.keysDown) {
    await session.currentPage.keyboard.up(key)
  }
  inputState.keysDown.clear()
  return null
}

/* -------------------------------------------------------------------------- */
/* Per-action dispatch                                                        */
/* -------------------------------------------------------------------------- */

async function dispatch(
  ctx: CommandContext,
  source: ActionSequence,
  action: TickAction,
): Promise<void> {
  switch (action.type) {
    case 'pause':
      await sleep(typeof action.duration === 'number' ? action.duration : 0)
      return
    case 'pointerMove':
    case 'pointerDown':
    case 'pointerUp':
    case 'pointerCancel':
      if (source.type !== 'pointer') {
        throw new TypeError(`Action ${action.type} requires a pointer source, got ${source.type}`)
      }
      await dispatchPointer(ctx, action)
      return
    case 'keyDown':
    case 'keyUp':
      if (source.type !== 'key') {
        throw new TypeError(`Action ${action.type} requires a key source, got ${source.type}`)
      }
      await dispatchKey(ctx, action as { type: 'keyDown' | 'keyUp'; value: string })
      return
    default:
      throw new TypeError(`Unsupported action type: ${action.type}`)
  }
}

async function dispatchPointer(
  ctx: CommandContext,
  action: TickAction,
): Promise<void> {
  const { session } = ctx
  const { mouse } = session.currentPage
  const state: InputState = session.inputState
  // Cast once for arbitrary-property access; narrowing via discriminated union
  // doesn't reach the catch-all branch in TickAction.
  const a = action as { type: string; x?: number; y?: number; button?: number; origin?: unknown }

  if (a.type === 'pointerMove') {
    const target = await resolveMoveTarget(ctx, {
      type: 'pointerMove',
      x: a.x,
      y: a.y,
      origin: a.origin as 'viewport' | 'pointer' | { [k: string]: string } | undefined,
    })
    state.pointerX = target.x
    state.pointerY = target.y
    await mouse.move(target.x, target.y)
    return
  }

  if (a.type === 'pointerDown') {
    const button = typeof a.button === 'number' ? a.button : 0
    state.buttonsDown.add(button)
    await mouse.down({ button: numToButton(button) })
    return
  }

  if (a.type === 'pointerUp') {
    const button = typeof a.button === 'number' ? a.button : 0
    state.buttonsDown.delete(button)
    await mouse.up({ button: numToButton(button) })
    return
  }

  // pointerCancel — Playwright has no cancel; closest is "release everything".
  for (const button of state.buttonsDown) {
    await mouse.up({ button: numToButton(button) })
  }
  state.buttonsDown.clear()
}

async function dispatchKey(
  ctx: CommandContext,
  action: { type: 'keyDown' | 'keyUp'; value: string },
): Promise<void> {
  const { session } = ctx
  const { keyboard } = session.currentPage
  const key = mapW3CKey(action.value)
  if (action.type === 'keyDown') {
    session.inputState.keysDown.add(key)
    await keyboard.down(key)
  } else {
    session.inputState.keysDown.delete(key)
    await keyboard.up(key)
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Point { x: number; y: number }

/**
 * Resolve a pointerMove's effective viewport coordinates from its origin
 * spec. Mirrors W3C "Get coordinates relative to an origin".
 */
async function resolveMoveTarget(
  ctx: CommandContext,
  action: { type: 'pointerMove'; x?: number; y?: number; origin?: 'viewport' | 'pointer' | { [k: string]: string } | undefined },
): Promise<Point> {
  const x = typeof action.x === 'number' ? action.x : 0
  const y = typeof action.y === 'number' ? action.y : 0
  const origin: 'viewport' | 'pointer' | { [k: string]: string } = action.origin ?? 'viewport'

  if (origin === 'viewport') {
    return { x, y }
  }

  if (origin === 'pointer') {
    return {
      x: ctx.session.inputState.pointerX + x,
      y: ctx.session.inputState.pointerY + y,
    }
  }

  // Element-ref origin: { ELEMENT_KEY: id }
  if (typeof origin === 'object' && origin && ELEMENT_KEY in origin) {
    const id = (origin as Record<string, unknown>)[ELEMENT_KEY]
    if (typeof id !== 'string') {
      throw new TypeError('pointerMove origin: invalid element reference')
    }
    const loc = ctx.session.elementStore.get(id)
    if (!loc) {
      throw new StaleElementReferenceError(`Unknown element-id "${id}"`)
    }
    const box = await loc.boundingBox({ timeout: ctx.session.implicitTimeout })
    if (!box) {
      throw new StaleElementReferenceError(`Element "${id}" has no bounding box`)
    }
    // W3C: x/y are offsets from the element's in-view center.
    return {
      x: box.x + box.width / 2 + x,
      y: box.y + box.height / 2 + y,
    }
  }

  throw new TypeError(`pointerMove: invalid origin (${JSON.stringify(origin)})`)
}

function numToButton(n: number): 'left' | 'middle' | 'right' {
  return n === 1 ? 'middle' : n === 2 ? 'right' : 'left'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Map W3C special-key Unicode characters (U+E000–U+E03D) to Playwright key
 * names. The full table is in W3C "8.3.1 Keyboard actions"; we cover the
 * common keys. Anything else passes through unchanged so plain text typing
 * (e.g. "a", "5", "あ") works without translation.
 */
const W3C_KEY_MAP: Record<string, string> = {
  '': 'NULL',         // no-op marker; Playwright will reject — caller should skip
  '': 'Cancel',
  '': 'Help',
  '': 'Backspace',
  '': 'Tab',
  '': 'Clear',
  '': 'Enter',
  '': 'Enter',
  '': 'Shift',
  '': 'Control',
  '': 'Alt',
  '': 'Pause',
  '': 'Escape',
  '': ' ',            // Space — Playwright accepts ' ' too
  '': 'PageUp',
  '': 'PageDown',
  '': 'End',
  '': 'Home',
  '': 'ArrowLeft',
  '': 'ArrowUp',
  '': 'ArrowRight',
  '': 'ArrowDown',
  '': 'Insert',
  '': 'Delete',
  '': ';',
  '': '=',
  '': 'Meta',
}

function mapW3CKey(value: string): string {
  if (value in W3C_KEY_MAP) {
    return W3C_KEY_MAP[value]!
  }
  // F1–F12 are ..
  const code = value.charCodeAt(0)
  if (code >= 0xe031 && code <= 0xe03c) {
    return `F${code - 0xe031 + 1}`
  }
  // Numpad 0–9 are ..; map to plain digit since Playwright lacks
  // distinct numpad key codes in its high-level API.
  if (code >= 0xe01a && code <= 0xe023) {
    return String(code - 0xe01a)
  }
  return value
}
