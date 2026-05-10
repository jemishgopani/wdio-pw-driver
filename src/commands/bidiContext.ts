import type { Page } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import { InvalidArgumentError, NoSuchWindowError } from '../errors.js'
import { attachDialogListenerToPage } from '../listeners.js'
import { wireBidiEvents } from '../bidi/events.js'
import type { PWSession } from '../types.js'

/**
 * BiDi `browsingContext.*` commands beyond the existing getTree.
 *
 * PW maps "browsing context id" 1:1 to a window handle in
 * `session.pages` — `page-1`, `page-2`, etc. That keeps Classic
 * (switchToWindow) and BiDi (browsingContext.activate) referring to the
 * same logical thing instead of inventing parallel id namespaces.
 *
 * Not implemented (out of v0.1 BiDi scope):
 *   - `browsingContext.captureScreenshot` (takeScreenshot exists in Classic)
 *   - `browsingContext.print` (printPage in Classic)
 *   - `browsingContext.locateNodes` (findElement in Classic)
 *   - `browsingContext.handleUserPrompt` (Classic alert commands cover it)
 *   - `browsingContext.setBypassCSP` (Playwright has no API for this at runtime)
 */

interface ActivateParams {
  context: string
}
interface CreateParams {
  type?: 'tab' | 'window'
  background?: boolean
  referenceContext?: string
}
interface CloseParams {
  context: string
  promptUnload?: boolean
}
interface NavigateParams {
  context: string
  url: string
  wait?: 'none' | 'interactive' | 'complete'
}
interface ReloadParams {
  context: string
  ignoreCache?: boolean
  wait?: 'none' | 'interactive' | 'complete'
}
interface TraverseParams {
  context: string
  delta: number
}
interface SetViewportParams {
  context?: string
  viewport?: { width: number; height: number } | null
  devicePixelRatio?: number | null
}

export const browsingContextActivate: CommandHandler = async ({ session }, body) => {
  const params = unwrap<ActivateParams>(body)
  const page = pageFor(session, params.context)
  await page.bringToFront()
  // PW keeps "current page" in sync with what the user activates so a
  // subsequent Classic command (click, navigateTo, ...) targets the right
  // window without an extra switchToWindow.
  session.currentPage = page
  session.currentFrame = null
  return null
}

export const browsingContextCreate: CommandHandler = async ({ session }, body) => {
  const params = unwrap<CreateParams>(body)
  // BiDi distinguishes 'tab' vs 'window'; Playwright treats both as new
  // pages on the same context. We accept either and create a Page.
  const newPage = await session.context.newPage()
  // Wire the same listeners we install at session creation so dialogs and
  // BiDi events fire on the new tab too.
  attachDialogListenerToPage(session, newPage)
  wireBidiEvents(session, newPage)

  const handle = nextHandle(session)
  session.pages.set(handle, newPage)
  if (!params.background) {
    session.currentPage = newPage
    session.currentFrame = null
  }
  return { context: handle, userContext: 'default' }
}

export const browsingContextClose: CommandHandler = async ({ session }, body) => {
  const params = unwrap<CloseParams>(body)
  const page = pageFor(session, params.context)
  await page.close({ runBeforeUnload: params.promptUnload ?? false })
  // Drop from registry and pick a new current page if we just closed it.
  for (const [handle, p] of session.pages) {
    if (p === page) {
      session.pages.delete(handle)
      break
    }
  }
  if (session.currentPage === page) {
    const next = session.pages.values().next().value
    if (next) {
      session.currentPage = next
      session.currentFrame = null
    }
  }
  return null
}

export const browsingContextNavigate: CommandHandler = async ({ session }, body) => {
  const params = unwrap<NavigateParams>(body)
  if (typeof params.url !== 'string') {
    throw new InvalidArgumentError('browsingContext.navigate: url must be a string')
  }
  const page = pageFor(session, params.context)
  const response = await page.goto(params.url, { waitUntil: mapWait(params.wait) })
  return {
    navigation: response ? `nav-${Date.now().toString(36)}` : null,
    url: page.url(),
  }
}

export const browsingContextReload: CommandHandler = async ({ session }, body) => {
  const params = unwrap<ReloadParams>(body)
  const page = pageFor(session, params.context)
  // Playwright's reload doesn't take ignoreCache; the closest workaround is
  // a navigate-with-cache-bust, which has different semantics. We ignore
  // the flag and warn via doc rather than silently changing the URL.
  await page.reload({ waitUntil: mapWait(params.wait) })
  return null
}

export const browsingContextTraverseHistory: CommandHandler = async ({ session }, body) => {
  const params = unwrap<TraverseParams>(body)
  if (typeof params.delta !== 'number') {
    throw new InvalidArgumentError('browsingContext.traverseHistory: delta must be a number')
  }
  const page = pageFor(session, params.context)
  // BiDi delta is a signed integer; Playwright only supports single-step
  // back/forward. We loop |delta| times in the appropriate direction so
  // callers passing -2 or +3 still get the right result.
  const step = params.delta < 0 ? () => page.goBack() : () => page.goForward()
  const count = Math.abs(params.delta)
  for (let i = 0; i < count; i++) {
    await step()
  }
  return null
}

export const browsingContextSetViewport: CommandHandler = async ({ session }, body) => {
  const params = unwrap<SetViewportParams>(body)
  const page = params.context ? pageFor(session, params.context) : session.currentPage
  if (params.viewport === null || !params.viewport) {
    // BiDi `null` means "reset to default" — Playwright has no resetViewport,
    // so we set to the Playwright default 1280x720 to give an observable
    // change instead of a silent no-op.
    await page.setViewportSize({ width: 1280, height: 720 })
    return null
  }
  await page.setViewportSize({
    width: params.viewport.width,
    height: params.viewport.height,
  })
  return null
}

function pageFor(session: PWSession, contextId: string): Page {
  if (typeof contextId !== 'string' || !contextId) {
    throw new InvalidArgumentError(`browsingContext.*: context must be a non-empty string`)
  }
  const page = session.pages.get(contextId)
  if (!page || page.isClosed()) {
    throw new NoSuchWindowError(`No browsing context with id "${contextId}"`)
  }
  return page
}

function nextHandle(session: PWSession): string {
  let n = session.pages.size + 1
  while (session.pages.has(`page-${n}`)) n++
  return `page-${n}`
}

function mapWait(wait?: 'none' | 'interactive' | 'complete'): 'commit' | 'domcontentloaded' | 'load' {
  if (wait === 'none') return 'commit'
  if (wait === 'complete') return 'load'
  return 'domcontentloaded'
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'params' in (body as object)) {
    return (body as { params: T }).params
  }
  return body as T
}
