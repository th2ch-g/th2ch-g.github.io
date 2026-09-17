import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { localeSlug } from '@/lib/content';
import { renderFeedHtml, feedWebSubLinks, FEED_XMLNS } from '@/lib/rss';
import { buildPageMeta } from '@/lib/page-builders';
import { requireSite } from '@/lib/site';
import type { Lang } from '@/i18n/ui';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { getLocaleFileUrl } from '@/lib/locale-url';

// Build the posts RSS handler with URLs from the configured locale routing.
export function buildPostsRssHandler(lang: Lang) {
  const isEn = lang === 'en';
  const titleSuffix = isEn ? ' (en)' : '';
  const descSuffix = isEn ? ' (English)' : '';
  const selfPath = getLocaleFileUrl(lang, '/rss.xml');

  return async function GET(context: APIContext) {
    const { profile, posts } = await buildPageMeta(lang);
    const site = requireSite(context);
    const selfUrl = new URL(selfPath, site).toString();
    return rss({
      title: `${profile.siteHandle} posts${titleSuffix}`,
      description: `Posts by ${profile.siteHandle}${descSuffix}`,
      site: new URL(getRelativeLocaleUrl(lang, '/'), site),
      xmlns: FEED_XMLNS,
      customData: feedWebSubLinks(selfUrl),
      items: posts.map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        // Absolute URL so RSS readers that don't normalize against the
        // channel `<link>` still resolve correctly. See `pages/rss.xml.ts`
        // for the original rationale.
        link: new URL(getRelativeLocaleUrl(lang, `/posts/${localeSlug(post.id)}/`), site).toString(),
        content: renderFeedHtml(post.body ?? ''),
      })),
    });
  };
}
