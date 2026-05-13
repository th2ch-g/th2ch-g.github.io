import type { APIContext, APIRoute } from 'astro';
import { OGImageRoute } from 'astro-og-canvas';
import { collectTags } from '@/lib/content';
import {
  OG_BG_GRADIENT,
  OG_FONTS,
  OG_FONT_FAMILIES,
  OG_PADDING,
  OG_TITLE_COLOR,
  OG_DESC_COLOR,
  describeTagCounts,
  stripForOg,
} from '@/lib/og-config';
import { addOgChrome } from '@/lib/og-image';
import { buildPageMeta } from '@/lib/page-builders';
import type { Lang } from '@/i18n/ui';

// Per-locale OG card route for tag landing pages (`/og/tags/<tag>.png`).
// Drafts are visible in dev so an in-progress tag still has a card to
// pair with its TagPage; production excludes them like the rest of the
// site. The chrome (bottom-row credit + gradient border) is added in a
// post-processing pass so all card variants share the same look.
export async function buildTagOgRoute(lang: Lang) {
  const { profile, posts } = await buildPageMeta(lang);
  const profileChrome = {
    name: profile.name,
    iconPath: profile.icon ? './public/icon.png' : undefined,
    pageLabel: 'Tags',
  };

  const pages = Object.fromEntries(
    collectTags(posts).map((tag) => {
      const postsForTag = posts.filter((p) => (p.data.tags ?? []).includes(tag));
      return [
        tag,
        {
          title: stripForOg(`#${tag}`),
          description: describeTagCounts(lang, postsForTag.length),
        },
      ];
    }),
  );

  const og = await OGImageRoute({
    param: 'tag',
    pages,
    getImageOptions: (_path, page) => ({
      title: page.title,
      description: page.description,
      bgGradient: OG_BG_GRADIENT,
      padding: OG_PADDING,
      font: {
        title: { color: OG_TITLE_COLOR, size: 96, weight: 'Bold', families: OG_FONT_FAMILIES },
        description: { color: OG_DESC_COLOR, size: 32, weight: 'Bold', lineHeight: 1.4, families: OG_FONT_FAMILIES },
      },
      fonts: OG_FONTS,
    }),
  });

  const GET: APIRoute = async (ctx: APIContext) => {
    const res = await og.GET(ctx);
    const buf = Buffer.from(await res.arrayBuffer());
    return new Response(new Blob([await addOgChrome(buf, profileChrome)], { type: 'image/png' }));
  };

  return { getStaticPaths: og.getStaticPaths, GET };
}
