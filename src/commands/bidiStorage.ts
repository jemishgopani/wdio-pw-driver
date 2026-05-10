import type { Cookie as PWCookie } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import { InvalidArgumentError } from '../errors.js'

/**
 * BiDi `storage.*` cookie commands. These are the BiDi-side counterparts to
 * the W3C-Classic getCookies / addCookie / deleteCookie that already exist
 * in commands/cookies.ts — implementing both lets users call whichever
 * branch of WDIO's API surface they reached first.
 *
 * BiDi cookie shape vs. Playwright cookie shape:
 *   - BiDi:  { name, value: { type: 'string', value: 'xyz' }, domain, path, ... }
 *   - PW:    { name, value: 'xyz', domain, path, ... }
 *   - We translate at the boundary so internal storage stays Playwright-shaped.
 */

interface CookieFilter {
  name?: string
  value?: { type: 'string'; value: string }
  domain?: string
  path?: string
}

interface BidiPartialCookie {
  name: string
  value: { type: 'string'; value: string } | string
  domain: string
  path?: string
  expiry?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

interface GetCookiesParams {
  filter?: CookieFilter
}
interface SetCookieParams {
  cookie: BidiPartialCookie
}
interface DeleteCookiesParams {
  filter?: CookieFilter
}

export const storageGetCookies: CommandHandler = async ({ session }, body) => {
  const params = unwrap<GetCookiesParams>(body)
  const all = await session.context.cookies()
  const filtered = applyFilter(all, params.filter)
  return {
    cookies: filtered.map(toBidiCookie),
    partitionKey: { sourceOrigin: defaultOrigin(session.currentPage.url()) },
  }
}

export const storageSetCookie: CommandHandler = async ({ session }, body) => {
  const params = unwrap<SetCookieParams>(body)
  const cookie = params.cookie
  if (!cookie?.name || !cookie?.domain) {
    throw new InvalidArgumentError('storage.setCookie: cookie.name and cookie.domain are required')
  }
  const value = typeof cookie.value === 'string' ? cookie.value : cookie.value?.value
  if (typeof value !== 'string') {
    throw new InvalidArgumentError('storage.setCookie: cookie.value must be a string or { type: "string", value }')
  }
  await session.context.addCookies([
    {
      name: cookie.name,
      value,
      domain: cookie.domain,
      path: cookie.path ?? '/',
      // BiDi expiry is seconds-since-epoch; Playwright expects the same.
      expires: cookie.expiry,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: mapSameSite(cookie.sameSite),
    },
  ])
  return { partitionKey: { sourceOrigin: defaultOrigin(session.currentPage.url()) } }
}

export const storageDeleteCookies: CommandHandler = async ({ session }, body) => {
  const params = unwrap<DeleteCookiesParams>(body)
  if (!params.filter || !filterHasAnyKey(params.filter)) {
    // No filter = delete all — matches Playwright's clearCookies() behavior.
    await session.context.clearCookies()
    return { partitionKey: { sourceOrigin: defaultOrigin(session.currentPage.url()) } }
  }
  // Playwright 1.43+ added clearCookies(filter); older versions silently
  // ignore the filter. We pass it through and let Playwright decide.
  const filter = params.filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = session.context as any
  if (typeof ctx.clearCookies === 'function') {
    await ctx.clearCookies({
      name: filter.name,
      domain: filter.domain,
      path: filter.path,
    })
  }
  return { partitionKey: { sourceOrigin: defaultOrigin(session.currentPage.url()) } }
}

function applyFilter(cookies: PWCookie[], filter: CookieFilter | undefined): PWCookie[] {
  if (!filter || !filterHasAnyKey(filter)) return cookies
  const valueMatch = typeof filter.value === 'string' ? filter.value : filter.value?.value
  return cookies.filter((c) => {
    if (filter.name && c.name !== filter.name) return false
    if (filter.domain && c.domain !== filter.domain) return false
    if (filter.path && c.path !== filter.path) return false
    if (valueMatch !== undefined && c.value !== valueMatch) return false
    return true
  })
}

function filterHasAnyKey(filter: CookieFilter): boolean {
  return Boolean(filter.name || filter.domain || filter.path || filter.value)
}

function toBidiCookie(c: PWCookie): Record<string, unknown> {
  return {
    name: c.name,
    value: { type: 'string', value: c.value },
    domain: c.domain,
    path: c.path,
    size: c.name.length + c.value.length,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: (c.sameSite ?? 'none').toLowerCase(),
    expiry: c.expires === -1 ? undefined : c.expires,
  }
}

function mapSameSite(s?: 'strict' | 'lax' | 'none'): 'Strict' | 'Lax' | 'None' | undefined {
  if (!s) return undefined
  return (s.charAt(0).toUpperCase() + s.slice(1)) as 'Strict' | 'Lax' | 'None'
}

function defaultOrigin(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'params' in (body as object)) {
    return (body as { params: T }).params
  }
  return body as T
}
