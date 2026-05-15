import { $, $$ } from '@wdio/globals'

import { BasePage } from './base.page.js'

/**
 * Inventory grid at /inventory.html. Lists products, sort dropdown,
 * per-product add-to-cart buttons.
 */
export class InventoryPage extends BasePage {
  protected readonly path = '/inventory.html'

  get title() { return $('[data-test="title"]') }
  get sortDropdown() { return $('[data-test="product-sort-container"]') }
  get itemNames() { return $$('[data-test="inventory-item-name"]') }
  get itemPrices() { return $$('[data-test="inventory-item-price"]') }

  /** Add-to-cart button for a specific product (slug = lowercase-hyphen name). */
  addToCart(slug: string) {
    return $(`[data-test="add-to-cart-${slug}"]`)
  }

  /** Remove button replaces "add to cart" once an item is in the cart. */
  removeFromCart(slug: string) {
    return $(`[data-test="remove-${slug}"]`)
  }

  /**
   * Sort by visible attribute value. The implementation uses the standard
   * `selectByAttribute` — under the hood that finds the matching `<option>`
   * and clicks it. Our `<option>` click special-case in `elementClick`
   * routes the click to `parentSelect.selectOption({value})` so this
   * doesn't time out (which it would under chromedriver's actionability
   * model, since Playwright correctly rejects pointer events on `<option>`).
   */
  async sortBy(value: 'az' | 'za' | 'lohi' | 'hilo'): Promise<void> {
    await this.sortDropdown.selectByAttribute('value', value)
  }

  async getNamesText(): Promise<string[]> {
    // $$ returns a ChainablePromiseArray — `.map` on it returns a
    // Promise<string[]> directly, no need for Promise.all.
    return this.itemNames.map((e) => e.getText())
  }

  async getPricesNumeric(): Promise<number[]> {
    const texts = await this.itemPrices.map((e) => e.getText())
    return texts.map((t) => parseFloat(t.replace('$', '')))
  }
}

export const inventoryPage = new InventoryPage()
