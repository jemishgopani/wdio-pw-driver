import { randomUUID } from 'node:crypto'

import type { Page } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import { InvalidArgumentError, NoSuchWindowError } from '../errors.js'
import type { PWSession } from '../types.js'

/**
 * BiDi `script.*` commands.
 *
 * These wrap Playwright's page.evaluate / context.addInitScript and reshape
 * inputs/outputs to look like the W3C BiDi wire format that WDIO's BiDi
 * helpers (`browser.addInitScript()`, `browser.executeAsync()` in BiDi mode)
 * expect.
 *
 * Trade-offs vs. the spec:
 *   - `realm` targeting is normalized to "the current page's main realm"
 *     because PW doesn't track realm ids separately yet. That covers
 *     the WDIO call sites; users that depend on cross-realm semantics need
 *     the standalone Playwright API.
 *   - `script.removePreloadScript` is a soft no-op (returns success but
 *     can't actually un-register an init script — Playwright has no API
 *     for it). Documented in the handler.
 *   - `arguments` for callFunction are unsupported in v0.1; we only run
 *     the bare function declaration. Throws if `arguments` is non-empty so
 *     users don't get silent wrong behavior.
 */

interface BidiScriptTarget {
  context?: string
  realm?: string
}

interface BidiAddPreloadParams {
  functionDeclaration: string
  arguments?: unknown[]
  contexts?: string[]
  sandbox?: string
}

interface BidiRemovePreloadParams {
  script: string
}

interface BidiEvaluateParams {
  expression: string
  target: BidiScriptTarget
  awaitPromise: boolean
}

interface BidiCallFunctionParams {
  functionDeclaration: string
  awaitPromise: boolean
  target: BidiScriptTarget
  arguments?: unknown[]
  this?: unknown
}

/**
 * Track preload scripts by id so removePreloadScript has something to look
 * up. Playwright has no real removal API — the entry stays, but at least
 * we report "I knew about that id" instead of a confusing error.
 */
function ensurePreloadRegistry(session: PWSession): Map<string, string> {
  const reg = (session as PWSession & { _preloadScripts?: Map<string, string> })._preloadScripts
  if (reg) return reg
  const next = new Map<string, string>()
  ;(session as PWSession & { _preloadScripts?: Map<string, string> })._preloadScripts = next
  return next
}

export const scriptAddPreloadScript: CommandHandler = async ({ session }, body) => {
  const params = unwrap<BidiAddPreloadParams>(body)
  if (typeof params.functionDeclaration !== 'string') {
    throw new InvalidArgumentError('script.addPreloadScript: functionDeclaration must be a string')
  }
  if (params.arguments?.length) {
    // Channel-value arguments are part of the BiDi spec but rarely used in
    // WDIO call sites. Failing loudly is better than silently dropping them.
    throw new InvalidArgumentError(
      'script.addPreloadScript: `arguments` is not supported in PW v0.1; ' +
      'inline literal values into the function body instead',
    )
  }

  // Playwright's addInitScript takes either a path or `{ content: string }`.
  // We wrap the function declaration in an IIFE so the user's code runs at
  // every navigation, before any page scripts.
  const content = `(${params.functionDeclaration})()`
  await session.context.addInitScript({ content })

  const id = randomUUID()
  ensurePreloadRegistry(session).set(id, content)
  return { script: id }
}

export const scriptRemovePreloadScript: CommandHandler = async ({ session }, body) => {
  const params = unwrap<BidiRemovePreloadParams>(body)
  const reg = ensurePreloadRegistry(session)
  if (!reg.has(params.script)) {
    throw new InvalidArgumentError(
      `script.removePreloadScript: unknown script id "${params.script}"`,
    )
  }
  reg.delete(params.script)
  // Playwright has no removeInitScript API — the script will still run on
  // future navigations until the BrowserContext is recycled (e.g. via
  // pwNewContext). We accept this as a soft no-op and document it.
  return null
}

export const scriptEvaluate: CommandHandler = async ({ session }, body) => {
  const params = unwrap<BidiEvaluateParams>(body)
  if (typeof params.expression !== 'string') {
    throw new InvalidArgumentError('script.evaluate: expression must be a string')
  }
  const page = resolveTargetPage(session, params.target)
  // BiDi has explicit awaitPromise semantics; Playwright's evaluate already
  // awaits returned thenables, so awaitPromise: true is the natural path.
  // For awaitPromise: false we wrap the value to prevent auto-await.
  const expr = params.awaitPromise
    ? `(async () => (${params.expression}))()`
    : `(() => { const __r = (${params.expression}); return __r && typeof __r.then === 'function' ? '<Promise>' : __r })()`
  const value = await page.evaluate(expr)
  return {
    type: 'success',
    result: serializeRemoteValue(value),
    realm: realmIdFor(page),
  }
}

export const scriptCallFunction: CommandHandler = async ({ session }, body) => {
  const params = unwrap<BidiCallFunctionParams>(body)
  if (typeof params.functionDeclaration !== 'string') {
    throw new InvalidArgumentError('script.callFunction: functionDeclaration must be a string')
  }
  if (params.arguments?.length) {
    throw new InvalidArgumentError(
      'script.callFunction: `arguments` (BiDi LocalValue list) is not supported in PW v0.1; ' +
      'inline literal values into the function body instead',
    )
  }
  const page = resolveTargetPage(session, params.target)
  // Build an IIFE that defines + invokes the supplied function declaration.
  // awaitPromise wraps an extra async layer; without it we need to detect
  // and reject Promise returns the same way scriptEvaluate does.
  const inner = `(${params.functionDeclaration})()`
  const expr = params.awaitPromise
    ? `(async () => ${inner})()`
    : `(() => { const __r = ${inner}; return __r && typeof __r.then === 'function' ? '<Promise>' : __r })()`
  const value = await page.evaluate(expr)
  return {
    type: 'success',
    result: serializeRemoteValue(value),
    realm: realmIdFor(page),
  }
}

/**
 * Look up the page a target points at. BiDi target is `{ context: <id> }` or
 * `{ realm: <id> }`. PW's window handles double as context ids; realms
 * are mapped 1:1 to the main frame of the matching context (we don't
 * support sandbox/iframe realms separately yet).
 */
function resolveTargetPage(session: PWSession, target: BidiScriptTarget | undefined): Page {
  if (!target) return session.currentPage
  const handle = target.context ?? extractContextFromRealm(target.realm)
  if (!handle) return session.currentPage
  const page = session.pages.get(handle)
  if (!page || page.isClosed()) {
    throw new NoSuchWindowError(`No browsing context with id "${handle}"`)
  }
  return page
}

function extractContextFromRealm(realm?: string): string | undefined {
  if (!realm) return undefined
  // Realm ids we mint look like `<contextHandle>:main`; strip the suffix.
  const idx = realm.indexOf(':')
  return idx > 0 ? realm.slice(0, idx) : realm
}

function realmIdFor(page: Page): string {
  // We don't have a real realm registry — just return a synthetic id stable
  // for the page so callers can correlate result/event pairs.
  const tag = (page as Page & { _pwRealm?: string })._pwRealm
  if (tag) return tag
  const next = `${randomUUID()}:main`
  ;(page as Page & { _pwRealm?: string })._pwRealm = next
  return next
}

/**
 * Wrap a JS value in BiDi `RemoteValue` shape. This is a best-effort
 * serializer covering primitives, arrays, plain objects, null/undefined,
 * and Date. Anything we can't classify becomes `{ type: 'object', value: [] }`
 * so the wire stays well-formed.
 */
function serializeRemoteValue(value: unknown): { type: string; value?: unknown } {
  if (value === null) return { type: 'null' }
  if (value === undefined) return { type: 'undefined' }
  if (typeof value === 'string') return { type: 'string', value }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'NaN' }
    if (value === Infinity) return { type: 'number', value: 'Infinity' }
    if (value === -Infinity) return { type: 'number', value: '-Infinity' }
    return { type: 'number', value }
  }
  if (typeof value === 'boolean') return { type: 'boolean', value }
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() }
  if (Array.isArray(value)) {
    return { type: 'array', value: value.map((v) => serializeRemoteValue(v)) }
  }
  if (value instanceof Date) {
    return { type: 'date', value: value.toISOString() }
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      value: Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        { type: 'string', value: k },
        serializeRemoteValue(v),
      ]) as unknown,
    }
  }
  return { type: 'string', value: String(value) }
}

function unwrap<T>(body: unknown): T {
  // WDIO's BiDi pw sends `{ params: {...} }`; some callers pass the
  // params directly. Accept both shapes.
  if (body && typeof body === 'object' && 'params' in (body as object)) {
    return (body as { params: T }).params
  }
  return body as T
}
