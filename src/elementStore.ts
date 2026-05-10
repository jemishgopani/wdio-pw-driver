import { randomUUID } from 'node:crypto'
import type { Locator } from 'playwright-core'
import type { ElementStore } from './types.js'

/**
 * Two-way map between WebDriver element-id strings and Playwright Locators.
 *
 * - `register(loc)` stores a locator under a fresh UUID and returns it.
 * - `get(id)` returns the locator for an id, or undefined if unknown.
 *
 * The reverse direction (locator → id) uses a WeakMap so locators that the
 * caller drops can be garbage-collected without us holding a strong ref.
 *
 * Shadow roots live in a parallel pair of maps because W3C wraps them in a
 * different element-key (`shadow-6066-...`) and dispatch routes them through
 * different command paths.
 *
 * Note: WebDriver elements never expire by themselves — only when the page
 * unloads. We do NOT prune entries on navigation; instead, any subsequent
 * call that uses a stale locator will surface a StaleElementReferenceError
 * via the error translator. The `command/element.ts` resolver also checks
 * existence up front for stronger reporting.
 */
export class DefaultElementStore implements ElementStore {
  private readonly byId = new Map<string, Locator>()
  private readonly byLocator = new WeakMap<Locator, string>()

  private readonly shadowById = new Map<string, Locator>()
  private readonly shadowByLocator = new WeakMap<Locator, string>()

  register(loc: Locator): string {
    const existing = this.byLocator.get(loc)
    if (existing) {
      return existing
    }
    const id = randomUUID()
    this.byId.set(id, loc)
    this.byLocator.set(loc, id)
    return id
  }

  get(id: string): Locator | undefined {
    return this.byId.get(id)
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  registerShadowRoot(loc: Locator): string {
    const existing = this.shadowByLocator.get(loc)
    if (existing) {
      return existing
    }
    const id = randomUUID()
    this.shadowById.set(id, loc)
    this.shadowByLocator.set(loc, id)
    return id
  }

  getShadowRoot(id: string): Locator | undefined {
    return this.shadowById.get(id)
  }

  clear(): void {
    this.byId.clear()
    this.shadowById.clear()
    // WeakMaps cannot be cleared explicitly; entries drop when locators are GC'd.
  }

  size(): number {
    return this.byId.size + this.shadowById.size
  }
}
