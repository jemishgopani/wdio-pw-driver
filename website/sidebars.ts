import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

/**
 * Sidebar groups our 8 topic docs into three logical sections so the nav
 * mirrors how a user actually moves through them: intro → configure +
 * look up commands + integrate reporting + use the CLI → set up isolation
 * pattern → understand internals → debug.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['configuration', 'commands', 'service', 'cli'],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['isolation', 'reporting', 'benchmarks'],
    },
    {
      type: 'category',
      label: 'Internals',
      collapsed: false,
      items: ['architecture', 'troubleshooting'],
    },
  ],
}

export default sidebars
