import type { CommandHandler } from '../command.js'
import { WebDriverError } from '../errors.js'

/**
 * Translate Playwright Cookie objects into the W3C Cookie shape WDIO expects.
 * The two share most fields; the main differences are `expiry` (ms vs s) and
 * `sameSite` casing.
 */
function toW3C(c: {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expiry: c.expires > 0 ? Math.floor(c.expires) : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }
}

function toPW(cookie: {
  name: string
  value: string
  domain?: string
  path?: string
  expiry?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None' | 'strict' | 'lax' | 'none'
  url?: string
}) {
  // Playwright requires either a URL or a domain+path pair. Honor whatever
  // the caller provides; default to the current page URL otherwise.
  const sameSiteRaw = cookie.sameSite
  const sameSite =
    sameSiteRaw === 'strict' || sameSiteRaw === 'Strict'
      ? 'Strict'
      : sameSiteRaw === 'lax' || sameSiteRaw === 'Lax'
        ? 'Lax'
        : sameSiteRaw === 'none' || sameSiteRaw === 'None'
          ? 'None'
          : undefined

  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expiry,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite,
    url: cookie.url,
  }
}

/**
 * GET /session/:sessionId/cookie
 */
export const getAllCookies: CommandHandler = async ({ session }) => {
  const cookies = await session.context.cookies()
  return cookies.map(toW3C)
}

/**
 * GET /session/:sessionId/cookie/:name
 *
 * W3C: must throw `'no such cookie'` when the named cookie isn't present.
 * Stock chromedriver returns 404 with that error code; webdriver-package
 * does NOT have a success-on-404 special case for cookies (the only
 * lowercase-error 404 it treats as success is `'no such element'` —
 * see webdriver/build/node.js:1376), so the caller needs an actual
 * thrown error to detect the miss. Returning null here would silently
 * diverge from chromedriver behavior.
 */
export const getNamedCookie: CommandHandler = async ({ session }, name) => {
  if (typeof name !== 'string') {
    throw new TypeError(`getNamedCookie: expected name string, got ${typeof name}`)
  }
  const cookies = await session.context.cookies()
  const found = cookies.find((c) => c.name === name)
  if (!found) {
    throw new WebDriverError('no such cookie', `No cookie with name "${name}"`)
  }
  return toW3C(found)
}

/**
 * POST /session/:sessionId/cookie   body: { cookie }
 */
export const addCookie: CommandHandler = async ({ session }, cookie) => {
  const c = (cookie ?? {}) as Parameters<typeof toPW>[0]
  // If no domain/url, anchor the cookie to the current page URL.
  const pwCookie = toPW(c)
  if (!pwCookie.url && !pwCookie.domain) {
    pwCookie.url = session.currentPage.url()
  }
  await session.context.addCookies([pwCookie as Parameters<typeof session.context.addCookies>[0][number]])
  return null
}

/**
 * DELETE /session/:sessionId/cookie/:name
 *
 * Playwright's clearCookies supports a name filter directly.
 */
export const deleteCookie: CommandHandler = async ({ session }, name) => {
  if (typeof name !== 'string') {
    throw new TypeError('deleteCookie: expected name string')
  }
  await session.context.clearCookies({ name })
  return null
}

/**
 * DELETE /session/:sessionId/cookie
 */
export const deleteAllCookies: CommandHandler = async ({ session }) => {
  await session.context.clearCookies()
  return null
}
