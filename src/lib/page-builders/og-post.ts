import { OGImageRoute } from 'astro-og-canvas';
import { localeSlug } from '@/lib/content';
import {
  OG_BG_GRADIENT,
  OG_FONTS,
  OG_FONT_FAMILIES,
  OG_PADDING,
  OG_TITLE_COLOR,
  OG_DESC_COLOR,
  stripForOg,
} from '@/lib/og-config';
import { ogPngSlug, makeChromedOgGet } from './og-route';
import { buildPageMeta } from '@/lib/page-builders';
import type { Lang } from '@/i18n/ui';

// Build the per-locale OG card route for post details (`/og/<slug>.png`).
// The route is identical between locales except for the post collection
// filter and the profile metadata source. The astro-og-canvas options and
// chrome decoration step (gradient border + bottom-row credit) are shared.
export async function buildPostOgRoute(lang: Lang) {
  const { profile, posts: validPosts } = await buildPageMeta(lang);
  const profileChrome = {
    name: profile.name,
    iconPath: profile.icon ? './public/icon.png' : undefined,
    pageLabel: 'Posts',
  };
  const pageEntries = validPosts.map((post) => [
    localeSlug(post.id),
    {
      title: stripForOg(post.data.title),
      description: stripForOg(post.data.description ?? ''),
    },
  ] as const);
  const pages = Object.fromEntries(pageEntries);

  const og = await OGImageRoute({
    pages,
    getSlug: ogPngSlug,
    getImageOptions: (_path, page) => ({
      title: page.title,
      description: page.description,
      bgGradient: OG_BG_GRADIENT,
      padding: OG_PADDING,
      font: {
        title: { color: OG_TITLE_COLOR, size: 64, weight: 'Bold', families: OG_FONT_FAMILIES },
        description: { color: OG_DESC_COLOR, size: 32, weight: 'Bold', lineHeight: 1.4, families: OG_FONT_FAMILIES },
      },
      fonts: OG_FONTS,
    }),
  });

  return { getStaticPaths: og.getStaticPaths, GET: makeChromedOgGet(og, profileChrome) };
}
