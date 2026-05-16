import type { ReactNode } from 'react'
import clsx from 'clsx'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import CodeBlock from '@theme/CodeBlock'

import styles from './index.module.css'

function Hero(): ReactNode {
  const { siteConfig } = useDocusaurusContext()
  return (
    <header className={clsx('hero', styles.hero)}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/">
            Get started →
          </Link>
          <Link
            className={clsx('button button--outline button--lg', styles.secondaryButton)}
            to="https://github.com/jemishgopani/wdio-pw-driver"
          >
            GitHub
          </Link>
        </div>
      </div>
    </header>
  )
}

const FEATURES = [
  {
    title: 'No chromedriver',
    body: 'Your tests talk to the browser in-process via Playwright. No driver subprocess to spawn, no HTTP roundtrip per command.',
  },
  {
    title: 'Same WDIO API',
    body: 'Drop-in replacement for the standard `webdriver` package. Existing test code, hooks, and reporters work unchanged.',
  },
  {
    title: 'Built-in trace + video',
    body: 'Capability-driven auto-trace, per-test trace zips, video recording, embedded `<video controls>` in the report. No extra plugins.',
  },
  {
    title: 'Cross-browser',
    body: 'Chromium, Firefox, WebKit — all three engines via Playwright. One config per browser, no separate driver downloads.',
  },
  {
    title: 'CI sharding',
    body: 'wdioPW shard splits your spec list deterministically across N CI machines. No external glob expansion needed.',
  },
  {
    title: 'Lightweight reports',
    body: 'wdio-mochawesome-reporter v8 ships an inline HTML renderer (~25 KB self-contained) — no React bundle, no marge.',
  },
]

function Features(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <Heading as="h3">{f.title}</Heading>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const QUICKSTART = `// wdio.conf.ts
import { PWService } from 'wdio-pw-driver'

export const config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',
  services: [[PWService, {}]],

  capabilities: [{
    browserName: 'chromium',
    'wdio:pwOptions': { headless: true },
  }],

  framework: 'mocha',
  specs: ['./specs/**/*.spec.ts'],
}`

function Quickstart(): ReactNode {
  return (
    <section className={styles.quickstart}>
      <div className="container">
        <Heading as="h2">30-second setup</Heading>
        <CodeBlock language="ts" title="wdio.conf.ts">{QUICKSTART}</CodeBlock>
        <p className={styles.quickstartFooter}>
          See{' '}
          <Link to="/docs/configuration">Configuration</Link>
          {' for every option, or '}
          <Link to="/docs/commands">Commands</Link>
          {' for the full pw* surface.'}
        </p>
      </div>
    </section>
  )
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title="WebdriverIO meets Playwright internals"
      description={siteConfig.tagline}
    >
      <Hero />
      <main>
        <Features />
        <Quickstart />
      </main>
    </Layout>
  )
}
