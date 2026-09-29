import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '@/i18n/ui';
import { summarizeMarkdown } from './markdown-summary.mjs';

type LangAware = 'posts';

// Dev-only HMR-resilience cache. Astro 6's content layer rebuilds its
// data store on every content-file save, and during that brief window
// `getCollection(...)` returns an empty array for *every* collection —
// not just the one whose file changed. A page render that lands in
// that window otherwise 404s ([...slug] sees no posts) and then crashes
// (Base.astro's getProfileMeta throws on the missing profile.yaml).
// In prod we never touch the cache: an empty collection at build time
// is a real configuration error and must still surface loudly.
let devPosts: CollectionEntry<'posts'>[] | undefined;
const devProfileMetaByLang = new Map<Lang, ProfileMeta>();
const markdownSummaries = new Map<string, { body: string; value: ReturnType<typeof summarizeMarkdown> }>();

function getMarkdownSummary(key: string, body: string) {
  let cached = markdownSummaries.get(key);
  if (!cached || cached.body !== body) {
    cached = { body, value: summarizeMarkdown(body) };
    markdownSummaries.set(key, cached);
  }
  return cached.value;
}

// Shared posts live directly under `posts/<slug>.md`, so their entry IDs are
// already URL slugs. Locale-specific collections such as legal still use
// `ja/<slug>` and `en/<slug>` IDs. Normalize both layouts for callers that
// build URLs from a collection entry.
const LOCALE_PREFIX = /^(ja|en)\//;
export function localeSlug(id: string): string {
  return id.replace(LOCALE_PREFIX, '');
}

export async function getByLang<C extends LangAware>(
  collection: C,
  _lang: Lang,
): Promise<CollectionEntry<C>[]> {
  // Posts are shared content. The route locale controls interface chrome and
  // language query parameter, never which post entries are returned.
  const entries = await getCollection(collection);
  if (import.meta.env.DEV && collection === 'posts') {
    const posts = entries as unknown as CollectionEntry<'posts'>[];
    if (posts.length === 0) {
      if (devPosts) return devPosts as unknown as CollectionEntry<C>[];
    } else {
      devPosts = posts;
    }
  }
  return entries as CollectionEntry<C>[];
}

export async function getCv(lang: Lang) {
  const all = await getCollection('cv');
  return all.find((p) => p.id === lang);
}

export async function getContact(lang: Lang) {
  const all = await getCollection('contact');
  return all.find((entry) => entry.id === lang);
}

export async function getContactDetails(lang: Lang) {
  const entry = await getContact(lang);
  const summary = await getMarkdownSummary(`contact/${lang}`, entry?.body ?? '');
  const form = summary.links.find((href) => {
    try {
      const url = new URL(href);
      return url.origin === 'https://docs.google.com'
        && /^\/forms\/.*\/viewform\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  });
  const email = summary.links.find((href) => href.startsWith('mailto:'))?.slice(7).split('?')[0];
  return { entry, form, email, standaloneForm: Boolean(form && summary.standaloneLink === form) };
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

// Navigation uses English titles while destinations follow the content locale.
export async function getLegalLinksByLang(lang: Lang) {
  const legalDocs = await getLegalByLang(lang);
  const englishLegalTitles = new Map(
    (await getLegalByLang('en')).map((doc) => [doc.slug, doc.title]),
  );
  return legalDocs.map((doc) => ({
    slug: doc.slug,
    // Humanize the slug when a document has no English mirror yet.
    label: englishLegalTitles.get(doc.slug)
      ?? doc.slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

// Combine shared settings with the CV's first H1 and introductory paragraph.
export async function getProfileMeta(lang: Lang): Promise<ProfileMeta> {
  const [all, cv] = await Promise.all([getCollection('profileMeta'), getCv(lang)]);
  const meta = all[0];
  if (!meta || !cv) {
    if (import.meta.env.DEV) {
      const cached = devProfileMetaByLang.get(lang);
      if (cached) return cached;
    }
    throw new Error(
      !meta ? 'profileMeta collection is empty: src/content/profile.yaml is missing or unloadable'
        : `CV (${lang}) is missing. Add src/content/cv/${lang}.md`,
    );
  }
  const identity = await getMarkdownSummary(`cv/${lang}`, cv.body ?? '');
  const settings = buildProfileMeta(meta.data);
  const result = {
    ...settings,
    name: identity.title || settings.siteHandle,
    bio: identity.description,
  };
  if (import.meta.env.DEV) devProfileMetaByLang.set(lang, result);
  return result;
}

function buildProfileMeta(data: ProfileData) {
  // Coerce null / empty strings to undefined so callers only need to test
  // for truthiness, not for the specific blank variant.
  const blank = (s: string | null | undefined) => (s ? s : undefined);
  return {
    siteHandle: blank(data.siteHandle) ?? '',
    repo: blank(data.repo),
    // Flatten the icon object to its URL.
    icon: blank(data.icon?.url),
    integrations: buildIntegrations(data),
  };
}

type ProfileMeta = ReturnType<typeof buildProfileMeta> & { name: string; bio?: string };

// Flatten the optional `giscus` / `analytics` / `adsense` / `searchConsole`
// blocks in profile.yaml into per-feature objects, returning `undefined`
// when the feature is disabled or isn't configured. Components can guard on
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
  const giscus = g?.enabled !== false && g?.repoId && g?.categoryId
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

  const a = data.analytics;
  const goatcounterEndpoint = blank(a?.goatcounterEndpoint);
  const googleAnalyticsId = blank(a?.googleAnalyticsId);
  const analytics = a?.enabled !== false && (goatcounterEndpoint || googleAnalyticsId)
    ? { goatcounterEndpoint, googleAnalyticsId }
    : undefined;

  const ad = data.adsense;
  const adsense = ad?.enabled !== false && blank(ad?.clientId)
    ? { clientId: blank(ad?.clientId)! }
    : undefined;

  const sc = data.searchConsole;
  const searchConsole = sc?.enabled !== false && blank(sc?.verification)
    ? { verification: blank(sc?.verification)! }
    : undefined;

  return { giscus: giscusReady, analytics, adsense, searchConsole };
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

// Content dates originate as date-only frontmatter values. Format from their
// ISO representation so local and CI time zones cannot shift the calendar day.
export function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatMonthDay(date: Date) {
  return date.toISOString().slice(5, 10);
}

// Series helpers. A "series" is just a free-form string in front-matter —
// posts sharing the same `series` value are bundled chronologically. Used
// by SeriesNav at the bottom of each post detail page when the post
// belongs to a series.
export async function getSeriesPosts(
  series: string,
  lang: Lang,
): Promise<CollectionEntry<'posts'>[]> {
  const all = await getByLang('posts', lang);
  return all
    .filter((p) => p.data.series === series)
    .sort((a, b) => a.data.pubDate.getTime() - b.data.pubDate.getTime());
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
    await getByLang('posts', lang),
    'pubDate',
  );
  const idx = all.findIndex((p) => p.id === current.id);
  if (idx < 0) return { prev: null, next: null };
  return {
    next: idx > 0 ? all[idx - 1] : null,
    prev: idx < all.length - 1 ? all[idx + 1] : null,
  };
}

// Count prose without code, formulae, HTML markup, or bare URLs.
function stripNonProse(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$\n]+\$/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '');
}

// Word count for structured metadata; Japanese uses non-whitespace characters.
export function getWordCount(body: string, lang: Lang): number {
  const prose = stripNonProse(body);
  if (lang === 'ja') {
    return prose.replace(/\s+/g, '').length;
  }
  return prose.split(/\s+/).filter(Boolean).length;
}
