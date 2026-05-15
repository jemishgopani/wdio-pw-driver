import type { Locator } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import type { CommandContext, ElementReference, ShadowRootReference } from '../types.js'
import { ELEMENT_KEY, SHADOW_ELEMENT_KEY } from '../types.js'
import { buildLocator } from '../selectorMapper.js'
import { ElementNotInteractableError, NoSuchElementError, StaleElementReferenceError } from '../errors.js'
import { currentScope } from '../scope.js'

/**
 * Resolve a Locator from an element-id stored in the session's element store.
 * Throws StaleElementReferenceError if the id is unknown — WDIO treats this
 * the same as a stale element, which is the closest semantic match.
 */
function locatorFor(ctx: CommandContext, elementId: unknown): Locator {
  if (typeof elementId !== 'string') {
    throw new TypeError(`Expected element-id string, got ${typeof elementId}`)
  }
  const loc = ctx.session.elementStore.get(elementId)
  if (!loc) {
    throw new StaleElementReferenceError(`Unknown element-id "${elementId}"`)
  }
  return loc
}

// `ensureFresh` removed in the v0.1 perf pass. Pre-flighting `count()` on
// every element-using command doubled IPC count for no semantic gain —
// Playwright's own actionability checks throw on detached/invisible nodes,
// and `translatePlaywrightError` (errors.ts) maps those to
// StaleElementReferenceError. The error wording is now distinguishable from
// "never existed" because every stored element-id was materialized at
// register time, so a later miss is by construction "no longer attached".

/**
 * Wrap an action/query on a STORED element-id. Element-ids by construction
 * point at locators that were materialized at find-time, so any subsequent
 * "not found" failure is definitionally StaleElementReferenceError per W3C.
 * This sidesteps the global translator's NoSuchElement-vs-Stale ambiguity.
 */
async function onStoredElement<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as { name?: string; message?: string }
    if (e?.name === 'TimeoutError' || /element\(s\) not found|locator\..*Timeout/i.test(e?.message ?? '')) {
      throw new StaleElementReferenceError('Element is no longer attached to the DOM')
    }
    throw err
  }
}

function shadowFor(ctx: CommandContext, shadowId: unknown): Locator {
  if (typeof shadowId !== 'string') {
    throw new TypeError(`Expected shadow-id string, got ${typeof shadowId}`)
  }
  const loc = ctx.session.elementStore.getShadowRoot(shadowId)
  if (!loc) {
    throw new StaleElementReferenceError(`Unknown shadow-id "${shadowId}"`)
  }
  return loc
}

function asElementReference(id: string): ElementReference {
  return { [ELEMENT_KEY]: id }
}

function asShadowReference(id: string): ShadowRootReference {
  return { [SHADOW_ELEMENT_KEY]: id }
}

/**
 * Confirm the locator resolves to ≥1 node, then register it. Uses
 * `loc.first().waitFor({ state: 'attached', timeout })` which is a single
 * IPC and polls up to the implicit wait — same semantics as the previous
 * `elementHandle({timeout}) + dispose` pair (2 IPCs) but cheaper.
 */
async function materializeAndRegister(ctx: CommandContext, loc: Locator, label: string): Promise<string> {
  try {
    await loc.waitFor({ state: 'attached', timeout: ctx.session.implicitTimeout })
    return ctx.session.elementStore.register(loc)
  } catch (err) {
    if ((err as { name?: string }).name === 'TimeoutError') {
      throw new NoSuchElementError(`Element not found: ${label}`)
    }
    throw err
  }
}

/* -------------------------------------------------------------------------- */
/* Top-level find                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Convert a NoSuchElementError throw from `materializeAndRegister` into the
 * shape WebdriverIO's chainable layer expects to receive (so it can wrap it
 * as `Element.error` rather than letting the throw bubble up to the test).
 *
 * Why this matters: WDIO's stock `webdriver` package treats a "no such
 * element" 404 HTTP response as a SUCCESSFUL response (see webdriver's
 * isSuccessfulResponse — `statusCode === 404 && body.value.error === 'no
 * such element' → return true`). So in stock chromedriver flow,
 * `findElement` resolves with `{error: 'no such element', message: '...'}`
 * instead of rejecting. WDIO's `$()` chainable then wraps that into an
 * Element with `client.error` set, which is what `expect(...).not.toBeExisting()`
 * relies on to behave correctly.
 *
 * If we throw, expect-webdriverio's matcher (which does
 * `received?.getElement()` BEFORE its main check) propagates the throw and
 * the assertion fails instead of passing. So we mirror the post-conversion
 * shape that the webdriver package produces.
 */
async function findOrNotFoundShape(
  ctx: CommandContext,
  loc: Locator,
  label: string,
): Promise<ElementReference | { error: string; message: string }> {
  try {
    const id = await materializeAndRegister(ctx, loc, label)
    return asElementReference(id)
  } catch (err) {
    if (err instanceof NoSuchElementError) {
      return { error: 'no such element', message: err.message }
    }
    throw err
  }
}

/**
 * POST /session/:sessionId/element   body: { using, value }
 *
 * Scoped to the current frame (or main frame if no switchToFrame in effect).
 *
 * Returns either `{ELEMENT_KEY: 'uuid'}` on success or
 * `{error: 'no such element', message: '...'}` on miss — matches what
 * stock WDIO + chromedriver delivers (see findOrNotFoundShape comment).
 */
export const findElement: CommandHandler = async (ctx, using, value) => {
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElement requires (using, value) as strings')
  }
  const loc = buildLocator(currentScope(ctx.session), using, value).first()
  return findOrNotFoundShape(ctx, loc, `${using}=${value}`)
}

/**
 * POST /session/:sessionId/elements   body: { using, value }
 */
export const findElements: CommandHandler = async (ctx, using, value) => {
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElements requires (using, value) as strings')
  }
  const root = buildLocator(currentScope(ctx.session), using, value)
  const count = await root.count()
  const refs: ElementReference[] = []
  for (let i = 0; i < count; i++) {
    const child = root.nth(i)
    refs.push(asElementReference(ctx.session.elementStore.register(child)))
  }
  return refs
}

/* -------------------------------------------------------------------------- */
/* Scoped find                                                                */
/* -------------------------------------------------------------------------- */

/**
 * POST /session/:sessionId/element/:elementId/element   body: { using, value }
 *
 * Scoped find: search inside the given element. Returns either
 * `{ELEMENT_KEY: 'uuid'}` on success or `{error: 'no such element', ...}`
 * on miss — see findOrNotFoundShape() for why we don't throw.
 */
export const findElementFromElement: CommandHandler = async (ctx, parentId, using, value) => {
  const parent = locatorFor(ctx, parentId)
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElementFromElement requires (using, value) as strings')
  }
  if (using === 'css selector') {
    return findChildElementViaQuerySelector(ctx, parent, value)
  }
  const child = buildLocator(parent, using, value).first()
  return findOrNotFoundShape(ctx, child, `${using}=${value} (under stored element)`)
}

/**
 * POST /session/:sessionId/element/:elementId/elements   body: { using, value }
 */
export const findElementsFromElement: CommandHandler = async (ctx, parentId, using, value) => {
  const parent = locatorFor(ctx, parentId)
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElementsFromElement requires (using, value) as strings')
  }
  if (using === 'css selector') {
    return findChildElementsViaQuerySelector(ctx, parent, value)
  }
  const root = buildLocator(parent, using, value)
  const count = await root.count()
  const refs: ElementReference[] = []
  for (let i = 0; i < count; i++) {
    refs.push(asElementReference(ctx.session.elementStore.register(root.nth(i))))
  }
  return refs
}

/**
 * W3C-compatible findElementFromElement for CSS selectors.
 *
 * Playwright's `parent.locator(child)` uses `:scope` chaining — the child
 * selector is evaluated with `:scope` set to parent, but ":scope" itself is
 * never included as a candidate match for the leftmost simple selector.
 * That diverges from `Element.querySelector()` (W3C Selectors API), which is
 * what chromedriver / Selenium use: it matches descendants where any ancestor
 * up to AND INCLUDING the parent can satisfy the descendant combinator.
 *
 * Concrete case that breaks under PW's chaining but works under chromedriver:
 *   parent  = <div data-testid="X">…<label class="mdc-label">…</label></div>
 *   child   = '[data-testid="X"] label.mdc-label'
 * → PW's locator can't find the label because there's no `[data-testid="X"]`
 *   STRICTLY inside parent. querySelector finds it because parent itself
 *   matches the leftmost simple selector.
 *
 * We dispatch through `parent.evaluateHandle(el => el.querySelector(sel))`
 * to get exactly the W3C semantics, then register the returned ElementHandle
 * as a locator via a unique marker attribute (same trick used by
 * registerHandle in execute.ts and getActiveElement).
 */
async function findChildElementViaQuerySelector(
  ctx: CommandContext,
  parent: Locator,
  selector: string,
): Promise<ElementReference | { error: string; message: string }> {
  const deadline = Date.now() + ctx.session.implicitTimeout
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const handle = await parent.evaluateHandle(
        (el: Element, sel: string) => el.querySelector(sel),
        selector,
      )
      try {
        const asEl = handle.asElement()
        if (asEl) {
          const id = await registerHandleAsLocator(ctx, asEl)
          return asElementReference(id)
        }
      } finally {
        await handle.dispose().catch(() => {})
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'TimeoutError') throw err
    }
    if (Date.now() >= deadline) {
      return {
        error: 'no such element',
        message: `Element not found: css selector=${selector} (under stored element)`,
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function findChildElementsViaQuerySelector(
  ctx: CommandContext,
  parent: Locator,
  selector: string,
): Promise<ElementReference[]> {
  // findElements semantics: no implicit-wait poll; return immediately with
  // whatever's currently in the DOM (per W3C — only findElement waits).
  const handles = await parent.evaluateHandle(
    (el: Element, sel: string) => Array.from(el.querySelectorAll(sel)),
    selector,
  )
  try {
    const length = await handles.evaluate((arr) => (arr as unknown[]).length)
    const refs: ElementReference[] = []
    for (let i = 0; i < length; i++) {
      const itemHandle = await handles.evaluateHandle(
        (arr: unknown[], idx: number) => (arr as unknown[])[idx],
        i,
      )
      try {
        const asEl = itemHandle.asElement()
        if (asEl) {
          const id = await registerHandleAsLocator(ctx, asEl)
          refs.push(asElementReference(id))
        }
      } finally {
        await itemHandle.dispose().catch(() => {})
      }
    }
    return refs
  } finally {
    await handles.dispose().catch(() => {})
  }
}

async function registerHandleAsLocator(
  ctx: CommandContext,
  el: { evaluate: (fn: (n: Element) => string) => Promise<string> },
): Promise<string> {
  const marker = await el.evaluate((node: Element) => {
    const name = `data-pw-find-${Math.random().toString(36).slice(2)}`
    node.setAttribute(name, '1')
    return name
  })
  const loc = currentScope(ctx.session).locator(`[${marker}]`).first()
  return ctx.session.elementStore.register(loc)
}

/* -------------------------------------------------------------------------- */
/* Shadow root                                                                */
/* -------------------------------------------------------------------------- */

/**
 * GET /session/:sessionId/element/:elementId/shadow
 *
 * Returns a reference to the open shadow root of an element. Playwright
 * doesn't expose ShadowRoot directly as a Locator — its locator engine
 * pierces shadow DOM by default. To preserve the W3C shape, we register a
 * synthetic shadow-locator that wraps the host element; subsequent
 * findElementFromShadowRoot() searches against the host's shadow tree via
 * a Playwright `>>` selector.
 */
export const getElementShadowRoot: CommandHandler = async (ctx, elementId) => {
  const host = locatorFor(ctx, elementId)
  // Ensure the host actually has an open shadowRoot (W3C requires this).
  const hasOpen = await host.evaluate((el: Element) => !!(el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot)
  if (!hasOpen) {
    throw new NoSuchElementError('Element has no open shadow root')
  }
  // Store the host locator under the shadow namespace; resolution via
  // findElementFromShadowRoot will scope into shadowRoot itself.
  const id = ctx.session.elementStore.registerShadowRoot(host)
  return asShadowReference(id)
}

/**
 * POST /session/:sessionId/shadow/:shadowId/element   body: { using, value }
 *
 * Playwright's locators auto-pierce open shadow DOM, so we just resolve
 * against the host element; the engine descends into shadowRoot transparently.
 */
export const findElementFromShadowRoot: CommandHandler = async (ctx, shadowId, using, value) => {
  const host = shadowFor(ctx, shadowId)
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElementFromShadowRoot requires (using, value) as strings')
  }
  const child = buildLocator(host, using, value).first()
  return findOrNotFoundShape(ctx, child, `${using}=${value} (in shadow)`)
}

/**
 * POST /session/:sessionId/shadow/:shadowId/elements   body: { using, value }
 */
export const findElementsFromShadowRoot: CommandHandler = async (ctx, shadowId, using, value) => {
  const host = shadowFor(ctx, shadowId)
  if (typeof using !== 'string' || typeof value !== 'string') {
    throw new TypeError('findElementsFromShadowRoot requires (using, value) as strings')
  }
  const root = buildLocator(host, using, value)
  const count = await root.count()
  const refs: ElementReference[] = []
  for (let i = 0; i < count; i++) {
    refs.push(asElementReference(ctx.session.elementStore.register(root.nth(i))))
  }
  return refs
}

/* -------------------------------------------------------------------------- */
/* Active element                                                             */
/* -------------------------------------------------------------------------- */

/**
 * GET /session/:sessionId/element/active
 *
 * Returns the currently focused element (document.activeElement equivalent).
 * If nothing is focused (or only the body is), W3C says: throw NoSuchElement.
 *
 * Implementation note: Playwright doesn't expose "build a Locator from an
 * existing JSHandle". To produce a stable, re-usable W3C reference we tag
 * the focused element with a unique data-* marker and locate by that. The
 * marker stays attached for the life of the page — small DOM pollution in
 * exchange for a working reference; cleaner than spinning up a custom
 * locator engine. Same trade-off Selenium-on-CDP shims make.
 */
export const getActiveElement: CommandHandler = async (ctx) => {
  const scope = currentScope(ctx.session)
  const marker = await scope.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const name = `data-pw-active-${Math.random().toString(36).slice(2)}`
    el.setAttribute(name, '1')
    return name
  })
  if (!marker) {
    throw new NoSuchElementError('No active element (document.body or null)')
  }
  const loc = scope.locator(`[${marker}]`).first()
  const id = await materializeAndRegister(ctx, loc, 'active element')
  return asElementReference(id)
}

/* -------------------------------------------------------------------------- */
/* Element actions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * POST /session/:sessionId/element/:elementId/click
 *
 * Special-case for `<option>` elements: Playwright refuses to click them
 * directly because options aren't pointer-interactable (they're only
 * visible when the parent `<select>` is open). The actionability check
 * times out instead of failing fast. WDIO's `selectByAttribute` /
 * `selectByVisibleText` / `selectByIndex` all do `option.click()` under
 * the hood, so this case fires a lot in real specs.
 *
 * Detection: probe the tag in one round-trip. If `<option>`, route to
 * the parent `<select>`'s `selectOption()` API, which is the proper
 * Playwright primitive. Otherwise, fall through to the standard click.
 *
 * The probe costs one extra IPC call. We could skip it speculatively,
 * but the alternative — letting the click hang for 30s on every
 * dropdown selection — is much worse. The driver's other call sites
 * also benefit (a script that clicks an `<option>` to scroll-to it now
 * just works).
 */
export const elementClick: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  await onStoredElement(async () => {
    const tag = await loc.evaluate((el) => (el as HTMLElement).tagName).catch(() => '')
    if (tag === 'OPTION') {
      // Use the option's value to drive the parent select. We pass an
      // array form (`[value]`) so multi-select <select multiple> behavior
      // matches a single-click on a multi list correctly.
      const value = await loc.evaluate((el) => (el as HTMLOptionElement).value)
      const parentSelect = loc.locator('xpath=ancestor::select[1]')
      await parentSelect.selectOption({ value }, { timeout: ctx.session.defaultTimeout })
      return
    }
    await loc.click({ timeout: ctx.session.defaultTimeout })
  })
  return null
}

/**
 * POST /session/:sessionId/element/:elementId/clear
 *
 * Playwright's `.clear()` only works on input/textarea/contenteditable;
 * it throws a generic "calling .clear()" error otherwise. Rewrap as
 * ElementNotInteractableError so the W3C error code surfaces (and so the
 * message tells the caller what went wrong, not what API the driver
 * called internally).
 */
export const elementClear: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  try {
    await loc.clear({ timeout: ctx.session.defaultTimeout })
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? ''
    if (/Element is not.*editable|not an.*<input>|not a.*<textarea>|cannot be cleared/i.test(msg)) {
      throw new ElementNotInteractableError(
        'elementClear: element is not clearable (must be <input>, <textarea>, or contenteditable)',
      )
    }
    throw err
  }
  return null
}

/**
 * POST /session/:sessionId/element/:elementId/value   body: { text }
 *
 * Note: WebDriver semantics are *append*, not replace. Use elementClear first
 * to overwrite. Playwright's `.fill()` replaces, so we use `.pressSequentially()`
 * to match.
 *
 * Special-case for `<input type="file">`: Selenium/WDIO convention is to
 * call `setValue('/abs/path/to/file')` (or newline-separated paths for
 * multi-file inputs) on a file input. Stock chromedriver intercepts this
 * and uploads the file. Playwright would type the path into the focused
 * element instead — silently no-oping the upload — unless we explicitly
 * route through `setInputFiles()`. Same flavor of fix as the `<option>`
 * click special-case above.
 */
export const elementSendKeys: CommandHandler = async (ctx, elementId, text) => {
  const loc = locatorFor(ctx, elementId)
  if (typeof text !== 'string') {
    throw new TypeError(`elementSendKeys: expected string, got ${typeof text}`)
  }
  const fileInputType = await loc
    .evaluate((el) => {
      if (el instanceof HTMLInputElement && el.type === 'file') return 'file'
      return null
    })
    .catch(() => null)
  if (fileInputType === 'file') {
    // W3C convention: newline-separated paths for `<input multiple>`. A
    // single path with no newline becomes a one-element array.
    const files = text.split('\n').filter((p) => p.length > 0)
    await loc.setInputFiles(files, { timeout: ctx.session.defaultTimeout })
    return null
  }
  await loc.pressSequentially(text, { timeout: ctx.session.defaultTimeout })
  return null
}

/* -------------------------------------------------------------------------- */
/* Element queries                                                            */
/* -------------------------------------------------------------------------- */

/**
 * GET /session/:sessionId/element/:elementId/text
 */
export const getElementText: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  // WebDriver returns the rendered, trimmed text. Playwright's innerText
  // matches that semantically (vs textContent which includes hidden text).
  // Read ops use implicitTimeout — failing fast on a detached element is
  // the right W3C behavior (StaleElementReferenceError) and we don't want
  // a query to hang for the full 30 s action timeout.
  return onStoredElement(() => loc.innerText({ timeout: ctx.session.implicitTimeout }))
}

/**
 * GET /session/:sessionId/element/:elementId/name
 */
export const getElementTagName: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  const tag = await loc.evaluate((el: Element) => el.tagName.toLowerCase())
  return tag
}

/**
 * GET /session/:sessionId/element/:elementId/attribute/:name
 */
export const getElementAttribute: CommandHandler = async (ctx, elementId, name) => {
  if (typeof name !== 'string') {
    throw new TypeError(`getElementAttribute: expected attribute name string`)
  }
  const loc = locatorFor(ctx, elementId)
  return loc.getAttribute(name, { timeout: ctx.session.implicitTimeout })
}

/**
 * GET /session/:sessionId/element/:elementId/property/:name
 */
export const getElementProperty: CommandHandler = async (ctx, elementId, name) => {
  if (typeof name !== 'string') {
    throw new TypeError(`getElementProperty: expected property name string`)
  }
  const loc = locatorFor(ctx, elementId)
  return loc.evaluate(
    (el: Element, key: string) => (el as unknown as Record<string, unknown>)[key],
    name,
  )
}

/**
 * GET /session/:sessionId/element/:elementId/displayed
 *
 * Per W3C, isDisplayed should NOT throw on a detached element — it returns
 * false. We skip the freshness check here for that reason.
 *
 * Implementation mirrors Selenium's "is displayed" atom rather than
 * Playwright's `locator.isVisible()`. The key difference: Playwright treats
 * any element with an empty bounding box as not visible, whereas Selenium /
 * chromedriver consider an element displayed if it (or a descendant) is
 * rendered. Some Material components (e.g. mdc-label with display:contents,
 * snackbar containers mid-animation) hit the Playwright path but pass the
 * W3C one — relying on isVisible breaks tests that worked under chromedriver.
 */
export const isElementDisplayed: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  if ((await loc.count()) === 0) return false
  return loc.first().evaluate((el: Element): boolean => {
    let cur: Element | null = el
    while (cur) {
      const s = getComputedStyle(cur)
      if (s.display === 'none') return false
      if (s.visibility === 'hidden' || s.visibility === 'collapse') return false
      cur = cur.parentElement
    }
    const hasRect = (rs: DOMRectList): boolean => {
      for (let i = 0; i < rs.length; i++) {
        const r = rs.item(i)
        if (r && (r.width > 0 || r.height > 0)) return true
      }
      return false
    }
    if (hasRect((el as HTMLElement).getClientRects())) return true
    // Element has no rects of its own (display:contents, empty inline). Walk
    // descendants — if any child renders, parent is considered displayed.
    const queue: Element[] = Array.from(el.children)
    while (queue.length) {
      const c = queue.shift() as Element
      if (hasRect(c.getClientRects())) return true
      for (const child of Array.from(c.children)) queue.push(child)
    }
    return false
  })
}

/**
 * GET /session/:sessionId/element/:elementId/enabled
 */
export const isElementEnabled: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  return loc.isEnabled()
}

/**
 * GET /session/:sessionId/element/:elementId/computedrole
 *
 * Returns the computed WAI-ARIA role per W3C spec. Playwright doesn't expose
 * a native `computedRole` on Locator, so we read explicit `role` attributes
 * first and fall back to a small implicit-role table for the common HTML
 * tags. This matches what Chromium's accessibility tree reports for these
 * elements; full ARIA-mapping spec coverage would require pulling
 * Chromium's a11y tree via CDP, which we deliberately don't do (engine
 * coupling).
 *
 * Unblocks `expect(...).toHaveComputedRole('button')`.
 */
export const getElementComputedRole: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  return loc.evaluate((el: Element) => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    const type = (el as HTMLInputElement).type?.toLowerCase?.() ?? ''
    // Implicit-role table: HTML-AAM sec 5.2 (most common cases). Anything
    // not listed returns '' so callers can disambiguate "no role" from
    // "explicit empty".
    const implicit: Record<string, string> = {
      a: (el as HTMLAnchorElement).href ? 'link' : '',
      article: 'article',
      aside: 'complementary',
      button: 'button',
      datalist: 'listbox',
      dd: 'definition',
      dialog: 'dialog',
      dt: 'term',
      fieldset: 'group',
      figure: 'figure',
      form: 'form',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      header: 'banner',
      hr: 'separator',
      img: el.getAttribute('alt') === '' ? 'presentation' : 'img',
      li: 'listitem',
      main: 'main',
      math: 'math',
      menu: 'list',
      nav: 'navigation',
      ol: 'list',
      option: 'option',
      output: 'status',
      p: 'paragraph',
      progress: 'progressbar',
      section: 'region',
      select: (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox',
      table: 'table',
      tbody: 'rowgroup',
      td: 'cell',
      textarea: 'textbox',
      tfoot: 'rowgroup',
      th: 'columnheader',
      thead: 'rowgroup',
      tr: 'row',
      ul: 'list',
    }
    if (tag === 'input') {
      const inputRoles: Record<string, string> = {
        button: 'button',
        checkbox: 'checkbox',
        email: 'textbox',
        image: 'button',
        number: 'spinbutton',
        radio: 'radio',
        range: 'slider',
        reset: 'button',
        search: 'searchbox',
        submit: 'button',
        tel: 'textbox',
        text: 'textbox',
        url: 'textbox',
      }
      return inputRoles[type] ?? 'textbox'
    }
    return implicit[tag] ?? ''
  })
}

/**
 * GET /session/:sessionId/element/:elementId/computedlabel
 *
 * Returns the accessible name. Order follows ARIA's accessible-name
 * algorithm in priority: aria-labelledby → aria-label → label[for=] →
 * native control text → title. Limited but covers the common cases
 * `expect(...).toHaveComputedLabel('Username')` is used for.
 */
export const getElementComputedLabel: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  return loc.evaluate((el: Element) => {
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const refs = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((n): n is HTMLElement => !!n)
      if (refs.length) return refs.map((n) => n.textContent?.trim() ?? '').join(' ').trim()
    }
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel.trim()
    if (el.id) {
      const lbl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`)
      if (lbl) return (lbl.textContent ?? '').trim()
    }
    const closestLabel = el.closest('label')
    if (closestLabel) return (closestLabel.textContent ?? '').trim()
    if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit' || el.type === 'reset')) {
      return el.value || ''
    }
    if (el instanceof HTMLImageElement && el.alt) return el.alt
    if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) {
      return (el.textContent ?? '').trim()
    }
    const title = el.getAttribute('title')
    if (title) return title.trim()
    return (el.textContent ?? '').trim()
  })
}

/**
 * GET /session/:sessionId/element/:elementId/selected
 */
export const isElementSelected: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  // For input[type=checkbox|radio] this is checked state; for <option> it's
  // selected. Playwright's .isChecked() handles the first; for options we
  // fall back to a DOM check.
  const tag = await loc.evaluate((el: Element) => el.tagName.toLowerCase())
  if (tag === 'option') {
    return loc.evaluate((el: Element) => (el as HTMLOptionElement).selected)
  }
  return loc.isChecked()
}

/**
 * GET /session/:sessionId/element/:elementId/rect
 */
export const getElementRect: CommandHandler = async (ctx, elementId) => {
  const loc = locatorFor(ctx, elementId)
  const box = await loc.boundingBox({ timeout: ctx.session.implicitTimeout })
  if (!box) {
    throw new StaleElementReferenceError('Element has no bounding box (likely detached or display:none)')
  }
  return box
}

/**
 * GET /session/:sessionId/element/:elementId/css/:propertyName
 */
export const getElementCSSValue: CommandHandler = async (ctx, elementId, propertyName) => {
  if (typeof propertyName !== 'string') {
    throw new TypeError(`getElementCSSValue: expected propertyName string`)
  }
  const loc = locatorFor(ctx, elementId)
  return loc.evaluate(
    (el: Element, prop: string) => window.getComputedStyle(el).getPropertyValue(prop),
    propertyName,
  )
}
