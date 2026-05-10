import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

/**
 * Docusaurus 3 site for wdio-pw-driver. Same shape as mobilewright.dev/docs:
 * left sidebar + top search + main content + auto light/dark.
 *
 * Branding pulls the same teal/magenta palette the mochawesome-reporter
 * fork uses, so report + docs feel like one product.
 */
const config: Config = {
  title: 'wdio-pw-driver',
  tagline: 'WebdriverIO meets Playwright internals — same WDIO API, no chromedriver, no HTTP.',
  favicon: 'img/favicon.ico',

  future: { v4: true },

  url: 'https://jemishgopani.github.io',
  baseUrl: '/wdio-pw-driver/',
  organizationName: 'jemishgopani',
  projectName: 'wdio-pw-driver',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl: 'https://github.com/jemishgopani/wdio-pw-driver/edit/main/docs/',
        },
        // Blog disabled — pure docs site for now.
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'wdio-pw-driver',
      logo: {
        alt: 'wdio-pw-driver',
        src: 'img/logo.svg',
        srcDark: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/jemishgopani/wdio-pw-driver',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Introduction', to: '/docs/' },
            { label: 'Configuration', to: '/docs/configuration' },
            { label: 'Commands', to: '/docs/commands' },
            { label: 'Test isolation', to: '/docs/isolation' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/jemishgopani/wdio-pw-driver' },
            { label: 'wdio-mochawesome-reporter', href: 'https://github.com/jemishgopani/wdio-mochawesome-reporter' },
            { label: 'WebdriverIO', href: 'https://webdriver.io' },
            { label: 'Playwright', href: 'https://playwright.dev' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} jemishgopani · MIT licensed`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['typescript', 'json', 'bash', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
