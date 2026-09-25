import type { CollectionEntry } from 'astro:content';
import type { Lang } from '@/i18n/ui';
import {
  getProfileMeta,
  getByLang,
  sortByDateDesc,
} from '@/lib/content';

// Shared locale metadata and posts for the OG page builders.
export interface PageMeta {
  profile: Awaited<ReturnType<typeof getProfileMeta>>;
  posts: CollectionEntry<'posts'>[];
}

export async function buildPageMeta(lang: Lang): Promise<PageMeta> {
  const profile = await getProfileMeta(lang);
  const posts = sortByDateDesc(
    await getByLang('posts', lang),
    'pubDate',
  );
  return { profile, posts };
}
