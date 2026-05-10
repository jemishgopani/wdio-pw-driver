import type { Request, Response } from 'playwright-core'

import type { CommandHandler } from '../command.js'

/**
 * PW-specific network-event waiters. Wrap Playwright's
 * `page.waitForRequest` / `page.waitForResponse` so a WDIO test can pause
 * until a specific URL pattern is observed on the wire.
 *
 * The pattern is a string OR a regex (sent as `{ source, flags }` so it
 * survives the JSON serialization the WDIO command pipeline puts every
 * arg through). A function predicate isn't supported — same constraint
 * as `pwRoute`: closures can't cross the wire.
 *
 * Returns a JSON snapshot of the matched request/response so the test
 * can assert against URL, method, status, headers — without holding a
 * live Playwright object reference (which would dangle once the page
 * navigates).
 */

interface PatternSpec {
  /** Plain substring/glob string. */
  url?: string
  /** Regex source + flags, used when the test wants pattern matching. */
  regex?: { source: string; flags?: string }
  /** Optional timeout in ms. Defaults to the session implicit timeout. */
  timeout?: number
}

interface RequestSnapshot {
  url: string
  method: string
  resourceType: string
  headers: Record<string, string>
  postData: string | null
}

interface ResponseSnapshot {
  url: string
  status: number
  statusText: string
  headers: Record<string, string>
  request: RequestSnapshot
}

function buildPredicate(pattern: PatternSpec | string): {
  match: string | RegExp
  timeout: number | undefined
} {
  if (typeof pattern === 'string') {
    return { match: pattern, timeout: undefined }
  }
  if (pattern.regex) {
    return {
      match: new RegExp(pattern.regex.source, pattern.regex.flags ?? ''),
      timeout: pattern.timeout,
    }
  }
  if (typeof pattern.url === 'string') {
    return { match: pattern.url, timeout: pattern.timeout }
  }
  throw new TypeError('pwWaitForRequest/Response: pattern must be a string, {url}, or {regex}')
}

function snapshotRequest(req: Request): RequestSnapshot {
  return {
    url: req.url(),
    method: req.method(),
    resourceType: req.resourceType(),
    headers: req.headers(),
    postData: req.postData(),
  }
}

async function snapshotResponse(res: Response): Promise<ResponseSnapshot> {
  return {
    url: res.url(),
    status: res.status(),
    statusText: res.statusText(),
    headers: res.headers(),
    request: snapshotRequest(res.request()),
  }
}

/**
 * Wait until a request matching `pattern` is sent. Returns a JSON snapshot.
 */
export const pwWaitForRequest: CommandHandler = async ({ session }, pattern) => {
  const { match, timeout } = buildPredicate(pattern as PatternSpec | string)
  const req = await session.currentPage.waitForRequest(match, {
    timeout: timeout ?? session.defaultTimeout,
  })
  return snapshotRequest(req)
}

/**
 * Wait until a response matching `pattern` arrives. Returns a JSON snapshot.
 */
export const pwWaitForResponse: CommandHandler = async ({ session }, pattern) => {
  const { match, timeout } = buildPredicate(pattern as PatternSpec | string)
  const res = await session.currentPage.waitForResponse(match, {
    timeout: timeout ?? session.defaultTimeout,
  })
  return snapshotResponse(res)
}
