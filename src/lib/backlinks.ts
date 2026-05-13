import type { CollectionEntry } from 'astro:content';
import { getByLang, localeSlug } from './content';
import type { Lang } from '@/i18n/ui';

// Build a slug -> citers map for the given locale. A "citer" is any
// post whose body contains a relative link `/posts/<slug>` (with or
// without locale prefix) targeting another post in the same locale.
//
// External links (https://...) and links to non-post routes are ignored.
// The crawl runs once per locale per build and the result is cached for
// the remainder of the same Astro build process.

type Citer = {
  id: string;
  slug: string;
  title: string;
  pubDate: Date;
};

const cache = new Map<Lang, Map<string, Citer[]>>();

// Per-locale URL prefix for post links inside markdown bodies. Tied
// to the `prefixDefaultLocale: false` routing model in astro.config.mjs
// (JA at root, EN under `/en/`). Kept as a literal map (rather than
// going through `getRelativeLocaleUrl`) because the consumer below
// embeds it as a regex source, not as a real URL.
const POSTS_PREFIX_BY_LANG: Record<Lang, string> = {
  ja: '/posts/',
  en: '/en/posts/',
};

function extractPostsSlugs(body: string, lang: Lang): string[] {
  const out: string[] = [];
  // Match `[label](/posts/foo)`, `[label](/posts/foo/)`, or the EN-prefixed
  // form `(/en/posts/foo)`. We accept either `/...` (root-relative) so
  // authors don't have to think about which locale they're linking to.
  const prefix = POSTS_PREFIX_BY_LANG[lang];
  const regex = new RegExp(`\\]\\((${prefix.replace(/\//g, '\\/')})([^)\\s#?]+)`, 'g');
  for (const m of body.matchAll(regex)) {
    out.push(m[2].replace(/\/$/, ''));
  }
  return out;
}

async function getBacklinkMap(lang: Lang): Promise<Map<string, Citer[]>> {
  if (cache.has(lang)) return cache.get(lang)!;
  const posts = (await getByLang('posts', lang)).filter(
    (p) => !p.data.draft || import.meta.env.DEV,
  );
  const map = new Map<string, Citer[]>();
  for (const post of posts) {
    const targets = extractPostsSlugs(post.body ?? '', lang);
    for (const target of targets) {
      const list = map.get(target) ?? [];
      list.push({
        id: post.id,
        slug: localeSlug(post.id),
        title: post.data.title,
        pubDate: post.data.pubDate,
      });
      map.set(target, list);
    }
  }
  cache.set(lang, map);
  return map;
}

export async function getBacklinks(
  current: CollectionEntry<'posts'>,
  lang: Lang,
): Promise<Citer[]> {
  const map = await getBacklinkMap(lang);
  const citers = map.get(localeSlug(current.id)) ?? [];
  // Defensive: drop self-references (shouldn't happen but cheap).
  return citers
    .filter((c) => c.id !== current.id)
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}
