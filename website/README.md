# wdio-pw-driver — documentation site

[Docusaurus 3](https://docusaurus.io/) site for the `wdio-pw-driver` package.
Deployed to https://jemishgopani.github.io/wdio-pw-driver/ via GitHub Actions
on every push to `main` that touches `website/**`.

## Local development

```bash
pnpm install
pnpm start          # http://localhost:3000/wdio-pw-driver/
```

Edits under `docs/` and `src/` reload live.

## Production build

```bash
pnpm build          # → ./build
pnpm serve          # serve the build locally for a final smoke check
```

## Deployment

The deploy is automated — see `.github/workflows/deploy-docs.yml` at the
package root. To trigger a deploy without a content change, run the workflow
manually from the Actions tab (`workflow_dispatch`).

Repo setup (one-time): **Settings → Pages → Source = "GitHub Actions"**.
The workflow uses the modern Pages-from-Actions flow — no `gh-pages` branch
required.

## Where things live

| Path | What |
|---|---|
| `docs/` | Markdown source files. Frontmatter `sidebar_position` controls sidebar order. |
| `sidebars.ts` | Sidebar grouping (Reference / Guides / Internals). |
| `src/pages/index.tsx` | Landing page. |
| `src/css/custom.css` | Brand palette overrides. |
| `static/img/` | Logo, favicon, social card. |
| `docusaurus.config.ts` | Site config — `url`, `baseUrl`, navbar, footer. |
