import type { APIContext, APIRoute } from 'astro';
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
import { addOgChrome, prepareHeroBackdrop, resolveHeroImageSource } from '@/lib/og-image';
import { buildPageMeta } from '@/lib/page-builders';
import type { Lang } from '@/i18n/ui';

// Build the per-locale OG card route for post details (`/og/<slug>.png`).
// The route is identical between locales except for the post collection
// filter and the profile metadata source. Hero-image preparation, the
// astro-og-canvas options, and the chrome decoration step (gradient
// border + bottom-row credit) are all shared.
export async function buildPostOgRoute(lang: Lang) {
  const { profile, posts: validPosts } = await buildPageMeta(lang);
  const profileChrome = {
    name: profile.name,
    iconPath: profile.icon ? './public/icon.png' : undefined,
    pageLabel: 'Posts',
  };
  const pageEntries = await Promise.all(
    validPosts.map(async (p) => {
      const source = resolveHeroImageSource(p);
      let heroBg: string | undefined;
      if (source) {
        try {
          heroBg = await prepareHeroBackdrop(source);
        } catch (err) {
          // Fail soft: a remote hero that 404s, times out, or returns a
          // non-image body shouldn't break the rest of the OG pipeline.
          // The card falls back to the gradient-only design for this post.
          console.warn(
            `[og-post] failed to prepare hero for ${p.id}: ${(err as Error).message ?? err}`,
          );
        }
      }
      return [
        localeSlug(p.id),
        {
          title: stripForOg(p.data.title),
          description: stripForOg(p.data.description ?? ''),
          heroBg,
        },
      ] as const;
    }),
  );
  const pages = Object.fromEntries(pageEntries);

  const og = await OGImageRoute({
    param: 'slug',
    pages,
    getImageOptions: (_path, page) => ({
      title: page.title,
      description: page.description,
      bgGradient: OG_BG_GRADIENT,
      ...(page.heroBg
        ? { bgImage: { path: page.heroBg, fit: 'cover' as const } }
        : {}),
      padding: OG_PADDING,
      font: {
        title: { color: OG_TITLE_COLOR, size: 64, weight: 'Bold', families: OG_FONT_FAMILIES },
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
