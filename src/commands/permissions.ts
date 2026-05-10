import type { CommandHandler } from '../command.js'
import { InvalidArgumentError } from '../errors.js'

/**
 * PW runtime context-mutation commands. These wrap Playwright's
 * BrowserContext methods that change behavior mid-session — permissions,
 * geolocation, extra HTTP headers, offline mode. Equivalent to what
 * `@playwright/test` users do via fixtures or `test.use({...})`.
 *
 * All five mutate the *current* BrowserContext, so calling
 * `pwNewContext()` resets them. If you need them on every fresh
 * context, set them in a beforeEach after the rotation.
 */

interface GrantParams {
  permissions?: string[]
  origin?: string
}

interface GeoParams {
  latitude?: number
  longitude?: number
  accuracy?: number
}

/**
 * `pwGrantPermissions(['geolocation', 'notifications'], { origin? })`
 *
 * PW accepts either a bare array (most common WDIO call shape) or the
 * BiDi-flavored `{ permissions: [...], origin: '...' }` envelope so callers
 * can mix and match. Origin is optional — Playwright defaults to the
 * context's default origin when omitted.
 */
export const pwGrantPermissions: CommandHandler = async ({ session }, body) => {
  const { permissions, origin } = parseGrantBody(body)
  if (!permissions.length) {
    throw new InvalidArgumentError(
      'pwGrantPermissions: permissions array is required (e.g. ["geolocation"])',
    )
  }
  await session.context.grantPermissions(permissions, origin ? { origin } : undefined)
  return null
}

/**
 * `pwClearPermissions()` — drop every permission previously granted on
 * this context. No-op if nothing was granted. Useful between phases of a
 * single spec when you want to re-test the unauthorized path.
 */
export const pwClearPermissions: CommandHandler = async ({ session }) => {
  await session.context.clearPermissions()
  return null
}

/**
 * `pwSetGeolocation({ latitude, longitude, accuracy? })`
 *
 * Pass `null` to reset to "no override" (browser uses real geolocation,
 * which in headless typically returns nothing). Caller must have already
 * granted the `geolocation` permission via pwGrantPermissions, otherwise
 * `navigator.geolocation` requests will be denied at the page level.
 */
export const pwSetGeolocation: CommandHandler = async ({ session }, body) => {
  const geo = parseGeoBody(body)
  if (geo === null) {
    // Playwright accepts `null` to clear the override; pass through.
    await session.context.setGeolocation(null)
    return null
  }
  if (typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') {
    throw new InvalidArgumentError(
      'pwSetGeolocation: latitude and longitude must both be numbers (or pass null to reset)',
    )
  }
  await session.context.setGeolocation(geo as { latitude: number; longitude: number; accuracy?: number })
  return null
}

/**
 * `pwSetExtraHeaders({ 'x-trace-id': 'abc' })`
 *
 * Replaces the entire extra-headers map (Playwright's API isn't additive).
 * To remove all extras, pass an empty object. Headers apply to every request
 * the context makes from this point onward, including subresources.
 */
export const pwSetExtraHeaders: CommandHandler = async ({ session }, body) => {
  const headers = parseHeadersBody(body)
  await session.context.setExtraHTTPHeaders(headers)
  return null
}

/**
 * `pwSetOffline(true|false)` — toggle the BrowserContext's offline mode.
 * Equivalent to the capability `offline: true` but mutable mid-session.
 * Useful for testing offline UX (banners, retry logic, SW cache fallbacks)
 * without restarting the session.
 */
export const pwSetOffline: CommandHandler = async ({ session }, body) => {
  const flag = parseOfflineBody(body)
  await session.context.setOffline(flag)
  return null
}

/* -------------------------------------------------------------------------- */
/* Body parsing                                                               */
/* -------------------------------------------------------------------------- */

function parseGrantBody(body: unknown): { permissions: string[]; origin?: string } {
  if (Array.isArray(body)) {
    return { permissions: body.filter((p): p is string => typeof p === 'string') }
  }
  if (body && typeof body === 'object') {
    const b = body as GrantParams
    if (Array.isArray(b.permissions)) {
      return {
        permissions: b.permissions.filter((p): p is string => typeof p === 'string'),
        origin: typeof b.origin === 'string' ? b.origin : undefined,
      }
    }
  }
  throw new InvalidArgumentError(
    'pwGrantPermissions: expected array or { permissions: string[], origin?: string }',
  )
}

function parseGeoBody(body: unknown): GeoParams | null {
  if (body === null) return null
  if (body && typeof body === 'object') {
    const b = body as GeoParams
    return {
      latitude: b.latitude,
      longitude: b.longitude,
      accuracy: b.accuracy,
    }
  }
  throw new InvalidArgumentError(
    'pwSetGeolocation: expected { latitude, longitude, accuracy? } or null',
  )
}

function parseHeadersBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') {
    throw new InvalidArgumentError(
      'pwSetExtraHeaders: expected a plain object of header name/value pairs',
    )
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new InvalidArgumentError(
        `pwSetExtraHeaders: header "${k}" value must be a string (got ${typeof v})`,
      )
    }
    out[k] = v
  }
  return out
}

function parseOfflineBody(body: unknown): boolean {
  if (typeof body === 'boolean') return body
  if (body && typeof body === 'object' && 'offline' in body) {
    const v = (body as { offline: unknown }).offline
    if (typeof v === 'boolean') return v
  }
  throw new InvalidArgumentError(
    'pwSetOffline: expected a boolean or { offline: boolean }',
  )
}
