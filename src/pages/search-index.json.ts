import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { languages, tUi, type Lang } from '@/i18n/ui';
import { formatDate, getCv, getProfileMeta, getPublishedByLang, localeSlug, sortByDateDesc } from '@/lib/content';
import type { SearchIndexItem } from '@/lib/search';

async function localeItems(lang: Lang): Promise<SearchIndexItem[]> {
  const [meta, cv, legalDocs, published] = await Promise.all([
    getProfileMeta(lang),
    getCv(lang),
    getCollection('legal', (doc) => doc.id.startsWith(`${lang}/`)),
    getPublishedByLang('posts', lang, { includeDevDrafts: true }),
  ]);
  const posts = sortByDateDesc(published, 'pubDate');
  const page = (path: string, title: string, description = '', body = ''): SearchIndexItem => ({
    url: getRelativeLocaleUrl(lang, path),
    lang,
    title,
    description,
    body,
  });
  const postList = (entries: typeof posts) => entries.map((post) =>
    `${post.data.title} ${post.data.description ?? ''} ${formatDate(post.data.pubDate)}`,
  ).join('\n');
  const items: SearchIndexItem[] = [
    page('/', `${tUi('nav.home')} / ${tUi('nav.cv')} — ${meta.name}`, meta.bio, cv?.body),
    page('/posts/', tUi('nav.posts'), '', postList(posts)),
    page('/gallery/', tUi('nav.photos')),
    page('/contact/', tUi('nav.contact'), tUi('contact.description'),
      tUi(meta.contactForm ? 'contact.cta' : 'contact.unavailable')),
    page('/sitemap/', tUi('sitemap.title'), tUi('sitemap.description'), [
      tUi('sitemap.pages'), tUi('sitemap.posts'), tUi('sitemap.qr'),
      tUi('sitemap.qrNote'), tUi('sitemap.xmlNote'),
      tUi('nav.home'), tUi('nav.photos'), tUi('nav.posts'), tUi('nav.contact'),
      ...legalDocs.map((doc) => doc.data.title), postList(posts),
    ].join('\n')),
  ];
  items.push(...legalDocs.map((doc) => ({
    ...page(`/${localeSlug(doc.id)}/`, doc.data.title, doc.data.description, doc.body),
    date: formatDate(doc.data.updatedDate),
  })));
  items.push(...posts.map((post) => ({
    url: getRelativeLocaleUrl(lang, `/posts/${localeSlug(post.id)}/`),
    lang,
    title: post.data.title,
    description: post.data.description ?? '',
    date: formatDate(post.data.pubDate),
    body: post.body ?? '',
  })));
  const series = new Set(posts.flatMap((post) => post.data.series ? [post.data.series] : []));
  for (const name of series) {
    items.push(page(`/posts/series/${name}/`, `${tUi('series.heading')}: ${name}`, '',
      postList(posts.filter((post) => post.data.series === name))));
  }
  return items;
}

export const GET: APIRoute = async () => {
  // Keep development and Pagefind recovery searchable beyond the post archive.
  // Locale URLs are generated here so every result has its actual destination.
  const items = (await Promise.all((Object.keys(languages) as Lang[]).map(localeItems))).flat();

  return new Response(JSON.stringify({ items }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': import.meta.env.DEV ? 'no-store' : 'public, max-age=3600',
    },
  });
};
