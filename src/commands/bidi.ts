import type { CommandHandler } from '../command.js'

/**
 * BiDi session.subscribe / session.unsubscribe.
 *
 * In the W3C protocol these are top-level BiDi commands sent over the
 * WebSocket; in WDIO they're surfaced on the client as `sessionSubscribe` /
 * `sessionUnsubscribe`. PW has no real WebSocket — the pw in
 * src/bidi/events.ts emits directly on the client EventEmitter — but we still
 * gate emission on the subscription set so users only see events they asked
 * for. This matches W3C semantics and avoids paying the (small) per-event
 * cost when nobody is listening.
 *
 * `events`: array of strings. May be a full event name (`log.entryAdded`)
 * or a module-level prefix (`log`) which subscribes to every event in that
 * module. Unknown names are accepted (forward-compat).
 *
 * `contexts`: optional array of browsing-context ids to scope the
 * subscription. PW currently emits every event for every context, so
 * we accept and ignore this field.
 */
export const sessionSubscribe: CommandHandler = async ({ session }, body) => {
  const events = extractEvents(body)
  for (const e of events) {
    session.bidi.subscriptions.add(e)
  }
  return null
}

export const sessionUnsubscribe: CommandHandler = async ({ session }, body) => {
  const events = extractEvents(body)
  for (const e of events) {
    session.bidi.subscriptions.delete(e)
  }
  return null
}

/**
 * GET browsingContext.getTree — WDIO's auto-installed ContextManager calls
 * this whenever a `browsingContext.navigationStarted` event fires, to map
 * BiDi context ids to its own internal frame tree. Without it, the manager
 * throws and Vitest flags an unhandled rejection.
 *
 * PW currently uses a single placeholder context id ("top"); we report
 * a one-node tree pointing at the current page URL. Phase 7 will track real
 * Playwright frame ids if/when WDIO needs more granular context info.
 */
export const browsingContextGetTree: CommandHandler = async ({ session }) => {
  // The `context` id we report MUST match the window handle WDIO would later
  // pass to `switchToWindow`, because ContextManager flows tree → handle.
  // PW's window handles look like "page-1"; reusing them here keeps the
  // ContextManager round-trip self-consistent.
  //
  // Guard against the close-race: WDIO's ContextManager can fire its handler
  // shortly after deleteSession, which closes the page. Reading `.url()` or
  // a closed page throws; return an empty tree instead.
  if (session.currentPage.isClosed()) {
    return { contexts: [] }
  }
  let url = ''
  let handle = 'page-1'
  try {
    url = session.currentPage.url()
    for (const [id, p] of session.pages) {
      if (p === session.currentPage) {
        handle = id
        break
      }
    }
  } catch {
    /* page closed mid-call */
  }
  return {
    contexts: [
      {
        context: handle,
        url,
        userContext: 'default',
        children: [],
      },
    ],
  }
}

function extractEvents(body: unknown): string[] {
  // Accept either { events: [...] } (W3C body shape) or a bare array
  // (WDIO sometimes spreads positional args). Reject anything else.
  if (Array.isArray(body)) {
    return body.filter((e): e is string => typeof e === 'string')
  }
  if (body && typeof body === 'object') {
    const list = (body as { events?: unknown }).events
    if (Array.isArray(list)) {
      return list.filter((e): e is string => typeof e === 'string')
    }
  }
  throw new TypeError(
    'sessionSubscribe/sessionUnsubscribe: expected { events: string[] } or string[]',
  )
}
