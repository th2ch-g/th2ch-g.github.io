import type { CollectionEntry } from 'astro:content';
import { getByLang, localeSlug } from './content';
import type { Lang } from '@/i18n/ui';

// Build a slug -> citers map for the shared post collection. A "citer" is
// any post whose body contains a relative link to either route locale.
//
// External links (https://...) and links to non-post routes are ignored.
// The crawl result is identical for both routes and is cached once per build.

type Citer = {
  id: string;
  slug: string;
  title: string;
  pubDate: Date;
};

let cache: Map<string, Citer[]> | undefined;

function extractPostsSlugs(body: string): string[] {
  const out: string[] = [];
  // Match `[label](/posts/foo)`, `[label](/posts/foo/)`, or the EN-prefixed
  // form `(/en/posts/foo)`. We accept either `/...` (root-relative) so
  // authors don't have to think about which locale they're linking to.
  // Strip fenced code blocks, inline code, and HTML comments before
  // matching so a `](/posts/...)` shown as a code *example* (or commented
  // out) isn't recorded as a real inbound link — the rendered HTML wouldn't
  // contain a clickable link there, so the backlink would be a phantom.
  const prose = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const regex = /\]\((?:\/en)?\/posts\/([^)\s#?]+)/g;
  for (const m of prose.matchAll(regex)) {
    out.push(m[1].replace(/\/$/, ''));
  }
  return out;
}

async function getBacklinkMap(lang: Lang): Promise<Map<string, Citer[]>> {
  if (cache) return cache;
  const posts = (await getByLang('posts', lang)).filter(
    (p) => !p.data.draft || import.meta.env.DEV,
  );
  const map = new Map<string, Citer[]>();
  for (const post of posts) {
    const targets = extractPostsSlugs(post.body ?? '');
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
  cache = map;
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
