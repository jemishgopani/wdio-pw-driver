import type { BrowserContext, Page } from 'playwright-core'

import { wireBidiEvents } from './bidi/events.js'
import type { PWSession } from './types.js'

/**
 * Attach the dialog listener to a Page. Captures dialogs into the session's
 * snapshot state and *immediately* accepts/dismisses (per
 * session.dialogs.nextAction) so the page never blocks. See driver.ts
 * comment block on why we don't follow the W3C-reactive model.
 */
export function attachDialogListenerToPage(session: PWSession, page: Page): void {
  page.on('dialog', async (dialog) => {
    session.dialogs.pending = {
      type: dialog.type() as 'alert' | 'beforeunload' | 'confirm' | 'prompt',
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    }
    const action = session.dialogs.nextAction
    const text = session.dialogs.pendingText
    session.dialogs.nextAction = 'accept'
    session.dialogs.pendingText = undefined
    try {
      if (action === 'dismiss') await dialog.dismiss()
      else await dialog.accept(text)
    } catch {
      /* dialog already handled (page closed, etc.) */
    }
  })
}

/**
 * Wire dialog + BiDi listeners on the current page and on any future page
 * the context creates, plus a browser-close safety hook on the context
 * itself. Used both at session creation and after a context rotation via
 * `pwNewContext` — replacing the context drops the old listeners; this
 * function re-attaches them on the new one.
 *
 * The "context closed → browser.close()" hook keeps Node from hanging on
 * the engine subprocess if Chromium dies. `pwNewContext` removes this
 * listener before its intentional close so the rotation doesn't kill the
 * whole browser.
 */
export function attachContextListeners(session: PWSession, ctx: BrowserContext): void {
  attachDialogListenerToPage(session, session.currentPage)
  wireBidiEvents(session, session.currentPage)
  ctx.on('page', (newPage) => {
    attachDialogListenerToPage(session, newPage)
    wireBidiEvents(session, newPage)
  })
  ctx.once('close', () => {
    session.browser.close().catch(() => {})
  })
}
