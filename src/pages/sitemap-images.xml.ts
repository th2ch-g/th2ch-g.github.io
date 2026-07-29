import type { APIContext, ImageMetadata } from 'astro';
import { getPublishedByLang, localeSlug, sortByDateDesc } from '@/lib/content';
import { requireSite } from '@/lib/site';

// Image sitemap (https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps).
// Lists every page URL alongside the images on that page so Google Image
// Search can index them. Astro's @astrojs/sitemap integration does not
// emit `image:image` extensions, so this is a dedicated companion sitemap
// referenced from robots.txt.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(context: APIContext) {
  const site = requireSite(context);
  const entries: Array<{ url: string; images: Array<{ url: string; title?: string; caption?: string }> }> = [];

  for (const lang of ['ja', 'en'] as const) {
    const langPrefix = lang === 'en' ? '/en' : '';

    // Posts: the generated per-post OG card is the first-class image.
    // Sort by pubDate so same-day entries stay in a stable order across
    // builds — otherwise the sitemap churns on every regeneration.
    const posts = sortByDateDesc(await getPublishedByLang('posts', lang), 'pubDate');
    for (const post of posts) {
      const slug = localeSlug(post.id);
      const url = new URL(`${langPrefix}/posts/${slug}/`, site).toString();
      const images = [{
        url: new URL(`${langPrefix}/og/${slug}.png`, site).toString(),
        title: post.data.title,
      }];
      entries.push({ url, images });
    }

    // Gallery images: loose files in `src/content/gallery/`. They're listed
    // here under the gallery URL itself rather than per-photo pages, since
    // the gallery has no individual detail pages any more.
    const photoModules = import.meta.glob<{ default: ImageMetadata }>(
      '/src/content/gallery/*.{jpg,jpeg,png,webp,avif,svg}',
      { eager: true },
    );
    const photoEntries = Object.values(photoModules).map((mod) => ({
      url: new URL(mod.default.src, site).toString(),
    }));
    if (photoEntries.length > 0) {
      entries.push({
        url: new URL(`${langPrefix}/photos/`, site).toString(),
        images: photoEntries,
      });
    }
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    entries
      .map((entry) => {
        const imageNodes = entry.images
          .map((img) => {
            const parts = [`    <image:loc>${xmlEscape(img.url)}</image:loc>`];
            if (img.title) parts.push(`    <image:title>${xmlEscape(img.title)}</image:title>`);
            if (img.caption) parts.push(`    <image:caption>${xmlEscape(img.caption)}</image:caption>`);
            return `  <image:image>\n${parts.join('\n')}\n  </image:image>`;
          })
          .join('\n');
        return `<url>\n  <loc>${xmlEscape(entry.url)}</loc>\n${imageNodes}\n</url>`;
      })
      .join('\n') +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
