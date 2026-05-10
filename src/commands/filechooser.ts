import type { CommandHandler } from '../command.js'

/**
 * One-shot file-chooser arming. Some apps trigger the native OS file
 * dialog via JS (`new File()` + click on a hidden input, `<a download>`,
 * etc.) where the file input element isn't directly addressable. For
 * those cases, the only reliable upload path is to attach a listener to
 * Playwright's `filechooser` event BEFORE the action that opens the
 * dialog.
 *
 * Usage:
 *   await browser.pwOnFileChooser(['/abs/path.csv'])
 *   await $('#open-picker').click()         // chooser opens, gets file
 *
 * Or to reject the next chooser:
 *   await browser.pwOnFileChooser(null)
 *   await $('#open-picker').click()         // chooser opens, gets canceled
 *
 * The handler is `page.once`-style — it auto-disarms after one chooser
 * fires. Re-arm before each subsequent open. If no chooser opens, the
 * listener is GC'd along with the page on session close.
 */
export const pwOnFileChooser: CommandHandler = async ({ session }, payload) => {
  // `payload` shape: string[] | null. Anything else is a typo.
  const isFileList = Array.isArray(payload) && payload.every((p) => typeof p === 'string')
  const isCancel = payload === null
  if (!isFileList && !isCancel) {
    throw new TypeError(
      'pwOnFileChooser: expected string[] (paths to upload) or null (to cancel the chooser)',
    )
  }

  session.currentPage.once('filechooser', (chooser) => {
    if (isCancel) {
      // Playwright doesn't have a cancel API; setting an empty file list
      // is the closest equivalent. The chooser closes without delivering
      // files. (Most apps treat this as "user pressed Cancel".)
      void chooser.setFiles([]).catch(() => {})
    } else {
      void chooser.setFiles(payload as string[]).catch(() => {})
    }
  })
  return null
}
