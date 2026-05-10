/// <reference types="node" />
/**
 * Minimal standalone usage. Run with:
 *
 *   pnpm build
 *   node --experimental-vm-modules examples/standalone.ts  (or via tsx)
 */
import PWDriver from '../src/index.js'

async function main(): Promise<void> {
  const browser = (await PWDriver.newSession({
    capabilities: {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true },
    },
  })) as {
    sessionId: string
    navigateTo: (url: string) => Promise<void>
    getTitle: () => Promise<string>
    findElement: (using: string, value: string) => Promise<{ [key: string]: string }>
    getElementText: (id: string) => Promise<string>
    deleteSession: () => Promise<void>
  }

  console.log(`session: ${browser.sessionId}`)

  await browser.navigateTo('https://example.com')
  console.log(`title: ${await browser.getTitle()}`)

  const headingRef = await browser.findElement('css selector', 'h1')
  const headingId = headingRef['element-6066-11e4-a52e-4f735466cecf']!
  console.log(`h1 text: ${await browser.getElementText(headingId)}`)

  await browser.deleteSession()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
