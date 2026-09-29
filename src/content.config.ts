import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// Import the supported Zod namespace directly instead of astro:content.
import { z } from 'astro/zod';

// Helpers shared across collections so that "null / empty / missing"
// always collapse to the same canonical absence value (undefined).
//
// Output types stay `T | undefined` so consumers can use optional fields
// without normalizing null values at every call site.

// Coerce YAML's `key:` (null) and `key: ""` (empty string) to undefined.
const blankToUndefined = (v: unknown) =>
  v === null || v === '' ? undefined : v;

// Wrap a schema with `blankToUndefined` preprocess + `.optional()` so that
// null / '' both collapse to undefined and the output type stays
// `T | undefined` (no leaking `| null`).
const nullable = <T extends z.ZodType>(inner: T) =>
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

// CV links and sync section markers live in the Markdown body.
const cv = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/cv' }),
});

const contact = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/contact' }),
});

// Legal documents (privacy policy, terms of service, ...). One entry per
// locale per document. The slug after the locale is used in the URL
// (`/<slug>?lang=en` and `/<slug>?lang=ja`), so keep it short and stable.
const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: nullable(z.string()),
    updatedDate: z.coerce.date(),
  }),
});

// Shared site settings; personal prose and contact links live in Markdown.
const profileMeta = defineCollection({
  loader: glob({ pattern: 'profile.yaml', base: './src/content' }),
  schema: z.object({
    // Stable site brand / GitHub handle used in the header and footer.
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
    // Avatar source also used by the generated site icon.
    icon: z
      .object({
        url: z.preprocess(blankToUndefined, httpUrl.nullish()),
      })
      .nullish(),
    // Each integration defaults to enabled when configured. Set enabled to
    // false to retain its settings without rendering the integration.
    giscus: z
      .object({
        enabled: z.boolean().default(true),
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
    analytics: z
      .object({
        enabled: z.boolean().default(true),
        goatcounterEndpoint: nullable(httpUrl),
        // GA4 measurement IDs are `G-` followed by 10 uppercase
        // alphanumerics. Validating the shape at build time catches
        // transposed / truncated values long before GA itself would
        // (which silently drops malformed pings).
        googleAnalyticsId: nullable(z.string().regex(/^G-[A-Z0-9]{10}$/)),
      })
      .nullish(),
    // AdSense controls the verification tag, production ad loader,
    // and generated /ads.txt route together.
    adsense: z
      .object({
        enabled: z.boolean().default(true),
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
        enabled: z.boolean().default(true),
        verification: nullable(z.string().regex(/^[A-Za-z0-9_-]+$/)),
      })
      .nullish(),
  }),
});

// Posts are shared Japanese content. Files live directly under
// `src/content/posts/`; both JA and EN routes render the same entries while
// selecting their language through query parameters.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    // Title remains required — list pages, OG cards, and
    // breadcrumbs all key off it. An empty <h1> would cascade visually.
    title: z.string(),
    description: nullable(z.string()),
    // pubDate remains required because list ordering and the
    // adjacent-post navigator all depend on it.
    pubDate: z.coerce.date(),
    updatedDate: nullable(z.coerce.date()),
    // Optional series identifier — posts sharing the same `series`
    // string are linked at the bottom of each post in chronological
    // order. Free-form so authors can name a series without registering
    // it elsewhere; the slug is used both as a key and a display label.
    series: nullable(z.string()),
  }),
});

// Note: the gallery is no longer a content collection. Photos are loose
// image files under `src/content/gallery/` loaded via `import.meta.glob`
// from `PhotosListPage.astro` — there is no per-photo .md any more.

export const collections = { cv, contact, legal, profileMeta, posts };
