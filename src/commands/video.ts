import type { CommandHandler } from '../command.js'
import { InvalidArgumentError } from '../errors.js'

/**
 * `pwGetVideo()` — return the saved video file path for the current
 * page. Only meaningful when `wdio:pwOptions.recordVideo` was set in
 * capabilities.
 *
 * Caveat (Playwright behavior): the video is saved only once the page is
 * closed. While the page is still open, this command returns the *eventual*
 * path Playwright will write to. Call from an `afterEach` *after*
 * `pwNewContext()` (which closes the old page and finalizes its video)
 * or after `deleteSession()` if you want a fully written file.
 *
 * Returns `{ path: string | null }`. Null when recording is off or the
 * current page has no video object (e.g. about:blank pre-navigate).
 */
export const pwGetVideo: CommandHandler = async ({ session }) => {
  const video = session.currentPage.video()
  if (!video) return { path: null }
  // `video.path()` resolves with the eventual file path; doesn't await
  // the file being flushed to disk. That happens at page-close time.
  const path = await video.path()
  return { path }
}

interface SaveVideoBody {
  path?: string
}

/**
 * `pwSaveVideo(path)` — save the current page's video to a user-specified
 * path. Wraps Playwright's `page.video().saveAs(path)`.
 *
 * Important behavior (per Playwright docs): saveAs() **waits for the page
 * to close** before resolving. Use it together with `pwNewContext()` or
 * `deleteSession()` so the close actually happens — calling it without
 * arranging a close means it hangs until the test timeout.
 *
 * Recommended pattern in `afterTest` for video-on-failure (see
 * `pw-demo/wdio.video-on-failure.conf.ts`):
 *
 *   const savePromise = browser.pwSaveVideo(`./videos/${name}.webm`)
 *   await browser.pwNewContext()       // closes the page → unblocks saveAs
 *   await savePromise
 *
 * Returns `{ path }` (the absolute path written) or `{ path: null }` when
 * recording is off.
 */
export const pwSaveVideo: CommandHandler = async ({ session }, body) => {
  const target = parsePath(body)
  if (!target) {
    throw new InvalidArgumentError('pwSaveVideo: path is required (e.g. "./videos/test-name.webm")')
  }
  const video = session.currentPage.video()
  if (!video) return { path: null }
  await video.saveAs(target)
  return { path: target }
}

function parsePath(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (Array.isArray(body) && typeof body[0] === 'string') return body[0]
  if (body && typeof body === 'object' && typeof (body as SaveVideoBody).path === 'string') {
    return (body as SaveVideoBody).path
  }
  return undefined
}
