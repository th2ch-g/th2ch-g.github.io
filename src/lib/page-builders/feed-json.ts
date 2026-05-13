import type { APIContext } from 'astro';
import { localeSlug } from '@/lib/content';
import { renderFeedHtml } from '@/lib/rss';
import { buildPageMeta } from '@/lib/page-builders';
import { requireSite } from '@/lib/site';
import type { Lang } from '@/i18n/ui';

// JSON Feed 1.1 (https://jsonfeed.org/version/1.1) sibling of the RSS
// handler. Same items, JSON serialisation. Authored separately rather
// than transformed from the RSS XML so per-format tweaks stay independent
// (RSS keeps the WebSub <atom:link rel=hub/>, JSON Feed uses `hubs`).
export function buildJsonFeedHandler(lang: Lang) {
  const isEn = lang === 'en';
  const titleSuffix = isEn ? ' (en)' : '';
  const descSuffix = isEn ? ' (English)' : '';
  const localePrefix = isEn ? '/en' : '';
  const selfPath = `${localePrefix}/feed.json`;

  return async function GET(context: APIContext) {
    const { profile, posts } = await buildPageMeta(lang);
    const site = requireSite(context);
    const body = {
      version: 'https://jsonfeed.org/version/1.1',
      title: `${profile.siteHandle} posts${titleSuffix}`,
      description: `Posts by ${profile.siteHandle}${descSuffix}`,
      home_page_url: new URL(`${localePrefix}/`, site).toString(),
      feed_url: new URL(selfPath, site).toString(),
      language: lang,
      ...(profile.icon ? { icon: new URL(profile.icon, site).toString() } : {}),
      authors: [{ name: profile.name, ...(profile.icon ? { avatar: profile.icon } : {}) }],
      // WebSub hub at the feed level (same hub the RSS feed advertises) so
      // readers that prefer JSON Feed still get push notifications.
      hubs: [{ type: 'WebSub', url: 'https://pubsubhubbub.appspot.com/' }],
      items: posts.map((post) => {
        const url = new URL(
          `${localePrefix}/posts/${localeSlug(post.id)}/`,
          site,
        ).toString();
        return {
          id: url,
          url,
          title: post.data.title,
          ...(post.data.description ? { summary: post.data.description } : {}),
          content_html: renderFeedHtml(post.body ?? ''),
          date_published: post.data.pubDate.toISOString(),
          ...(post.data.updatedDate
            ? { date_modified: post.data.updatedDate.toISOString() }
            : {}),
          ...(post.data.tags && post.data.tags.length > 0
            ? { tags: post.data.tags }
            : {}),
        };
      }),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': 'application/feed+json; charset=utf-8' },
    });
  };
}
