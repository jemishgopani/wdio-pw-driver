import { describe, expect, it, vi } from 'vitest'

import { buildLocator } from '../../src/selectorMapper.js'

/**
 * The mapper's job is to translate strategy + value into the right Playwright
 * call. We assert which method on the scope was called and with what args.
 */
function fakeScope() {
  return {
    locator: vi.fn(),
    getByRole: vi.fn(),
  } as unknown as Parameters<typeof buildLocator>[0]
}

describe('buildLocator', () => {
  it('css selector -> scope.locator(value)', () => {
    const s = fakeScope() as { locator: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'css selector', '#foo')
    expect(s.locator).toHaveBeenCalledWith('#foo')
  })

  it('xpath -> scope.locator("xpath=" + value)', () => {
    const s = fakeScope() as { locator: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'xpath', '//a')
    expect(s.locator).toHaveBeenCalledWith('xpath=//a')
  })

  it('tag name -> scope.locator(value)', () => {
    const s = fakeScope() as { locator: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'tag name', 'h1')
    expect(s.locator).toHaveBeenCalledWith('h1')
  })

  it('link text -> getByRole(link) with exact name', () => {
    const s = fakeScope() as { getByRole: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'link text', 'Click me')
    expect(s.getByRole).toHaveBeenCalledWith('link', { name: 'Click me', exact: true })
  })

  it('partial link text -> getByRole(link) with regex name', () => {
    const s = fakeScope() as { getByRole: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'partial link text', 'Click')
    const call = s.getByRole.mock.calls[0]
    expect(call?.[0]).toBe('link')
    expect((call?.[1] as { name: RegExp }).name).toBeInstanceOf(RegExp)
  })

  it('partial link text escapes regex metacharacters', () => {
    const s = fakeScope() as { getByRole: ReturnType<typeof vi.fn> }
    buildLocator(s as Parameters<typeof buildLocator>[0], 'partial link text', 'a.b+c')
    const re = (s.getByRole.mock.calls[0]?.[1] as { name: RegExp }).name
    // the literal "a.b+c" should match itself
    expect(re.test('a.b+c')).toBe(true)
    // but NOT a string where the metachar is allowed to expand (a anything b ...)
    expect(re.test('axb+c')).toBe(false)
  })

  it('throws on unknown strategy', () => {
    expect(() =>
      buildLocator(fakeScope() as Parameters<typeof buildLocator>[0], 'made up', 'foo'),
    ).toThrowError(/Unsupported locator strategy/)
  })
})
