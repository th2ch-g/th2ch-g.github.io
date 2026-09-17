import type { APIContext } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { requireSite } from '@/lib/site';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { getLocaleFileUrl } from '@/lib/locale-url';

// OPML feed export — a portable subscription bundle that RSS clients can
// import to add the site-wide feeds at once.
export async function GET(context: APIContext) {
  const site = requireSite(context).toString().replace(/\/$/, '');
  const { siteHandle } = await getProfileMeta('en');
  // OPML's `type="rss"` is the conventional value for both RSS and Atom
  // feeds; readers sniff the actual content type from the response. JSON
  // Feed has no widely-deployed OPML type, so it's omitted here and
  // remains discoverable from the page-level <link rel="alternate">.
  const feeds = (['en', 'ja'] as const).flatMap((lang) => [
    { type: 'rss', title: `${siteHandle} posts (${lang})`, url: `${site}${getLocaleFileUrl(lang, '/rss.xml')}`, html: `${site}${getRelativeLocaleUrl(lang, '/posts')}` },
    { type: 'rss', title: `${siteHandle} posts (${lang}, Atom)`, url: `${site}${getLocaleFileUrl(lang, '/atom.xml')}`, html: `${site}${getRelativeLocaleUrl(lang, '/posts')}` },
  ]);

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escape(siteHandle)} feeds</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${feeds
  .map(
    (f) =>
      `    <outline type="${f.type}" text="${escape(f.title)}" title="${escape(f.title)}" xmlUrl="${escape(f.url)}" htmlUrl="${escape(f.html)}"/>`,
  )
  .join('\n')}
  </body>
</opml>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/x-opml; charset=utf-8' },
  });
}
