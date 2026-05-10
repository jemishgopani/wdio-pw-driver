import type { CommandHandler } from '../command.js'
import { WebDriverError } from '../errors.js'

/**
 * POST /session/:sessionId/print   body: { ...PrintParameters }
 *
 * Returns base64-encoded PDF of the current page. Per W3C, supported options
 * include orientation, scale, background, page (size + margin), pageRanges,
 * shrinkToFit. We translate the documented subset to Playwright's `page.pdf`.
 *
 * Engine support: Playwright's page.pdf() is **Chromium-only**. Firefox and
 * WebKit raise an error; we surface that as a clear unsupported-operation.
 */
export const printPage: CommandHandler = async ({ session }, options) => {
  const opts = (options ?? {}) as W3CPrintOptions

  try {
    const buf = await session.currentPage.pdf({
      landscape: opts.orientation === 'landscape',
      scale: clampScale(opts.scale),
      printBackground: opts.background === true,
      pageRanges: Array.isArray(opts.pageRanges) ? opts.pageRanges.join(',') : undefined,
      preferCSSPageSize: opts.shrinkToFit === false,
      width: opts.page?.width ? `${opts.page.width}cm` : undefined,
      height: opts.page?.height ? `${opts.page.height}cm` : undefined,
      margin: opts.margin
        ? {
            top: `${opts.margin.top ?? 1}cm`,
            bottom: `${opts.margin.bottom ?? 1}cm`,
            left: `${opts.margin.left ?? 1}cm`,
            right: `${opts.margin.right ?? 1}cm`,
          }
        : undefined,
    })
    return buf.toString('base64')
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    if (/only supported in headless chromium|page\.pdf.*supported/i.test(msg)) {
      throw new WebDriverError(
        'unsupported operation',
        `printPage requires headless Chromium; current engine "${session.capabilities.browserName}" does not support PDF generation`,
      )
    }
    throw err
  }
}

interface W3CPrintOptions {
  orientation?: 'portrait' | 'landscape'
  scale?: number
  background?: boolean
  pageRanges?: string[]
  shrinkToFit?: boolean
  page?: { width?: number; height?: number }
  margin?: { top?: number; bottom?: number; left?: number; right?: number }
}

function clampScale(s: unknown): number | undefined {
  if (typeof s !== 'number' || !Number.isFinite(s)) return undefined
  // W3C requires 0.1..2; Playwright same.
  return Math.max(0.1, Math.min(2, s))
}
