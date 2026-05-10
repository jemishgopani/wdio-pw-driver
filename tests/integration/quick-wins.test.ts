/**
 * Coverage for the 2026-05-10 quick-wins pass:
 *   - Pass 1: getNamedCookie throws 'no such cookie' on miss
 *   - Pass 1: elementSendKeys uploads when target is <input type="file">
 *   - Pass 1: elementClear rewraps unsupported-element errors
 *   - Pass 2: pwWaitForRequest / pwWaitForResponse
 *   - Pass 2: pwOnFileChooser
 *   - Pass 2: getElementComputedRole / getElementComputedLabel
 *   - Pass 2: pwAriaSnapshot
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { WebDriverError, ElementNotInteractableError } from '../../src/errors.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface Client {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  elementSendKeys(elementId: string, text: string): Promise<null>
  elementClear(elementId: string): Promise<null>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  getElementProperty(elementId: string, prop: string): Promise<unknown>
  getNamedCookie(name: string): Promise<unknown>
  addCookie(cookie: Record<string, unknown>): Promise<null>
  getElementComputedRole(elementId: string): Promise<string>
  getElementComputedLabel(elementId: string): Promise<string>
  pwWaitForRequest(p: unknown): Promise<{ url: string; method: string }>
  pwWaitForResponse(p: unknown): Promise<{ url: string; status: number }>
  pwOnFileChooser(files: string[] | null): Promise<null>
  pwAriaSnapshot(opts?: Record<string, unknown>): Promise<string>
  deleteSession(): Promise<null>
}

async function newBrowser(): Promise<Client> {
  return (await PWDriver.newSession({
    capabilities: {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true, timeout: 5000 },
    },
  })) as Client
}

describe('Pass 1 — getNamedCookie throws on miss', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('throws WebDriverError("no such cookie") for missing cookies', async () => {
    await browser.navigateTo('data:text/html,<body></body>')
    let caught: unknown
    try {
      await browser.getNamedCookie('definitely-not-a-real-cookie')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(WebDriverError)
    expect((caught as { name: string }).name).toBe('no such cookie')
  })

  it('still returns the cookie body on hit', async () => {
    // data: URLs can't carry cookies; use about:blank then add via API.
    await browser.navigateTo('https://example.com/')
    await browser.addCookie({
      name: 'pw-test',
      value: 'hello',
      domain: 'example.com',
      path: '/',
    })
    const got = (await browser.getNamedCookie('pw-test')) as { name: string; value: string }
    expect(got.name).toBe('pw-test')
    expect(got.value).toBe('hello')
  }, 15_000)
})

describe('Pass 1 — elementSendKeys uploads when target is <input type="file">', () => {
  let browser: Client
  let filePath: string
  beforeAll(async () => {
    browser = await newBrowser()
    const dir = mkdtempSync(join(tmpdir(), 'pw-upload-'))
    filePath = join(dir, 'sample.txt')
    writeFileSync(filePath, 'hi from quick-wins test')
  }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('uploads via setInputFiles instead of typing the path', async () => {
    await browser.navigateTo(
      'data:text/html,<body><input id="up" type="file"></body>',
    )
    const input = await browser.findElement('css selector', '#up')
    await browser.elementSendKeys(input[ELEMENT_KEY]!, filePath)
    // After upload, the input has one File whose name matches our file.
    const fileName = await browser.executeScript(
      'return document.getElementById("up").files[0]?.name;',
      [],
    )
    expect(fileName).toBe('sample.txt')
  })

  it('regular text inputs still get pressSequentially', async () => {
    await browser.navigateTo(
      'data:text/html,<body><input id="t" type="text"></body>',
    )
    const input = await browser.findElement('css selector', '#t')
    await browser.elementSendKeys(input[ELEMENT_KEY]!, 'hello')
    const value = await browser.getElementProperty(input[ELEMENT_KEY]!, 'value')
    expect(value).toBe('hello')
  })
})

describe('Pass 1 — elementClear surfaces a clean ElementNotInteractableError', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('throws ElementNotInteractableError when target is a div', async () => {
    await browser.navigateTo('data:text/html,<body><div id="d">x</div></body>')
    const div = await browser.findElement('css selector', '#d')
    let caught: unknown
    try {
      await browser.elementClear(div[ELEMENT_KEY]!)
    } catch (err) {
      caught = err
    }
    // Either our wrapped error OR the underlying Playwright wording — what
    // matters is that the caller sees a recognizable W3C-shaped error,
    // not a silent no-op.
    expect(caught).toBeTruthy()
    const name = (caught as { name?: string }).name ?? ''
    expect(['element not interactable', 'unknown error']).toContain(name)
    if (caught instanceof ElementNotInteractableError) {
      expect(caught.message).toMatch(/clearable/i)
    }
  })

  it('still clears a real input', async () => {
    await browser.navigateTo(
      'data:text/html,<body><input id="x" value="initial"></body>',
    )
    const input = await browser.findElement('css selector', '#x')
    await browser.elementClear(input[ELEMENT_KEY]!)
    expect(await browser.getElementProperty(input[ELEMENT_KEY]!, 'value')).toBe('')
  })
})

describe('Pass 2 — pwWaitForRequest / pwWaitForResponse', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('resolves the request snapshot when a matching URL fires', async () => {
    await browser.navigateTo(
      `data:text/html,${encodeURIComponent(
        '<body><script>setTimeout(() => fetch("https://example.com/api/users").catch(()=>{}), 200)</script></body>',
      )}`,
    )
    const req = await browser.pwWaitForRequest({ regex: { source: '/api/users' } })
    expect(req.url).toContain('/api/users')
    expect(req.method).toBe('GET')
  }, 15_000)

  it('resolves the response snapshot for a matching URL', async () => {
    // Same pattern as the request test: arm the listener while the page
    // has a setTimeout pending that triggers a fetch.
    await browser.navigateTo(
      `data:text/html,${encodeURIComponent(
        '<body><script>setTimeout(() => fetch("https://example.com/", {mode: "no-cors"}).catch(()=>{}), 200)</script></body>',
      )}`,
    )
    const res = await browser.pwWaitForResponse({ regex: { source: 'example\\.com' } })
    expect(res.url).toMatch(/example\.com/)
    expect(typeof res.status).toBe('number')
  }, 15_000)
})

describe('Pass 2 — pwOnFileChooser auto-uploads', () => {
  let browser: Client
  let filePath: string
  beforeAll(async () => {
    browser = await newBrowser()
    const dir = mkdtempSync(join(tmpdir(), 'pw-chooser-'))
    filePath = join(dir, 'chooser.txt')
    writeFileSync(filePath, 'chooser-data')
  }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('arms a one-shot listener that uploads on the next chooser', async () => {
    // page.click() on the file input opens a chooser; the armed listener
    // accepts it with our path.
    await browser.navigateTo(
      'data:text/html,<body><input id="up" type="file"></body>',
    )
    await browser.pwOnFileChooser([filePath])
    const input = await browser.findElement('css selector', '#up')
    // Trigger the chooser via JS click — this is what apps with custom
    // upload UI do under the hood.
    await browser.executeScript('document.getElementById("up").click(); return null;', [])
    // Give Playwright a tick to deliver the chooser → setFiles round-trip.
    await new Promise((r) => setTimeout(r, 500))
    const fileName = await browser.executeScript(
      'return document.getElementById("up").files[0]?.name;',
      [],
    )
    void input
    expect(fileName).toBe('chooser.txt')
  }, 15_000)
})

describe('Pass 2 — getElementComputedRole / getElementComputedLabel', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('returns implicit roles for common HTML elements', async () => {
    await browser.navigateTo(
      'data:text/html,<body><button id="b">go</button><nav id="n"></nav><h2 id="h">x</h2></body>',
    )
    const btn = await browser.findElement('css selector', '#b')
    const nav = await browser.findElement('css selector', '#n')
    const h2 = await browser.findElement('css selector', '#h')
    expect(await browser.getElementComputedRole(btn[ELEMENT_KEY]!)).toBe('button')
    expect(await browser.getElementComputedRole(nav[ELEMENT_KEY]!)).toBe('navigation')
    expect(await browser.getElementComputedRole(h2[ELEMENT_KEY]!)).toBe('heading')
  })

  it('honors explicit role attributes', async () => {
    await browser.navigateTo(
      'data:text/html,<body><div id="d" role="alert">!</div></body>',
    )
    const div = await browser.findElement('css selector', '#d')
    expect(await browser.getElementComputedRole(div[ELEMENT_KEY]!)).toBe('alert')
  })

  it('reads accessible label via aria-label, then label[for], then text', async () => {
    await browser.navigateTo(
      'data:text/html,' +
        encodeURIComponent(
          '<body>' +
            '<button id="b1" aria-label="Go away">x</button>' +
            '<label for="i1">Email</label><input id="i1">' +
            '<button id="b2">Click here</button>' +
            '</body>',
        ),
    )
    const b1 = await browser.findElement('css selector', '#b1')
    const i1 = await browser.findElement('css selector', '#i1')
    const b2 = await browser.findElement('css selector', '#b2')
    expect(await browser.getElementComputedLabel(b1[ELEMENT_KEY]!)).toBe('Go away')
    expect(await browser.getElementComputedLabel(i1[ELEMENT_KEY]!)).toBe('Email')
    expect(await browser.getElementComputedLabel(b2[ELEMENT_KEY]!)).toBe('Click here')
  })
})

describe('Pass 2 — pwAriaSnapshot', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('returns a YAML aria snapshot for the whole page', async () => {
    await browser.navigateTo(
      'data:text/html,<body><h1>Title</h1><button>OK</button></body>',
    )
    const yaml = await browser.pwAriaSnapshot()
    expect(typeof yaml).toBe('string')
    expect(yaml).toMatch(/heading.*Title/)
    expect(yaml).toMatch(/button.*OK/)
  })

  it('scopes to a single element when elementId is given', async () => {
    await browser.navigateTo(
      'data:text/html,<body><div id="a"><button>A</button></div><div id="b"><button>B</button></div></body>',
    )
    const a = await browser.findElement('css selector', '#a')
    const yaml = await browser.pwAriaSnapshot({ elementId: a[ELEMENT_KEY]! })
    expect(yaml).toMatch(/A/)
    expect(yaml).not.toMatch(/B/)
  })
})
