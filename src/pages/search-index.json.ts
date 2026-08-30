import type { APIRoute } from 'astro';
import { getPublishedByLang, localeSlug, sortByDateDesc } from '@/lib/content';
import type { SearchIndexItem } from '@/lib/search';

export const GET: APIRoute = async () => {
  const posts = sortByDateDesc(
    await getPublishedByLang('posts', 'ja', { includeDevDrafts: true }),
    'pubDate',
  );
  const items: SearchIndexItem[] = posts.map((post) => ({
    slug: localeSlug(post.id),
    title: post.data.title,
    description: post.data.description ?? '',
    tags: post.data.tags ?? [],
    date: post.data.pubDate.toISOString().slice(0, 10),
    body: post.body ?? '',
  }));

  return new Response(JSON.stringify({ items }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': import.meta.env.DEV ? 'no-store' : 'public, max-age=3600',
    },
  });
};
