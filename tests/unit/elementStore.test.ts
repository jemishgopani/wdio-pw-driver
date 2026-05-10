import { describe, expect, it } from 'vitest'

import { DefaultElementStore } from '../../src/elementStore.js'

// We don't import a real Playwright Locator here — the store only cares that
// it gets *something* back. A minimal object suffices for unit-level checks.
function fakeLocator(name = 'loc'): unknown {
  return { name }
}

describe('DefaultElementStore', () => {
  it('returns a stable id for the same locator', () => {
    const store = new DefaultElementStore()
    const loc = fakeLocator() as Parameters<DefaultElementStore['register']>[0]
    const id1 = store.register(loc)
    const id2 = store.register(loc)
    expect(id1).toBe(id2)
  })

  it('returns distinct ids for distinct locators', () => {
    const store = new DefaultElementStore()
    const a = store.register(fakeLocator('a') as Parameters<DefaultElementStore['register']>[0])
    const b = store.register(fakeLocator('b') as Parameters<DefaultElementStore['register']>[0])
    expect(a).not.toBe(b)
  })

  it('looks up locators by id', () => {
    const store = new DefaultElementStore()
    const loc = fakeLocator() as Parameters<DefaultElementStore['register']>[0]
    const id = store.register(loc)
    expect(store.get(id)).toBe(loc)
  })

  it('returns undefined for unknown ids', () => {
    const store = new DefaultElementStore()
    expect(store.get('nope')).toBeUndefined()
  })

  it('reports correct size', () => {
    const store = new DefaultElementStore()
    expect(store.size()).toBe(0)
    store.register(fakeLocator('a') as Parameters<DefaultElementStore['register']>[0])
    store.register(fakeLocator('b') as Parameters<DefaultElementStore['register']>[0])
    expect(store.size()).toBe(2)
  })

  it('clear() drops all forward entries', () => {
    const store = new DefaultElementStore()
    const id = store.register(fakeLocator() as Parameters<DefaultElementStore['register']>[0])
    store.clear()
    expect(store.size()).toBe(0)
    expect(store.get(id)).toBeUndefined()
  })
})
