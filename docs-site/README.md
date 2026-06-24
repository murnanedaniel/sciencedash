# ScienceDash docs site

The public documentation site (Astro + [Starlight](https://starlight.astro.build/)),
published to GitHub Pages at `danielmurnane.com/sciencedash`.

## Develop

```bash
cd docs-site
npm install
npm run dev          # runs sync-docs, then astro dev
```

`npm run build` produces the static site in `dist/`.

## How content works

- **Landing + getting-started** are authored here in `src/content/docs/`.
- **The guide pages** (`tutorial`, `setup`, `cluster-integration`,
  `workhorse-protocol`) are **not** edited here — they are synced from the
  repo-root `../docs/*.md` by `scripts/sync-docs.mjs` (run automatically before
  `dev`/`build`). Edit the originals in `../docs/`; they're the single source of
  truth and are also rendered inside the app at `/docs`. The synced copies are
  gitignored.

## Base path (important)

The site is served under the `/sciencedash` subpath, so `astro.config.mjs` sets
`base: "/sciencedash"`. Internal links in content must include that prefix
(`/sciencedash/tutorial/`) — Starlight base-prefixes `_astro` assets and sidebar
links automatically, but **not** hero-action or in-body Markdown links. Override
`SITE_URL` / `BASE_PATH` env vars to publish elsewhere (e.g. a fork at
`<user>.github.io/sciencedash/`).

## Deploy

`.github/workflows/docs.yml` builds and deploys on every push to `main` that
touches `docs-site/**` or `docs/**`. One-time setup in the repo: **Settings →
Pages → Source: GitHub Actions**. For the custom domain, confirm
`danielmurnane.com` is owned by your `<user>.github.io` Pages site and served
under the `/sciencedash` subpath before adding a CNAME.

## TODO

- Screenshots of the seeded dashboard (`/today`, a project page) under
  `src/assets/`, referenced from the landing page.
- A wordmark/logo.
