import { getCollection, type CollectionEntry } from 'astro:content';
import readingTime from 'reading-time';
import type { Lang } from '@/i18n/ui';

type LangAware = 'posts';

// Dev-only HMR-resilience cache. Astro 6's content layer rebuilds its
// data store on every content-file save, and during that brief window
// `getCollection(...)` returns an empty array for *every* collection —
// not just the one whose file changed. A page render that lands in
// that window otherwise 404s ([...slug] sees no posts) and then crashes
// (Base.astro's getProfileMeta throws on the missing profile.yaml).
// In prod we never touch the cache: an empty collection at build time
// is a real configuration error and must still surface loudly.
const devPostsByLang = new Map<Lang, CollectionEntry<'posts'>[]>();
const devProfileMetaByLang = new Map<Lang, ProfileMeta>();

// Entries live under `<collection>/<lang>/<slug>.md`, so `entry.id` looks like
// `ja/foo` or `en/foo`. We strip the locale prefix to get a stable, language-
// independent slug used for URLs. Anything that doesn't match the expected
// shape is a misplaced content file and should fail the build loudly rather
// than silently producing a colliding URL.
const LOCALE_PREFIX = /^(ja|en)\//;
export function localeSlug(id: string): string {
  if (!LOCALE_PREFIX.test(id)) {
    throw new Error(
      `localeSlug: entry id "${id}" is not under ja/ or en/; check the file layout`,
    );
  }
  return id.replace(LOCALE_PREFIX, '');
}

export async function getByLang<C extends LangAware>(
  collection: C,
  lang: Lang,
): Promise<CollectionEntry<C>[]> {
  const entries = await getCollection(collection, ({ id }: { id: string }) =>
    id.startsWith(`${lang}/`),
  );
  if (import.meta.env.DEV && collection === 'posts') {
    const posts = entries as unknown as CollectionEntry<'posts'>[];
    if (posts.length === 0) {
      const cached = devPostsByLang.get(lang);
      if (cached) return cached as unknown as CollectionEntry<C>[];
    } else {
      devPostsByLang.set(lang, posts);
    }
  }
  return entries as CollectionEntry<C>[];
}

// Filter to non-draft entries. Feed / sitemap callers omit `includeDevDrafts`
// so drafts never leak into syndication artifacts (even in `npm run dev`).
// Internal page-route callers (series index, etc.) pass
// `{ includeDevDrafts: true }` to preview drafts during local dev. Only
// `posts` carries a `draft` field — the photo gallery is loaded via
// `import.meta.glob` (not a collection) so it has no draft semantics.
export async function getPublishedByLang(
  collection: 'posts',
  lang: Lang,
  opts?: { includeDevDrafts?: boolean },
): Promise<CollectionEntry<'posts'>[]> {
  const entries = await getByLang(collection, lang);
  const allowDev = opts?.includeDevDrafts === true && import.meta.env.DEV;
  return entries.filter((e) => !e.data.draft || allowDev);
}

export async function getCv(lang: Lang) {
  const all = await getCollection('cv');
  return all.find((p) => p.id === lang);
}

// Per-locale legal documents (privacy, terms, ...). Stored under
// `src/content/legal/<lang>/<slug>.md`; the entry id is `<lang>/<slug>`.
export async function getLegal(slug: string, lang: Lang) {
  const all = await getCollection('legal');
  return all.find((p) => p.id === `${lang}/${slug}`);
}

// All legal documents available for a given locale, flattened to the
// shape the footer / sitemap consumers actually want. Sorted by title so
// the rendered link order is stable and locale-appropriate. Drop a new
// markdown file under src/content/legal/<lang>/<slug>.md and it will
// flow through this helper into the dynamic [legal] route, the footer,
// and the human sitemap — no code change required.
export async function getLegalByLang(lang: Lang) {
  const all = await getCollection('legal');
  return all
    .filter((e) => e.id.startsWith(`${lang}/`))
    .map((e) => ({
      slug: localeSlug(e.id),
      title: e.data.title,
      description: e.data.description ?? undefined,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Resolves the single-entry `profileMeta` YAML and flattens per-locale
// `{ ja, en }` sub-objects to plain strings for the requested locale.
// Throws (rather than returning null) when the entry is missing — this
// is build-time content; an absent profile.yaml should fail the build
// loudly rather than silently degrading to placeholder values everywhere.
//
// The schema accepts null/missing for every field. This function normalises
// the raw values so callers can treat them uniformly:
//   - `name` / `siteHandle`: always strings; if either is blank it falls
//     back to the other so callers always have *something* to render.
//   - All other strings: undefined when blank/missing, so callers can
//     `meta.foo && ...` without juggling '', null, undefined.
//   - `links`: entries missing a label or url are dropped, so renderers
//     never produce empty `<a href="">` elements.
export async function getProfileMeta(lang: Lang): Promise<ProfileMeta> {
  const all = await getCollection('profileMeta');
  const meta = all[0];
  if (!meta) {
    if (import.meta.env.DEV) {
      const cached = devProfileMetaByLang.get(lang);
      if (cached) return cached;
    }
    throw new Error(
      'profileMeta collection is empty: src/content/profile.yaml is missing or unloadable',
    );
  }
  const result = buildProfileMeta(meta.data, lang);
  if (import.meta.env.DEV) devProfileMetaByLang.set(lang, result);
  return result;
}

function buildProfileMeta(data: ProfileData, lang: Lang) {
  // Coerce null / empty strings to undefined so callers only need to test
  // for truthiness, not for the specific blank variant.
  const blank = (s: string | null | undefined) => (s ? s : undefined);
  const name = blank(data.name);
  const siteHandle = blank(data.siteHandle);
  return {
    // name and siteHandle cross-fall-back so neither is ever undefined
    // when at least one is set. If both are blank, both end up as ''.
    name: name ?? siteHandle ?? '',
    siteHandle: siteHandle ?? name ?? '',
    repo: blank(data.repo),
    location: blank(data.location),
    email: blank(data.email),
    // Flatten the icon object so callers keep treating `meta.icon` as a
    // plain URL string; the hover comment is exposed alongside.
    icon: blank(data.icon?.url),
    iconComment: blank(data.icon?.comment?.[lang]),
    headline: blank(data.headline?.[lang]),
    affiliation: blank(data.affiliation?.[lang]),
    links: (data.links ?? [])
      .map((l) => ({
        label: blank(l.label),
        url: blank(l.url),
        // Pick the per-locale tooltip; null/undefined collapse to undefined so
        // consumers can simply guard on truthiness.
        comment: blank(l.comment?.[lang]),
      }))
      // Drop entries that lack the basics — an `<a href>` with no label
      // is invisible and an icon with no url is broken.
      .filter((l): l is { label: string; url: string; comment: string | undefined } =>
        Boolean(l.label && l.url),
      ),
    integrations: buildIntegrations(data),
  };
}

type ProfileMeta = ReturnType<typeof buildProfileMeta>;

// Flatten the optional `giscus` / `webmention` / `analytics` / `indexnow`
// blocks in profile.yaml into per-feature objects, returning `undefined`
// when the feature isn't configured. Components can then guard on
// truthiness (`{integrations.giscus && <Giscus … />}`) without juggling
// nested optionality. `giscus.repo` defaults to the top-level `repo`
// so authors only have to specify it once unless comments live on a
// different repo.
type ProfileData = NonNullable<
  Awaited<ReturnType<typeof getCollection<'profileMeta'>>>[number]
>['data'];

function buildIntegrations(data: ProfileData) {
  const blank = (s: string | null | undefined) => (s ? s : undefined);
  const fallbackRepo = blank(data.repo);

  const g = data.giscus;
  const giscus = g?.repoId && g?.categoryId
    ? {
        repo: blank(g.repo) ?? fallbackRepo,
        repoId: g.repoId,
        category: g.category ?? 'Announcements',
        categoryId: g.categoryId,
        mapping: g.mapping ?? 'pathname',
      }
    : undefined;
  // Drop the entire giscus block if no host repo is resolvable — the
  // widget would render with `data-repo=""` otherwise.
  const giscusReady = giscus && giscus.repo ? giscus : undefined;

  const w = data.webmention;
  const webmention = blank(w?.endpoint)
    ? {
        endpoint: blank(w?.endpoint)!,
        pingback: blank(w?.pingback),
        apiTarget: blank(w?.apiTarget),
      }
    : undefined;

  const a = data.analytics;
  const analytics = blank(a?.goatcounterEndpoint)
    ? { goatcounterEndpoint: blank(a?.goatcounterEndpoint)! }
    : undefined;

  const i = data.indexnow;
  const indexnow = blank(i?.key) ? { key: blank(i?.key)! } : undefined;

  const ad = data.adsense;
  const adsense = blank(ad?.clientId) ? { clientId: blank(ad?.clientId)! } : undefined;

  return { giscus: giscusReady, webmention, analytics, indexnow, adsense };
}

// Collect a sorted, de-duplicated tag list from a set of collection entries.
// Used by every list/tag page to render the chip filter bar in stable order.
export function collectTags<T extends { data: { tags?: string[] } }>(
  items: T[],
): string[] {
  return [...new Set(items.flatMap((i) => i.data.tags ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function sortByDateDesc<T extends { id: string; data: Record<string, unknown> }>(
  items: T[],
  key: string,
): T[] {
  // Secondary sort by `id` ASC so same-date entries stay in a fully
  // deterministic order across builds. Without this, Astro's content
  // cache regeneration (e.g. after a schema change in content.config.ts)
  // can flip the order of same-day posts, which then propagates into
  // `getAdjacentPosts` and produces visible post-nav diffs.
  return [...items].sort((a, b) => {
    const da = a.data[key] as Date;
    const db = b.data[key] as Date;
    const diff = db.getTime() - da.getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

export function formatDate(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

// Series helpers. A "series" is just a free-form string in front-matter —
// posts sharing the same `series` value are bundled chronologically. Used
// by SeriesNav at the bottom of each post detail page when the post
// belongs to a series.
export async function getSeriesPosts(
  series: string,
  lang: Lang,
): Promise<CollectionEntry<'posts'>[]> {
  const all = await getPublishedByLang('posts', lang, { includeDevDrafts: true });
  return all
    .filter((p) => p.data.series === series)
    .sort((a, b) => a.data.pubDate.getTime() - b.data.pubDate.getTime());
}

// Get up to `limit` posts from the same locale, ranked by tag overlap with
// the given post (most-shared-tag first; ties broken by most-recent
// `pubDate`). The current post itself and any draft posts (in production
// builds) are excluded. Used to surface related reading at the bottom of
// each post detail page.
export async function getRelatedPosts(
  current: CollectionEntry<'posts'>,
  lang: Lang,
  limit = 3,
): Promise<CollectionEntry<'posts'>[]> {
  const tags = new Set(current.data.tags ?? []);
  if (tags.size === 0) return [];
  const all = await getPublishedByLang('posts', lang, { includeDevDrafts: true });
  const scored = all
    .filter((p) => p.id !== current.id)
    .map((p) => {
      const overlap = (p.data.tags ?? []).filter((t) => tags.has(t)).length;
      return { post: p, overlap };
    })
    .filter((x) => x.overlap > 0);
  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return b.post.data.pubDate.getTime() - a.post.data.pubDate.getTime();
  });
  return scored.slice(0, limit).map((x) => x.post);
}

// Chronologically adjacent posts. `prev` is older, `next` is newer — this
// matches the reader's mental model when paging through an archive ("read
// the previous post" feels like going back in time). Returns `null` for
// either slot when at the boundary of the timeline.
export async function getAdjacentPosts(
  current: CollectionEntry<'posts'>,
  lang: Lang,
): Promise<{ prev: CollectionEntry<'posts'> | null; next: CollectionEntry<'posts'> | null }> {
  const all = sortByDateDesc(
    await getPublishedByLang('posts', lang, { includeDevDrafts: true }),
    'pubDate',
  );
  const idx = all.findIndex((p) => p.id === current.id);
  if (idx < 0) return { prev: null, next: null };
  return {
    next: idx > 0 ? all[idx - 1] : null,
    prev: idx < all.length - 1 ? all[idx + 1] : null,
  };
}

// Strip non-prose tokens that bloat reading-time estimates: fenced/inline
// code, display/inline math, HTML tags, and bare URLs. A reader skims past
// these rather than reading them char-by-char, so including them
// systematically over-estimates the time required.
function stripNonProse(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$\n]+\$/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '');
}

// Reading time estimate. The `reading-time` package counts whitespace-
// separated words at ~200 WPM, which matches English well but undercounts
// Japanese (which is mostly contiguous CJK with no spaces). For `ja`, fall
// back to a character-based estimate at ~500 chars/min — a common figure
// for native-speaker silent reading. Always >=1 minute so very short
// posts don't read as "0 min".
export function getReadingMinutes(body: string, lang: Lang): number {
  const prose = stripNonProse(body);
  if (lang === 'ja') {
    const cjkChars = prose.replace(/\s+/g, '').length;
    return Math.max(1, Math.ceil(cjkChars / 500));
  }
  return Math.max(1, Math.ceil(readingTime(prose).minutes));
}

// Word count for schema.org/BlogPosting's `wordCount` property. Uses the
// same `stripNonProse` pass as the reading-time estimate so the published
// metadata stays consistent with the displayed minutes. For Japanese,
// schema.org treats `wordCount` as a character count — there's no word
// boundary, and search engines (Google, Bing) document this convention.
export function getWordCount(body: string, lang: Lang): number {
  const prose = stripNonProse(body);
  if (lang === 'ja') {
    return prose.replace(/\s+/g, '').length;
  }
  return prose.split(/\s+/).filter(Boolean).length;
}
