import type { CommandHandler } from '../command.js'
import { InvalidArgumentError } from '../errors.js'

/**
 * `pwRouteFromHAR(path, options?)` — replay network responses from a
 * previously recorded HAR file. Wraps `context.routeFromHAR()`.
 *
 * Pairs with the `recordHar` capability:
 *   1. First run captures everything to ./har/run.har via
 *      `wdio:pwOptions.recordHar: { path: './har/run.har' }`.
 *   2. Subsequent runs configure no recordHar and call
 *      `pwRouteFromHAR('./har/run.har')` to replay against the frozen
 *      captures — no real backend required.
 *
 * Options mirror Playwright's:
 *   - `notFound`: 'abort' (default) | 'fallback' — what to do for
 *     un-recorded URLs. 'fallback' lets them hit the real network.
 *   - `update`: when true, missing entries are added to the HAR file
 *     instead of failing. Use during HAR maintenance, not in normal runs.
 *   - `url`: filter — only HAR entries matching this URL pattern apply.
 *   - `updateContent` / `updateMode`: when `update: true`, control the
 *     content storage strategy (embed vs attach) and HAR detail level.
 */

interface RouteFromHarParams {
  path?: string
  notFound?: 'abort' | 'fallback'
  update?: boolean
  url?: string
  updateContent?: 'attach' | 'embed'
  updateMode?: 'full' | 'minimal'
}

export const pwRouteFromHAR: CommandHandler = async ({ session }, body) => {
  const { path, ...options } = parseBody(body)
  if (!path) {
    throw new InvalidArgumentError('pwRouteFromHAR: path is required (e.g. "./har/run.har")')
  }
  await session.context.routeFromHAR(path, options)
  return null
}

function parseBody(body: unknown): RouteFromHarParams {
  // Three accepted shapes:
  //   1. positional string: pwRouteFromHAR('./run.har')   → { path }
  //   2. options-only:      pwRouteFromHAR({ path, ... })
  //   3. tuple via WDIO arg-bag: [path, options?]
  if (typeof body === 'string') return { path: body }
  if (Array.isArray(body)) {
    const [path, opts] = body
    return { path: typeof path === 'string' ? path : undefined, ...((opts as RouteFromHarParams) ?? {}) }
  }
  if (body && typeof body === 'object') return body as RouteFromHarParams
  throw new InvalidArgumentError(
    'pwRouteFromHAR: expected a path string or { path, notFound?, update?, url? }',
  )
}
