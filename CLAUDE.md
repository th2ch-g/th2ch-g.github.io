# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Astro 6 + TypeScript (strict), Markdown content collections, Pagefind for search, Playwright (headless Chromium) for CV PDF generation, jimp + canvaskit-wasm for OG cards, KaTeX + Mermaid + custom remark plugins. No test framework. Path alias: `@/*` → `src/*`. Node 22 in CI. Zod schemas import `z` from `astro/zod` (the `astro:content` re-export was deprecated in Astro 6).

## Common commands

```bash
npm run dev          # astro dev (port 4321) — predev runs build-icon + build-fonts + build-qr
npm run build        # astro build → inject-sitemap-xsl → pagefind --site dist → CV PDF
npm run preview      # serve dist/
npm run check        # astro check (TypeScript on .astro/.ts/.mts)
npm run check:css    # custom CSS sanity check (scripts/check-css.mjs)
npm run build-assets # rebuild public/icon.png + public/fonts/ + public/qr.png
npm run sync-citations # refresh src/data/citations.json from CrossRef
npm run sync-bibtex    # refresh src/data/bibtex.json from CrossRef
```

There is no test runner, no linter, no formatter. CI runs `npm run check` + `npm run build` + axe-core (`scripts/check-a11y.mjs`) + Lighthouse + link check (`.github/workflows/links.yml`).

Docker: `docker compose up dev` (HMR on 4321) or `up prod` (nginx on 8080).

## Architecture

### Bilingual routing (ja default, en under `/en/`)

`astro.config.mjs` sets `prefixDefaultLocale: false`, so:
- Japanese pages live at `/`, `/posts/`, `/cv`, etc., served from `src/pages/*.astro`.
- English pages live at `/en/`, `/en/posts/`, `/en/cv`, served from `src/pages/en/*.astro` — these are **manually mirrored thin wrappers** that import the same component and pass `lang="en"`.

When adding a page, create both: `src/pages/foo.astro` and `src/pages/en/foo.astro`. Shared rendering goes in `src/components/FooPage.astro`.

UI strings are in `src/i18n/ui.ts`. All keys must exist in both `ja` and `en`. Use `t(lang, key)`; `tEn(key)` returns the English label regardless of locale (used for `<title>` chrome).

### Content collections

Defined in `src/content.config.ts`. Four collections:

- `cv` — body-only Markdown at `src/content/cv/{ja,en}.md`. No frontmatter schema.
- `legal` — `src/content/legal/{ja,en}/<slug>.md` with `title` / `description` / `updatedDate` frontmatter. The slug after the locale becomes the URL (`/<slug>` and `/en/<slug>`), so keep it short and stable.
- `profileMeta` — single file `src/content/profile.yaml`. Per-locale fields use `{ ja, en }` sub-objects; shared values stay flat. Read via `getProfileMeta(lang)` (in `src/lib/content.ts`), which flattens to a per-locale plain object. Throws if the file is missing — fail loudly at build time rather than degrade silently.
- `posts` — `src/content/posts/{ja,en}/<slug>.md` with optional co-located image files. Slug must match across locales (the language switcher and `getStaticPaths` rely on it). `entry.id` looks like `ja/<slug>` — `localeSlug(id)` strips the prefix.

The gallery is **not** a collection — loose images under `src/content/gallery/` are loaded via `import.meta.glob` from `PhotosListPage.astro`.

`getByLang(collection, lang)` filters by `id.startsWith('<lang>/')`. `getPublishedByLang('posts', lang, { includeDevDrafts })` adds draft filtering — drafts visible only in `npm run dev`. **Feeds, sitemaps, and OG endpoints must omit `includeDevDrafts`** so drafts never leak into syndication.

### Static paths pattern

Each page's `getStaticPaths` is evaluated independently by Astro and **must be a top-level `export async function getStaticPaths()`** — arrow functions assigned to `const` are not picked up by Astro's static analyzer and yield `Astro.props === undefined` at render time. Shared bodies live in `src/lib/static-paths.ts` (e.g. `buildPostsDetailPaths(lang)`).

### Build pipeline

`predev` / `prebuild` / `prestart` automatically run `build-assets`, which:
1. `scripts/build-icon.mjs` — fetches `profile.yaml`'s `icon.url`, circle-crops via jimp, writes `public/icon.png`.
2. `scripts/build-fonts.mjs` — populates `public/fonts/`.
3. `scripts/build-qr.mjs` — generates `public/qr.png` from the deployment URL (used in the CV PDF footer / share contexts).

`prebuild` additionally runs `sync-citation-counts.mjs` + `sync-bibtex.mjs`, which refresh `src/data/{citations,bibtex}.json` from CrossRef. **Commit these JSON files** — they are fail-soft snapshots (the scripts preserve existing per-DOI values on fetch errors), so a missing committed snapshot would leave CV cited-by badges and BibTeX buttons empty during a CrossRef outage or initial fork build.

`npm run build` then runs `astro build`, `scripts/inject-sitemap-xsl.mjs` (post-processes the generated sitemap to reference `public/sitemap.xsl` for human-readable rendering), `pagefind --site dist` (search index), and `scripts/build-cv-pdf.mjs` (Playwright spins up a static server, prints `/cv` and `/en/cv` to `dist/cv.pdf` and `dist/en/cv.pdf`). The CV PDF step **fails soft** — if Playwright is missing or Chromium crashes, the build still succeeds.

OG cards: `src/lib/og-image.ts` composites with `astro-og-canvas` + jimp + canvaskit-wasm. Hero-image backdrops are cached under `node_modules/.cache/og-hero/` keyed by source path + mtime.

### Markdown plumbing

Custom remark plugins in `src/plugins/`:
- `remark-twitter-embed` — bare X/Twitter URL → embed
- `remark-github-card` — bare GitHub repo URL → repo card
- `remark-link-card` — bare URL on its own line → OGP-style link card
- `remark-figure-caption` — image alt text → `<figcaption>`
- `remark-mermaid-block` — `mermaid` code fence → client-rendered diagram
- `remark-callouts` — GitHub-style `> [!NOTE]` blockquotes → `<aside class="callout-…">`
- `remark-profile-vars` — `@profile.<key>` token → value from `profile.yaml` (so MD content can reference site identity without hardcoding)

Plus rehype: KaTeX, slug, autolink-headings (prepend `#`), external-links (`target=_blank`). The Shiki transformer in `astro.config.mjs` projects `data-language` and optional `data-filename` (from code-fence meta `title="…"`) onto every `<pre>`, surfaced by `global.css`.

Reading-time: English uses the `reading-time` package; Japanese uses a char-count estimate (~500 chars/min) because CJK has no word spacing.

## Critical gotchas (do not relearn the hard way)

1. **Do NOT add `<ClientRouter />`.** It was removed for breaking card hover zoom (a CSS minifier interaction). The site uses regular full-document navigation. See user memory `feedback_card_hover_zoom_minifier_trap.md`.
2. **Do NOT listen for `astro:page-load`.** Without ClientRouter, that event never fires. Use the `onReady(fn)` helper in `src/lib/dom-ready.ts` (DOMContentLoaded + immediate-call branch on `readyState`).
3. **Do NOT add `@view-transition`** in CSS. Cross-document VT caused an unfixable white flash on this site. Page transitions use paint-holding + a CSS-only fade-in keyframe on `<main>`. See user memory `project_view_transitions_color_scheme.md`.
4. **`getStaticPaths` must be `export async function`,** not `export const … = async () => …`.
5. **Image service is `passthroughImageService()`** to avoid sharp's native deps in CI. Don't switch to the default service without first confirming CI compatibility.
6. **`profile.yaml` is the source of truth for site identity** (name, links, icon, headline). The icon URL is also consumed by `build-icon.mjs` at build time — changing it requires a rebuild before the new icon appears.

## Editing policy

- **Don't mirror ORCID / GitHub.** No `papers`, `works`, or `publications` routes — link out instead. Publications live only in `src/content/cv/{ja,en}.md` (synced via the `orcid-cv-sync` skill).
- **Keep the site forkable.** Editing files under `src/content/` (especially `profile.yaml`) should be enough for anyone to reuse this repo as their own portfolio. Do NOT hardcode personal identity (name, handles, ORCID id, email, GitHub URL, affiliation) in components, scripts, or pages — read from `profile.yaml` via `getProfileMeta(lang)` instead.

## Project-local skills

`.claude/skills/` ships two skills used in this repo:
- `orcid-cv-sync` — pull new publications from ORCID into `src/content/cv/{ja,en}.md` (additive, never overwrites). Trigger when refreshing the publications list.
- `translate-ja-md-to-en` — produce the `en/<slug>.md` mirror for any `src/content/<collection>/ja/<slug>.md`. Slug, frontmatter keys, code blocks, DOIs, and BibTeX are preserved verbatim.

Both are auto-discoverable; prefer them over hand-rolled equivalents.

## Deployment

GitHub Pages on push to `main` (`.github/workflows/deploy.yml`). The `site` field in `astro.config.mjs` is `https://th2ch-g.github.io` — this is a User/Org Page, so no base path. The deploy job caches Playwright browsers across runs; CV PDF generation is in the build step, not deploy.
