import { getPublishedByLang } from '@/lib/content';
import type { Lang } from '@/i18n/ui';

// Shared body for `pages/posts/series/[name].astro` and its EN mirror.
// `getStaticPaths` itself must remain a top-level `export async function`
// in each page so Astro's static analyzer can pick it up; this helper
// returns the `{ params, props }[]` payload the page returns.
export async function buildSeriesPaths(lang: Lang) {
  const all = await getPublishedByLang('posts', lang, { includeDevDrafts: true });
  const names = [
    ...new Set(all.map((p) => p.data.series).filter((s): s is string => !!s)),
  ];
  return names.map((name) => ({
    params: { name },
    props: {
      name,
      posts: all
        .filter((p) => p.data.series === name)
        .sort((a, b) => a.data.pubDate.getTime() - b.data.pubDate.getTime()),
    },
  }));
}
