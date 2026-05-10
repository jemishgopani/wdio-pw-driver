import type { CommandHandler } from '../command.js'
import { WebDriverError } from '../errors.js'

/**
 * W3C JavaScript dialog handling.
 *
 * PW auto-handles every dialog inside its `page.on('dialog')` listener
 * so the page never blocks (see driver.ts:attachDialogListener for why).
 * That means by the time the user calls these commands, the dialog has
 * already been responded to — these commands operate on the cached
 * snapshot, not a live Dialog object.
 *
 * Practical implications:
 *   - `getAlertText` returns the message of the most recent dialog.
 *   - `acceptAlert` / `dismissAlert` clear the snapshot but cannot retroactively
 *     change what was sent to the page. Default response is `accept`.
 *   - To make `confirm()` return false: call `dismissAlert()` BEFORE the
 *     action that opens the dialog.
 *   - To make `prompt()` see a value: call `sendAlertText('value')` BEFORE
 *     the dialog opens.
 *
 * Tests that don't care about the page-side response (just want to see the
 * message and acknowledge it) work without changes.
 */

function noAlert(): never {
  throw new WebDriverError(
    'no such alert',
    'No JavaScript dialog snapshot is available.',
  )
}

/**
 * POST /session/:sessionId/alert/accept
 *
 * Clears the snapshot. The dialog itself was already accepted (or dismissed,
 * if dismissAlert was queued first) by the listener.
 */
export const acceptAlert: CommandHandler = async ({ session }) => {
  if (!session.dialogs.pending) noAlert()
  session.dialogs.pending = null
  // The next dialog defaults back to accept (in case dismissAlert was queued
  // and the dialog has now been delivered).
  session.dialogs.nextAction = 'accept'
  return null
}

/**
 * POST /session/:sessionId/alert/dismiss
 *
 * If a dialog snapshot is pending, clear it. If not, queue 'dismiss' as the
 * action for the next dialog event. Both behaviors are W3C-compliant, just
 * applied at different points in the dialog lifecycle.
 */
export const dismissAlert: CommandHandler = async ({ session }) => {
  if (session.dialogs.pending) {
    session.dialogs.pending = null
    session.dialogs.nextAction = 'accept'
  } else {
    session.dialogs.nextAction = 'dismiss'
  }
  return null
}

/**
 * GET /session/:sessionId/alert/text
 */
export const getAlertText: CommandHandler = async ({ session }) => {
  const snap = session.dialogs.pending
  if (!snap) noAlert()
  return snap.message
}

/**
 * POST /session/:sessionId/alert/text   body: { text }
 *
 * Per W3C: "queues" text for when the dialog is accepted. In PW, tests
 * must call this BEFORE the dialog event fires (since dialogs are auto-
 * accepted on arrival). If a snapshot is already pending, the call is a
 * no-op for the page side but still validates the type for parity.
 */
export const sendAlertText: CommandHandler = async ({ session }, text) => {
  if (typeof text !== 'string') {
    throw new TypeError('sendAlertText: expected text string')
  }
  const snap = session.dialogs.pending
  if (snap && snap.type !== 'prompt') {
    throw new WebDriverError(
      'element not interactable',
      `sendAlertText requires a prompt dialog (current: ${snap.type})`,
    )
  }
  session.dialogs.pendingText = text
  return null
}
