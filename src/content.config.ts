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

// Body-only collection: per-locale CV prose lives in cv/<lang>.md.
// All structured metadata moved to profile.yaml at the content root.
const cv = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/cv' }),
  schema: z.object({}),
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
    site: nullable(z.url()),
    location: z.string().nullish(),
    email: z.string().nullish(),
    // Avatar source plus an optional per-locale hover tooltip. The URL is
    // also consumed by `scripts/build-icon.mjs` to bake `public/icon.png`.
    icon: z
      .object({
        url: z.preprocess(blankToUndefined, z.url().nullish()),
        comment: z
          .object({
            ja: z.string().nullish(),
            en: z.string().nullish(),
          })
          .nullish(),
      })
      .nullish(),
    headline: z
      .object({
        ja: z.string().nullish(),
        en: z.string().nullish(),
      })
      .nullish(),
    affiliation: z
      .object({
        ja: z.string().nullish(),
        en: z.string().nullish(),
      })
      .nullish(),
    links: z
      .array(
        z.object({
          label: z.string().nullish(),
          url: z.preprocess(blankToUndefined, z.url().nullish()),
          // Per-locale hover tooltip. Either side may be null/missing; the
          // renderer treats an empty value as "no bubble for this locale".
          comment: z
            .object({
              ja: z.string().nullish(),
              en: z.string().nullish(),
            })
            .nullish(),
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
        endpoint: nullable(z.url()),
        pingback: nullable(z.url()),
        apiTarget: nullable(z.string()),
      })
      .nullish(),
    analytics: z
      .object({
        goatcounterEndpoint: nullable(z.url()),
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
  }),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
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
      // Hero image shown at the top of the post and as a thumbnail in lists.
      // Accepts either a co-located asset path (resolved via Astro's `image()`
      // into `ImageMetadata` for build-time optimisation) or an absolute
      // remote URL — useful when the source image lives on a CDN or external
      // host and shouldn't be vendored into the repo. Remote URLs are rendered
      // verbatim through a plain `<img>` (no width/height hints; layout shift
      // is bounded by the CSS aspect-ratio on `.thumb` / `.hero`) and are
      // also downloaded at build time by the OG-card pipeline so the card
      // backdrop matches the in-post hero (see `resolveHeroImageSource` in
      // og-image.ts). Fetch failures fall back to the gradient-only design.
      heroImage: z.preprocess(
        blankToUndefined,
        z.union([image(), z.url()]).optional(),
      ),
      heroImageAlt: nullable(z.string()),
    }),
});

// Note: the gallery is no longer a content collection. Photos are loose
// image files under `src/content/gallery/` loaded via `import.meta.glob`
// from `PhotosListPage.astro` — there is no per-photo .md any more.

export const collections = { cv, legal, profileMeta, posts };
