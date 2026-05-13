import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { collectTags, localeSlug } from '@/lib/content';
import { renderFeedHtml } from '@/lib/rss';
import { buildPageMeta } from '@/lib/page-builders';
import { requireSite } from '@/lib/site';
import type { Lang } from '@/i18n/ui';

// Per-tag RSS factory. Returns `{ getStaticPaths, GET }` so each page
// only re-exports the pair. Unlike the main posts feed, tag feeds are
// intentionally lighter: no WebSub hub advertisement, no atom xmlns.
export function buildTagRssHandlers(lang: Lang) {
  const isEn = lang === 'en';
  const titleVariant = isEn ? ' posts (en):' : ' posts:';
  const localePrefix = isEn ? '/en' : '';

  return {
    getStaticPaths: async function getStaticPaths() {
      const { posts } = await buildPageMeta(lang);
      return collectTags(posts).map((tag) => ({ params: { tag } }));
    },
    GET: async function GET(context: APIContext) {
      const { tag } = context.params as { tag: string };
      const { profile, posts: all } = await buildPageMeta(lang);
      const posts = all.filter((p) => (p.data.tags ?? []).includes(tag));
      const site = requireSite(context);
      return rss({
        title: `${profile.siteHandle}${titleVariant} #${tag}`,
        description: `Posts tagged #${tag}`,
        site,
        items: posts.map((post) => ({
          title: post.data.title,
          description: post.data.description,
          pubDate: post.data.pubDate,
          link: new URL(`${localePrefix}/posts/${localeSlug(post.id)}/`, site).toString(),
          content: renderFeedHtml(post.body ?? ''),
          categories: post.data.tags,
        })),
      });
    },
  };
}
