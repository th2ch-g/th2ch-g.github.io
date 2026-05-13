// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import { readFileSync } from 'node:fs';
import sitemap from '@astrojs/sitemap';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkTwitterEmbed } from './src/plugins/remark-twitter-embed.mjs';
import { remarkMermaidBlock } from './src/plugins/remark-mermaid-block.mjs';
import { remarkCallouts } from './src/plugins/remark-callouts.mjs';
import { remarkGithubCard } from './src/plugins/remark-github-card.mjs';
import { remarkLinkCard } from './src/plugins/remark-link-card.mjs';
import { remarkFigureCaption } from './src/plugins/remark-figure-caption.mjs';
import { remarkProfileVars } from './src/plugins/remark-profile-vars.mjs';

// Resolve the deployment URL from src/content/profile.yaml so a fork only
// has to edit profile.yaml — never this file. We keep this inline (rather
// than calling src/lib/profile-yaml.mjs's `siteUrl()`) so the helper
// module doesn't end up in Vite's SSR chunk graph; its `import.meta.url`-
// based path resolution would then be wrong when the chunk is emitted
// under `dist/chunks/` during page generation. The build-time scripts
// under scripts/ still use the helper.
// Resolution order:
//   1. explicit `site: https://...` in profile.yaml (custom domains)
//   2. `https://<owner>.github.io` from `repo: <owner>/<repo>` (the
//      common GitHub User/Org Pages case where this site lives).
const profileYaml = readFileSync('./src/content/profile.yaml', 'utf-8');
/** @param {string} key */
const readScalar = (key) =>
  profileYaml.match(new RegExp(`^${key}:\\s*(\\S.*?)\\s*$`, 'm'))?.[1];
const explicitSite = readScalar('site');
const repoOwner = readScalar('repo')?.split('/')[0];
const site = explicitSite
  ?? (repoOwner ? `https://${repoOwner}.github.io` : 'http://localhost:4321');

// User/Org Pages (https://<user>.github.io/) -> site is the root, no base path needed.
export default defineConfig({
  site,
  trailingSlash: 'ignore',
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'en'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  build: {
    format: 'directory',
  },
  integrations: [
    // Generates `/sitemap-index.xml` + per-locale shards. The i18n option
    // marks each URL with its `hreflang` and emits xhtml:link alternates
    // so search engines understand the ja/en bilingual structure.
    sitemap({
      i18n: {
        defaultLocale: 'ja',
        locales: { ja: 'ja-JP', en: 'en-US' },
      },
    }),
  ],
  // Skip sharp-based image optimization to avoid native build deps in CI.
  // Swap to the default service later by removing this if image optimization is needed.
  image: {
    service: passthroughImageService(),
  },
  markdown: {
    shikiConfig: {
      // Shiki transformers run on the produced HAST after highlighting.
      // We tag every `<pre>` with its source language so `global.css` can
      // surface a small label in the upper-right corner via `attr()`.
      transformers: [
        {
          pre(node) {
            const lang = this.options?.lang;
            if (lang && lang !== 'plaintext') {
              node.properties['data-language'] = lang;
            }
            // Code-fence meta (after the language token) is forwarded to
            // the transformer; we project an optional `title="..."` onto
            // the <pre> as `data-filename` so global.css can surface it.
            const rawMeta = this.options?.meta?.__raw ?? this.options?.meta ?? '';
            const meta = typeof rawMeta === 'string' ? rawMeta : '';
            const m = /title=["']([^"']+)["']/.exec(meta);
            if (m) node.properties['data-filename'] = m[1];
          },
        },
      ],
    },
    remarkPlugins: [remarkProfileVars, remarkTwitterEmbed, remarkGithubCard, remarkLinkCard, remarkFigureCaption, remarkMermaidBlock, remarkCallouts, remarkMath],
    rehypePlugins: [
      [
        rehypeExternalLinks,
        {
          target: '_blank',
          rel: ['noopener', 'noreferrer'],
        },
      ],
      // `rehype-slug` first generates `id="..."` from heading text;
      // `rehype-autolink-headings` then wraps each heading in an
      // anchor link. The `prepend` behavior puts the `#` glyph before
      // the heading text and the CSS in `global.css` only reveals it
      // on hover, mirroring the GitHub README convention. `aria-hidden`
      // keeps the duplicate text out of the screen-reader output.
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'prepend',
          properties: { class: 'heading-anchor', ariaHidden: 'true', tabIndex: -1 },
          content: { type: 'text', value: '#' },
        },
      ],
      // KaTeX renders math nodes from `remark-math` to HTML+MathML.
      // The accompanying `katex.min.css` must be loaded by the page —
      // see `Base.astro` for the `<link>` injection.
      rehypeKatex,
    ],
  },
});
