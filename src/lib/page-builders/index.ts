import type { CollectionEntry } from 'astro:content';
import type { Lang } from '@/i18n/ui';
import {
  getProfileMeta,
  getPublishedByLang,
  sortByDateDesc,
} from '@/lib/content';

// Shared locale metadata and published posts for the OG page builders.
// Omit includeDevDrafts so preview images never expose unpublished posts.
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
