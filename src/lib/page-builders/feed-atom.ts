import type { APIContext } from 'astro';
import { localeSlug } from '@/lib/content';
import { renderFeedHtml } from '@/lib/rss';
import { buildPageMeta } from '@/lib/page-builders';
import { requireSite } from '@/lib/site';
import type { Lang } from '@/i18n/ui';

// Five-entity escape: safe for both element text content and attribute
// values, matching the escaper sitemap-images.xml.ts already uses.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Atom 1.0 (RFC 4287) sibling of the RSS handler. Feed readers that
// prefer Atom (NetNewsWire, Feedbin etc.) consume this; the WebSub hub
// is advertised at the channel level via <link rel="hub">.
export function buildAtomFeedHandler(lang: Lang) {
  const isEn = lang === 'en';
  const titleSuffix = isEn ? ' (en)' : '';
  const localePrefix = isEn ? '/en' : '';
  const selfPath = `${localePrefix}/atom.xml`;

  return async function GET(context: APIContext) {
    const { profile, posts } = await buildPageMeta(lang);
    const site = requireSite(context);
    const homeUrl = new URL(`${localePrefix}/`, site).toString();
    const selfUrl = new URL(selfPath, site).toString();
    // The feed's `<updated>` is the most-recent entry's update timestamp,
    // falling back to the build moment when the feed is empty.
    const newest = posts[0];
    const feedUpdated = (
      newest?.data.updatedDate ??
      newest?.data.pubDate ??
      new Date()
    ).toISOString();

    const entryXml = posts
      .map((post) => {
        const url = new URL(
          `${localePrefix}/posts/${localeSlug(post.id)}/`,
          site,
        ).toString();
        const updated = (
          post.data.updatedDate ?? post.data.pubDate
        ).toISOString();
        const content = renderFeedHtml(post.body ?? '');
        const lines = [
          `  <entry>`,
          `    <id>${xmlEscape(url)}</id>`,
          `    <title>${xmlEscape(post.data.title)}</title>`,
          `    <link href="${xmlEscape(url)}"/>`,
          `    <published>${post.data.pubDate.toISOString()}</published>`,
          `    <updated>${updated}</updated>`,
        ];
        if (post.data.description) {
          lines.push(`    <summary>${xmlEscape(post.data.description)}</summary>`);
        }
        lines.push(`    <content type="html">${xmlEscape(content)}</content>`);
        for (const tag of post.data.tags ?? []) {
          lines.push(`    <category term="${xmlEscape(tag)}"/>`);
        }
        lines.push(
          `    <author><name>${xmlEscape(profile.name)}</name></author>`,
        );
        lines.push(`  </entry>`);
        return lines.join('\n');
      })
      .join('\n');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">\n` +
      `  <id>${xmlEscape(homeUrl)}</id>\n` +
      `  <title>${xmlEscape(`${profile.siteHandle} posts${titleSuffix}`)}</title>\n` +
      `  <link rel="self" href="${xmlEscape(selfUrl)}"/>\n` +
      `  <link href="${xmlEscape(homeUrl)}"/>\n` +
      `  <link rel="hub" href="https://pubsubhubbub.appspot.com/"/>\n` +
      `  <updated>${feedUpdated}</updated>\n` +
      `  <author><name>${xmlEscape(profile.name)}</name></author>\n` +
      (entryXml ? entryXml + '\n' : '') +
      `</feed>\n`;

    return new Response(xml, {
      headers: { 'content-type': 'application/atom+xml; charset=utf-8' },
    });
  };
}
