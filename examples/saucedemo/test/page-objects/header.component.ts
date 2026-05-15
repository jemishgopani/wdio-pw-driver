import { $ } from '@wdio/globals'

/**
 * Persistent app header — burger menu, cart icon with badge.
 *
 * Component, not page: header is rendered on every authenticated screen,
 * so we don't extend BasePage. Page classes hold a reference to it:
 *
 *   const header = new HeaderComponent()
 *   await header.openMenu()
 */
export class HeaderComponent {
  get burgerButton() { return $('#react-burger-menu-btn') }
  get menuLogoutLink() { return $('#logout_sidebar_link') }
  get menuResetAppLink() { return $('#reset_sidebar_link') }
  get menuCloseButton() { return $('#react-burger-cross-btn') }
  get cartLink() { return $('[data-test="shopping-cart-link"]') }
  get cartBadge() { return $('[data-test="shopping-cart-badge"]') }

  async openMenu(): Promise<void> {
    await this.burgerButton.click()
    // Menu slides in over 300ms — without auto-wait, the next click on a
    // menu item raced. Our PWService override on waitForDisplayed routes
    // to Playwright's stability check, which waits for the slide to settle.
    await this.menuLogoutLink.waitForDisplayed()
  }

  async closeMenu(): Promise<void> {
    await this.menuCloseButton.click()
  }

  async logout(): Promise<void> {
    await this.openMenu()
    await this.menuLogoutLink.click()
  }

  async resetAppState(): Promise<void> {
    await this.openMenu()
    await this.menuResetAppLink.click()
    await this.closeMenu()
  }
}

export const header = new HeaderComponent()
