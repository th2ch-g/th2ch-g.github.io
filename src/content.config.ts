import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// Astro 6 ships Zod 4 under `astro/zod`. The legacy re-export of `z` from
// `astro:content` is deprecated (and the bundled type namespace `z.ZodTypeAny`
// is no longer resolvable through it), so pull `z` directly from this path.
import { z } from 'astro/zod';

// Helpers shared across collections so that "null / empty / missing"
// always collapse to the same canonical absence value (undefined).
//
// Output types stay `T | undefined` rather than `T | null | undefined`
// so consumers like `@astrojs/rss` (which type their inputs as
// `string | undefined`) accept entries without any per-call massaging.

// Coerce YAML's `key:` (null) and `key: ""` (empty string) to undefined.
const blankToUndefined = (v: unknown) =>
  v === null || v === '' ? undefined : v;

// Sanitise tag arrays at the schema boundary: drop null entries and empty
// strings so consumers always see a clean `string[]` and don't need to
// re-filter at every render site.
const sanitiseTags = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : blankToUndefined(v);

// Wrap a schema with `blankToUndefined` preprocess + `.optional()` so that
// null / '' both collapse to undefined and the output type stays
// `T | undefined` (no leaking `| null`).
const nullable = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess(blankToUndefined, inner.optional());

// `z.url()` accepts any URL scheme supported by the platform URL parser,
// including executable schemes such as `javascript:`. Every URL in profile
// metadata is eventually rendered as an href/src or fetched at build time, so
// restrict the shared schema to network URLs at the content boundary.
const httpUrl = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  },
  { message: 'URL protocol must be http or https' },
);

// Zod's emoji validator accepts a sequence containing multiple emoji.
// Segment the value into Unicode grapheme clusters as a second guard so
// combined emoji such as "🧑‍💻" remain valid while "🧬🚀" is rejected.
const emojiSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const singleEmoji = z.emoji().refine(
  (value) => Array.from(emojiSegmenter.segment(value)).length === 1,
  { message: 'emoji must contain exactly one grapheme cluster' },
);

// Per-locale CV prose lives in cv/<lang>.md. Site-wide identity lives in
// profile.yaml; the only frontmatter here is the publication-sync config
// read by the `orcid-cv-sync` skill, so the CV stays self-contained: the
// iD it syncs from and the sections it may write into (the latter declared
// in the body as `<!-- cv:section … -->` markers) are both stated by the
// CV file itself, never by heading text or an external file.
const cv = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/cv' }),
  schema: z.object({
    // ORCID iD (`0000-0000-0000-0000`, final character may be X). Declared
    // per locale and expected to match across them — the sync script
    // refuses to run on a mismatch. Validating the shape here turns a typo
    // into a build error instead of a 404 from pub.orcid.org.
    orcid: nullable(z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/)),
  }),
});

// Legal documents (privacy policy, terms of service, ...). One entry per
// locale per document. The slug after the locale is used in the URL
// (`/<slug>` and `/en/<slug>`), so keep it short and stable.
const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: nullable(z.string()),
    updatedDate: z.coerce.date(),
  }),
});

// Single-file YAML collection holding language-aware structured profile info.
// Strings that differ per locale use { ja, en } sub-objects; truly shared
// values (URLs, name) stay flat. Read via `getProfileMeta(lang)`.
//
// Every field is `.nullish()` so that authors can leave any value blank
// (`key:` in YAML deserialises to `null`, not undefined) without tripping
// schema validation. Required-feeling fields like `name` / `siteHandle` /
// `repo` are still normalised by `getProfileMeta` — empty strings flow
// through as empty, and consumers that depend on them (Footer's GH links,
// for example) guard on truthiness rather than crashing.
const profileMeta = defineCollection({
  loader: glob({ pattern: 'profile.yaml', base: './src/content' }),
  schema: z.object({
    name: z.string().nullish(),
    // Stable site brand / GitHub handle. Used as the header brand text,
    // the footer copyright line, and the `<siteHandle> posts` RSS titles.
    // Kept separate from `name` so the human display name can drift
    // independently from the site identifier.
    siteHandle: z.string().nullish(),
    // `<owner>/<name>` GitHub slug for the source repo. Used by the footer
    // to build source / license URLs. The format is only validated when a
    // value is present — leaving it blank disables the GH-link block in
    // the footer entirely. Character class matches GitHub's own owner /
    // repo naming rules (alphanumerics + `._-`) so a malformed yaml can't
    // smuggle whitespace or special characters into rendered hrefs.
    repo: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
      .nullish(),
    // Optional explicit deployment URL. When omitted, astro.config.mjs
    // derives the site from `repo`'s owner (`https://<owner>.github.io`),
    // which is correct for GitHub User/Org Pages. Set this only when you
    // ship to a custom domain.
    site: nullable(httpUrl),
    email: z.string().nullish(),
    // Contact-form URL (e.g. a Google Form). Drives the /contact page CTA
    // button and the "Contact" nav item. Validated as a URL only when
    // present; blank disables the button and shows a placeholder instead.
    contactForm: nullable(httpUrl),
    // Avatar source plus an optional per-locale hover tooltip. The URL is
    // also consumed by `scripts/build-icon.mjs` to bake `public/icon.png`.
    icon: z
      .object({
        url: z.preprocess(blankToUndefined, httpUrl.nullish()),
        comment: z
          .object({
            ja: z.string().nullish(),
            en: z.string().nullish(),
          })
          .nullish(),
      })
      .nullish(),
    bio: z
      .object({
        ja: z.string().nullish(),
        en: z.string().nullish(),
      })
      .nullish(),
    links: z
      .array(
        z.object({
          label: z.string().nullish(),
          url: z.preprocess(blankToUndefined, httpUrl.nullish()),
        }),
      )
      .nullish(),
    // Third-party integration config. Each block is independently optional;
    // any blank value (`key:`, `key: ""`, `key: null`) disables the matching
    // feature at render time so the site still builds with placeholders.
    // All fields use the shared `nullable()` wrapper so YAML's null and
    // empty-string forms collapse to undefined consistently with the rest
    // of the schema.
    giscus: z
      .object({
        // Override `repo` only if comments live on a different repo;
        // otherwise the top-level `repo` field is reused. Same character
        // class as the top-level `repo` field.
        repo: nullable(z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)),
        repoId: nullable(z.string()),
        category: nullable(z.string()),
        categoryId: nullable(z.string()),
        mapping: nullable(z.enum(['pathname', 'url', 'title', 'og:title'])),
      })
      .nullish(),
    webmention: z
      .object({
        endpoint: nullable(httpUrl),
        pingback: nullable(httpUrl),
        apiTarget: nullable(z.string()),
      })
      .nullish(),
    analytics: z
      .object({
        goatcounterEndpoint: nullable(httpUrl),
        // GA4 measurement IDs are `G-` followed by 10 uppercase
        // alphanumerics. Validating the shape at build time catches
        // transposed / truncated values long before GA itself would
        // (which silently drops malformed pings).
        googleAnalyticsId: nullable(z.string().regex(/^G-[A-Z0-9]{10}$/)),
      })
      .nullish(),
    indexnow: z
      .object({
        key: nullable(z.string()),
      })
      .nullish(),
    // Google AdSense site verification. Setting `clientId` (form
    // `ca-pub-XXXXXXXXXXXXXXXX`) enables the
    // `<meta name="google-adsense-account">` verification tag in <head>
    // and the auto-generated `/ads.txt` route — the two stage-1
    // prerequisites for the AdSense application. The actual ad-loader
    // script is NOT injected by this block; add it manually after the
    // application is approved (and after measuring Lighthouse impact,
    // since the loader is large enough to break the perf budget in
    // lighthouserc.json).
    adsense: z
      .object({
        // AdSense publisher IDs are exactly 16 digits after `ca-pub-`. The
        // strict length catches transposed / truncated values at build
        // time rather than after a failed AdSense review round-trip.
        clientId: nullable(z.string().regex(/^ca-pub-\d{16}$/)),
      })
      .nullish(),
    // Google Search Console site verification (HTML-tag method). Holds the
    // `content="…"` token Google shows for the "HTML tag" option, emitted
    // as `<meta name="google-site-verification">`. The GA-based method
    // fails on this site (gtag passes the measurement ID as a variable,
    // not a literal, so Search Console's parser can't read it), so the tag
    // method is the supported path. Token charset is base64url-ish.
    searchConsole: z
      .object({
        verification: nullable(z.string().regex(/^[A-Za-z0-9_-]+$/)),
      })
      .nullish(),
  }),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    // Title remains required — list pages, feed entries, OG cards, and
    // breadcrumbs all key off it. An empty <h1> would cascade visually.
    title: z.string(),
    description: nullable(z.string()),
    // pubDate remains required because list ordering, feeds, and the
    // adjacent-post navigator all depend on it.
    pubDate: z.coerce.date(),
    updatedDate: nullable(z.coerce.date()),
    tags: z.preprocess(sanitiseTags, z.array(z.string()).optional()),
    // null-tolerant boolean: YAML `draft:` (no value) deserialises to
    // null, which `z.boolean()` would reject; coerce it to undefined
    // so the `.default(false)` engages.
    draft: z.preprocess(blankToUndefined, z.boolean().default(false)),
    // Optional series identifier — posts sharing the same `series`
    // string are linked at the bottom of each post in chronological
    // order. Free-form so authors can name a series without registering
    // it elsewhere; the slug is used both as a key and a display label.
    series: nullable(z.string()),
    // Required visual identity for post cards and detail headers.
    // A grapheme-aware validator allows composed emoji while rejecting
    // multiple adjacent emoji.
    emoji: singleEmoji,
  }),
});

// Note: the gallery is no longer a content collection. Photos are loose
// image files under `src/content/gallery/` loaded via `import.meta.glob`
// from `PhotosListPage.astro` — there is no per-photo .md any more.

export const collections = { cv, legal, profileMeta, posts };
