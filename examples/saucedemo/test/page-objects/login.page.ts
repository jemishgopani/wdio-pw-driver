import { $ } from '@wdio/globals'

import { BasePage } from './base.page.js'

/**
 * Login screen at /. Standard SauceDemo: username / password / submit,
 * with an inline error region for invalid credentials.
 */
export class LoginPage extends BasePage {
  protected readonly path = '/'

  get username() { return $('[data-test="username"]') }
  get password() { return $('[data-test="password"]') }
  get loginButton() { return $('[data-test="login-button"]') }
  get errorMessage() { return $('[data-test="error"]') }

  async login(user: string, pass: string): Promise<void> {
    await this.username.setValue(user)
    await this.password.setValue(pass)
    await this.loginButton.click()
  }
}

export const loginPage = new LoginPage()
