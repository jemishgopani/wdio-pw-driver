import { describe, expect, it } from 'vitest'

import {
  NoSuchElementError,
  StaleElementReferenceError,
  ElementNotInteractableError,
  TimeoutError,
  NoSuchWindowError,
  WebDriverError,
  translatePlaywrightError,
} from '../../src/errors.js'

describe('WebDriverError shapes', () => {
  it('NoSuchElementError carries the W3C error string as `name` AND `error`', () => {
    const e = new NoSuchElementError('boom')
    // `.name` MUST be the W3C error code so WDIO + expect-webdriverio can
    // pattern-match it (their `not.toBeExisting()` flow inspects `name`).
    expect(e.name).toBe('no such element')
    // `.error` is the same W3C string (legacy field, kept for compat).
    expect(e.error).toBe('no such element')
    // `.kind` carries the PascalCase identifier for log/stack readability.
    expect(e.kind).toBe('NoSuchElementError')
    expect(e.message).toBe('boom')
  })

  it('extends Error', () => {
    expect(new TimeoutError()).toBeInstanceOf(Error)
    expect(new TimeoutError()).toBeInstanceOf(WebDriverError)
  })
})

describe('translatePlaywrightError', () => {
  it('passes WebDriverError through unchanged', () => {
    const e = new NoSuchElementError('x')
    expect(translatePlaywrightError(e)).toBe(e)
  })

  it('TimeoutError + locator wording -> NoSuchElement', () => {
    const e = Object.assign(new Error('locator.click: Timeout 30000ms exceeded waiting for selector'), {
      name: 'TimeoutError',
    })
    const t = translatePlaywrightError(e)
    expect(t).toBeInstanceOf(NoSuchElementError)
  })

  it('TimeoutError without locator wording -> Timeout', () => {
    const e = Object.assign(new Error('navigation timeout'), { name: 'TimeoutError' })
    const t = translatePlaywrightError(e)
    expect(t).toBeInstanceOf(TimeoutError)
  })

  it('"node is detached" -> StaleElement', () => {
    const e = new Error('Element is not attached to the DOM')
    expect(translatePlaywrightError(e)).toBeInstanceOf(StaleElementReferenceError)
  })

  it('"intercepts pointer events" -> NotInteractable', () => {
    const e = new Error('subtree intercepts pointer events')
    expect(translatePlaywrightError(e)).toBeInstanceOf(ElementNotInteractableError)
  })

  it('"target closed" -> NoSuchWindow', () => {
    const e = new Error('Target closed')
    expect(translatePlaywrightError(e)).toBeInstanceOf(NoSuchWindowError)
  })

  it('falls back to generic WebDriverError', () => {
    const t = translatePlaywrightError(new Error('something weird'))
    expect(t).toBeInstanceOf(WebDriverError)
    expect(t.error).toBe('unknown error')
  })
})
