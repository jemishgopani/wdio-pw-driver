import { $ } from '@wdio/globals'

import { BasePage } from './base.page.js'

export class CheckoutPage extends BasePage {
  protected readonly path = '/checkout-step-one.html'

  get firstName() { return $('[data-test="firstName"]') }
  get lastName() { return $('[data-test="lastName"]') }
  get postalCode() { return $('[data-test="postalCode"]') }
  get continueButton() { return $('[data-test="continue"]') }
  get cancelButton() { return $('[data-test="cancel"]') }
  get errorMessage() { return $('[data-test="error"]') }

  // Step two
  get finishButton() { return $('[data-test="finish"]') }
  get summarySubtotalLabel() { return $('[data-test="subtotal-label"]') }
  get summaryTaxLabel() { return $('[data-test="tax-label"]') }
  get summaryTotalLabel() { return $('[data-test="total-label"]') }

  // Complete
  get completeHeader() { return $('[data-test="complete-header"]') }
  get backHomeButton() { return $('[data-test="back-to-products"]') }

  async fillInfo(first: string, last: string, postal: string): Promise<void> {
    await this.firstName.setValue(first)
    await this.lastName.setValue(last)
    await this.postalCode.setValue(postal)
  }
}

export const checkoutPage = new CheckoutPage()
