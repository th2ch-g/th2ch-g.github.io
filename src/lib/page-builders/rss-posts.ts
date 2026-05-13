import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { localeSlug } from '@/lib/content';
import { renderFeedHtml, feedWebSubLinks, FEED_XMLNS } from '@/lib/rss';
import { buildPageMeta } from '@/lib/page-builders';
import { requireSite } from '@/lib/site';
import type { Lang } from '@/i18n/ui';

// Build the per-locale posts RSS handler. Both `pages/rss.xml.ts` (ja)
// and `pages/en/rss.xml.ts` (en) reduce to a single import + handler
// re-export. Title/description suffix and the `/en/` URL prefix are the
// only locale-derived bits; the rest of the feed payload is identical.
export function buildPostsRssHandler(lang: Lang) {
  const isEn = lang === 'en';
  const titleSuffix = isEn ? ' (en)' : '';
  const descSuffix = isEn ? ' (English)' : '';
  const localePrefix = isEn ? '/en' : '';
  const selfPath = `${localePrefix}/rss.xml`;

  return async function GET(context: APIContext) {
    const { profile, posts } = await buildPageMeta(lang);
    const site = requireSite(context);
    const selfUrl = new URL(selfPath, site).toString();
    return rss({
      title: `${profile.siteHandle} posts${titleSuffix}`,
      description: `Posts by ${profile.siteHandle}${descSuffix}`,
      site,
      xmlns: FEED_XMLNS,
      customData: feedWebSubLinks(selfUrl),
      items: posts.map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        // Absolute URL so RSS readers that don't normalize against the
        // channel `<link>` still resolve correctly. See `pages/rss.xml.ts`
        // for the original rationale.
        link: new URL(`${localePrefix}/posts/${localeSlug(post.id)}/`, site).toString(),
        content: renderFeedHtml(post.body ?? ''),
      })),
    });
  };
}
