/**
 * WebDriver error shapes — strings come straight from
 * https://w3c.github.io/webdriver/#errors.
 *
 * Important convention: `error.name` MUST be the W3C error code (e.g.
 * `'no such element'`), not the PascalCase class name. WebdriverIO and
 * expect-webdriverio inspect `err.name` to detect specific protocol
 * errors — `expect(...).not.toBeExisting()` for example checks that
 * `findElement` raised an error with `name === 'no such element'` and
 * treats it as "element doesn't exist → assertion passes". If our
 * errors set `name` to the class name like `'NoSuchElementError'`, that
 * detection fails and the assertion incorrectly throws.
 *
 * To still expose the PascalCase identifier (useful for `instanceof`
 * checks and stack traces), we keep the class name available via:
 *   - the class name itself (e.g. `err.constructor.name`)
 *   - the `kind` property (e.g. `'NoSuchElementError'`)
 *
 * The W3C code lives on `error` (legacy) and `name` (the source of
 * truth WDIO inspects).
 */

export class WebDriverError extends Error {
  /** WebDriver "error" string (e.g. 'no such element'). Same as `.name`. */
  readonly error: string
  /** PascalCase class identifier — useful for logs that want a tighter token. */
  readonly kind: string

  constructor(error: string, message: string, kind = 'WebDriverError') {
    super(message)
    // The W3C error code MUST be `.name` so consumers (expect-webdriverio,
    // webdriverio's high-level commands) can pattern-match it. The PascalCase
    // identifier is preserved on `.kind` for log readability.
    this.name = error
    this.error = error
    this.kind = kind
  }
}

export class NoSuchElementError extends WebDriverError {
  constructor(message = 'An element could not be located on the page using the given search parameters.') {
    super('no such element', message, 'NoSuchElementError')
  }
}

export class StaleElementReferenceError extends WebDriverError {
  constructor(message = 'A command failed because the referenced element is no longer attached to the DOM.') {
    super('stale element reference', message, 'StaleElementReferenceError')
  }
}

export class ElementNotInteractableError extends WebDriverError {
  constructor(message = 'A command could not be completed because the element is not pointer- or keyboard-interactable.') {
    super('element not interactable', message, 'ElementNotInteractableError')
  }
}

export class TimeoutError extends WebDriverError {
  constructor(message = 'An operation did not complete before its timeout expired.') {
    super('timeout', message, 'TimeoutError')
  }
}

export class NoSuchWindowError extends WebDriverError {
  constructor(message = 'A command to switch to a window could not be satisfied because the window could not be found.') {
    super('no such window', message, 'NoSuchWindowError')
  }
}

export class InvalidSessionIdError extends WebDriverError {
  constructor(message = 'The session ID is not in the list of active sessions.') {
    super('invalid session id', message, 'InvalidSessionIdError')
  }
}

export class InvalidArgumentError extends WebDriverError {
  constructor(message = 'The arguments passed to the command were invalid.') {
    super('invalid argument', message, 'InvalidArgumentError')
  }
}

export class NotImplementedError extends WebDriverError {
  constructor(commandName: string) {
    super(
      'unsupported operation',
      `PW driver has not implemented "${commandName}" yet. ` +
      'Track progress at https://github.com/jemishgopani/wdio-pw-driver/issues',
      'NotImplementedError',
    )
  }
}

/**
 * Translate a Playwright error into the closest WebDriver equivalent.
 * Falls back to a generic "unknown error" wrapping the original message.
 */
export function translatePlaywrightError(err: unknown): WebDriverError {
  if (err instanceof WebDriverError) {
    return err
  }
  const e = err as { name?: string; message?: string }
  const msg = e?.message ?? String(err)

  // Detached/stale takes priority over generic timeout because Playwright's
  // timeout messages on detached elements include both wordings.
  if (
    /element is not attached|node is detached|element handle.*disposed|target frame detached|element\(s\) not found/i.test(msg)
  ) {
    return new StaleElementReferenceError(msg)
  }

  // Playwright's TimeoutError is the most common case.
  if (e?.name === 'TimeoutError') {
    if (/locator\.|waiting for/i.test(msg)) {
      return new NoSuchElementError(msg)
    }
    return new TimeoutError(msg)
  }

  if (/not visible|not enabled|intercepts pointer events|outside of the viewport/i.test(msg)) {
    return new ElementNotInteractableError(msg)
  }
  if (/has been closed|target closed/i.test(msg)) {
    return new NoSuchWindowError(msg)
  }

  return new WebDriverError('unknown error', msg)
}
