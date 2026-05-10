/**
 * Translate Playwright in-process events into W3C WebDriver BiDi event
 * payloads, then dispatch them through the PWSession's BiDi emitter
 * (the WDIO Client). Listeners attached via `browser.on('log.entryAdded',
 * cb)` receive the BiDi-shaped object as their callback argument.
 *
 * Subscription: the pw gates emission on `session.bidi.subscriptions`
 * so we don't pay the (small) cost of building payloads for events nobody
 * is listening to. Per W3C BiDi semantics, events arrive only after the
 * user has called sessionSubscribe with the matching name.
 *
 * Coverage in v0.1:
 *   - log.entryAdded                     — console.* + uncaught page errors
 *   - network.beforeRequestSent          — every outbound HTTP request
 *   - network.responseStarted            — every inbound HTTP response
 *   - browsingContext.navigationStarted  — page.goto / link click
 *   - browsingContext.load               — load event on top frame
 *   - browsingContext.domContentLoaded   — DOMContentLoaded on top frame
 *   - browsingContext.userPromptOpened   — alert/confirm/prompt firing
 *
 * Payload shape follows the W3C spec (https://w3c.github.io/webdriver-bidi/)
 * but only includes the most useful fields. Tests that assert exact spec
 * conformance can extend the translators in this file.
 */
import type { ConsoleMessage, Dialog, Frame, Page, Request, Response } from 'playwright-core'

import type { PWSession } from '../types.js'

/** Context id used in BiDi event payloads. Must match the window-handle scheme
 *  exposed by `commands/window.ts:handleFor` so `browsingContextGetTree` and
 *  the events agree, otherwise WDIO's ContextManager calls switchToWindow with
 *  an id we don't recognize. */
const CONTEXT_PLACEHOLDER = 'page-1'

/** Only do work if at least one listener has subscribed to the event. */
function isSubscribed(session: PWSession, event: string): boolean {
  if (session.bidi.subscriptions.size === 0) return false
  // Allow subscribing to module-level prefixes (e.g. 'network') as well as
  // exact event names — matches W3C semantics.
  if (session.bidi.subscriptions.has(event)) return true
  const dot = event.indexOf('.')
  if (dot > 0 && session.bidi.subscriptions.has(event.slice(0, dot))) return true
  return false
}

function emit(session: PWSession, event: string, payload: unknown): void {
  if (!isSubscribed(session, event)) return
  session.bidi.emitter?.emit(event, payload)
}

/**
 * Wire all BiDi-translatable events on a single Playwright Page. Called for
 * the initial page at session creation and for any future page produced by
 * `context.on('page')`.
 */
export function wireBidiEvents(session: PWSession, page: Page): void {
  page.on('console', (msg) => emit(session, 'log.entryAdded', toLogEntryFromConsole(msg)))
  page.on('pageerror', (err) => emit(session, 'log.entryAdded', toLogEntryFromError(err)))
  page.on('request', (req) => emit(session, 'network.beforeRequestSent', toBeforeRequestSent(req)))
  page.on('response', (res) => emit(session, 'network.responseStarted', toResponseStarted(res)))
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      emit(session, 'browsingContext.navigationStarted', toNavigationStarted(frame))
    }
  })
  page.on('load', () => emit(session, 'browsingContext.load', toLoadEvent(page)))
  page.on('domcontentloaded', () => emit(session, 'browsingContext.domContentLoaded', toLoadEvent(page)))
  page.on('dialog', (dialog) => emit(session, 'browsingContext.userPromptOpened', toUserPrompt(dialog)))
}

/* -------------------------------------------------------------------------- */
/* Translators                                                                */
/* -------------------------------------------------------------------------- */

interface LogEntry {
  type: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: { realm: string; context: string }
  text: string
  timestamp: number
  method?: string
  args?: unknown[]
  stackTrace?: { callFrames: unknown[] }
}

function toLogEntryFromConsole(msg: ConsoleMessage): LogEntry {
  // Playwright's ConsoleMessage.type() returns 'log' | 'debug' | 'info' |
  // 'warning' | 'error' | 'trace' | etc. Map to W3C BiDi level enum.
  const t = msg.type()
  const level: LogEntry['level'] =
    t === 'error' || t === 'assert' ? 'error'
    : t === 'warning' ? 'warn'
    : t === 'debug' || t === 'trace' ? 'debug'
    : 'info'
  return {
    type: 'console',
    level,
    source: { realm: '', context: CONTEXT_PLACEHOLDER },
    text: msg.text(),
    timestamp: Date.now(),
    method: t,
    args: msg.args().map(() => null), // placeholder — full handle marshaling in Phase 5+
  }
}

function toLogEntryFromError(err: Error): LogEntry {
  return {
    type: 'javascript',
    level: 'error',
    source: { realm: '', context: CONTEXT_PLACEHOLDER },
    text: err.message,
    timestamp: Date.now(),
    stackTrace: err.stack
      ? { callFrames: err.stack.split('\n').slice(1).map((line) => ({ url: line })) }
      : undefined,
  }
}

interface BeforeRequestSent {
  context: string
  isBlocked: boolean
  navigation: string | null
  redirectCount: number
  request: {
    request: string
    url: string
    method: string
    headers: Array<{ name: string; value: { type: 'string'; value: string } }>
    cookies: unknown[]
    headersSize: number
    bodySize: number | null
  }
  timestamp: number
  initiator: { type: string }
}

function toBeforeRequestSent(req: Request): BeforeRequestSent {
  const headers = req.headers()
  return {
    context: CONTEXT_PLACEHOLDER,
    isBlocked: false,
    navigation: req.isNavigationRequest() ? 'navigation' : null,
    redirectCount: 0, // Playwright doesn't expose this trivially; default 0.
    request: {
      request: requestId(req),
      url: req.url(),
      method: req.method(),
      headers: Object.entries(headers).map(([name, value]) => ({
        name,
        value: { type: 'string', value },
      })),
      cookies: [],
      headersSize: estimateHeaderSize(headers),
      bodySize: req.postDataBuffer()?.byteLength ?? null,
    },
    timestamp: Date.now(),
    initiator: { type: 'other' },
  }
}

interface ResponseStarted {
  context: string
  isBlocked: boolean
  navigation: string | null
  redirectCount: number
  request: { request: string; url: string }
  response: {
    url: string
    protocol: string
    status: number
    statusText: string
    fromCache: boolean
    headers: Array<{ name: string; value: { type: 'string'; value: string } }>
    mimeType: string | null
    bytesReceived: number
    headersSize: number
    bodySize: number | null
  }
  timestamp: number
}

function toResponseStarted(res: Response): ResponseStarted {
  const req = res.request()
  const headers = res.headers()
  return {
    context: CONTEXT_PLACEHOLDER,
    isBlocked: false,
    navigation: req.isNavigationRequest() ? 'navigation' : null,
    redirectCount: 0,
    request: { request: requestId(req), url: req.url() },
    response: {
      url: res.url(),
      protocol: '',
      status: res.status(),
      statusText: res.statusText(),
      fromCache: false,
      headers: Object.entries(headers).map(([name, value]) => ({
        name,
        value: { type: 'string', value },
      })),
      mimeType: headers['content-type'] ?? null,
      bytesReceived: 0,
      headersSize: estimateHeaderSize(headers),
      bodySize: null,
    },
    timestamp: Date.now(),
  }
}

interface NavigationStarted {
  context: string
  navigation: string
  timestamp: number
  url: string
}

function toNavigationStarted(frame: Frame): NavigationStarted {
  return {
    context: CONTEXT_PLACEHOLDER,
    navigation: '',
    timestamp: Date.now(),
    url: frame.url(),
  }
}

interface LoadEvent {
  context: string
  navigation: string | null
  timestamp: number
  url: string
}

function toLoadEvent(page: Page): LoadEvent {
  return {
    context: CONTEXT_PLACEHOLDER,
    navigation: null,
    timestamp: Date.now(),
    url: page.url(),
  }
}

interface UserPromptOpened {
  context: string
  type: string
  message: string
  defaultValue?: string
}

function toUserPrompt(dialog: Dialog): UserPromptOpened {
  return {
    context: CONTEXT_PLACEHOLDER,
    type: dialog.type(),
    message: dialog.message(),
    defaultValue: dialog.defaultValue(),
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Stable per-request id derived from the Request reference. Playwright doesn't
// expose its internal id; this WeakMap-backed counter is good enough for the
// session lifetime.
const idMap = new WeakMap<Request, string>()
let nextId = 1

function requestId(req: Request): string {
  const cached = idMap.get(req)
  if (cached) return cached
  const id = `pw-req-${nextId++}`
  idMap.set(req, id)
  return id
}

function estimateHeaderSize(headers: Record<string, string>): number {
  return Object.entries(headers).reduce(
    (n, [k, v]) => n + k.length + v.length + 4, // ": " + "\r\n"
    0,
  )
}
