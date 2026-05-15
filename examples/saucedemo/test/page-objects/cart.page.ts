import { $, $$ } from '@wdio/globals'

import { BasePage } from './base.page.js'

export class CartPage extends BasePage {
  protected readonly path = '/cart.html'

  get title() { return $('[data-test="title"]') }
  get cartItems() { return $$('[data-test="inventory-item"]') }
  get checkoutButton() { return $('[data-test="checkout"]') }
  get continueShoppingButton() { return $('[data-test="continue-shopping"]') }

  removeButton(slug: string) {
    return $(`[data-test="remove-${slug}"]`)
  }

  async itemCount(): Promise<number> {
    return (await this.cartItems).length
  }
}

export const cartPage = new CartPage()
