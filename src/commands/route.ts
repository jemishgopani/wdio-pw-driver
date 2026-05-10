import type { CommandHandler } from '../command.js'

/**
 * PW-specific network mocking. Wraps Playwright's `context.route()` but
 * exposes a data-driven response spec instead of a JS handler function —
 * functions can't cross the WebDriver wire as JSON, so the user passes the
 * full response shape and PW synthesizes the handler on the Node side.
 *
 * Covers the common mocking cases: canned response (status + body + headers)
 * and abort (network error). For dynamic/per-request logic (rewrite headers,
 * proxy a real response), users should call PW's standalone API
 * directly via `PWDriver.newSession()` and use the underlying engine
 * APIs — not exposed through this command.
 */

interface MockResponse {
  /** HTTP status. Default: 200. */
  status?: number
  /** Response body. String or JSON-serializable object (auto-serialized). */
  body?: string | Record<string, unknown> | unknown[]
  /** Content type. Default inferred: 'application/json' for object body, 'text/plain' otherwise. */
  contentType?: string
  /** Custom response headers. */
  headers?: Record<string, string>
  /**
   * If set, abort the request with this Playwright error code instead of
   * fulfilling. Common values: 'failed', 'aborted', 'timedout',
   * 'connectionrefused'. See Playwright Route#abort.
   */
  abort?: string
}

/**
 * PW `pwRoute(pattern, response)` — register a mock for any
 * request matching `pattern`. The pattern uses Playwright's URL match
 * syntax (glob with `*` and `**`, or a regex string starting with `^`).
 *
 *   await browser.pwRoute('**\/api/users', {
 *     status: 200,
 *     body: { users: [{ id: 1, name: 'jemish' }] },
 *   })
 *
 *   await browser.pwRoute('**\/analytics/**', { abort: 'failed' })
 *
 * Routes accumulate — call multiple times for different patterns.
 * Use `pwUnroute(pattern)` to remove a registration.
 */
export const pwRoute: CommandHandler = async ({ session }, pattern, response) => {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new TypeError('pwRoute: expected non-empty pattern string')
  }
  const spec = (response ?? {}) as MockResponse

  await session.context.route(pattern, async (route) => {
    if (spec.abort) {
      await route.abort(spec.abort as Parameters<typeof route.abort>[0])
      return
    }

    // Auto-serialize objects to JSON, default content type accordingly.
    let body: string | undefined
    let contentType = spec.contentType
    if (spec.body == null) {
      body = undefined
    } else if (typeof spec.body === 'string') {
      body = spec.body
    } else {
      body = JSON.stringify(spec.body)
      contentType = contentType ?? 'application/json'
    }

    await route.fulfill({
      status: spec.status ?? 200,
      body,
      contentType,
      headers: spec.headers,
    })
  })
  return null
}

/**
 * PW `pwUnroute(pattern)` — remove a previously-registered mock
 * for the given pattern. Does nothing if no route is registered.
 */
export const pwUnroute: CommandHandler = async ({ session }, pattern) => {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new TypeError('pwUnroute: expected non-empty pattern string')
  }
  await session.context.unroute(pattern)
  return null
}
