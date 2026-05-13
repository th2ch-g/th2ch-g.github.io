import type { CollectionEntry } from 'astro:content';
import type { Lang } from '@/i18n/ui';
import {
  getProfileMeta,
  getPublishedByLang,
  sortByDateDesc,
} from '@/lib/content';

// Per-locale bundle of the metadata every page-builder in this folder
// (RSS, OG image, future JSON Feed / Atom) consumes. Centralising the
// fetch order ensures all builders see the same draft-filtering rules
// and post ordering, so a fix in one place doesn't drift in another.
//
// Drafts are filtered for production by `getPublishedByLang`'s
// `import.meta.env.DEV` guard. Builders intentionally omit
// `includeDevDrafts` here so feed / OG outputs stay consistent with the
// site's published pages.
export interface PageMeta {
  profile: Awaited<ReturnType<typeof getProfileMeta>>;
  posts: CollectionEntry<'posts'>[];
}

export async function buildPageMeta(lang: Lang): Promise<PageMeta> {
  const profile = await getProfileMeta(lang);
  const posts = sortByDateDesc(
    await getPublishedByLang('posts', lang),
    'pubDate',
  );
  return { profile, posts };
}
