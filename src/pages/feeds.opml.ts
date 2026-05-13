import type { APIContext } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { requireSite } from '@/lib/site';

// OPML feed export — a portable subscription bundle that RSS clients can
// import to add every feed at once. We list site-wide feeds only; per-tag
// feeds would balloon the file and are still individually discoverable
// from each tag page's `<link rel="alternate">`.
export async function GET(context: APIContext) {
  const site = requireSite(context).toString().replace(/\/$/, '');
  // OPML title and feed labels read in any locale, so source the site
  // brand from JA profile (siteHandle is locale-independent).
  const { siteHandle } = await getProfileMeta('ja');
  // OPML's `type="rss"` is the conventional value for both RSS and Atom
  // feeds; readers sniff the actual content type from the response. JSON
  // Feed has no widely-deployed OPML type, so it's omitted here and
  // remains discoverable from the page-level <link rel="alternate">.
  const feeds = [
    { type: 'rss', title: `${siteHandle} posts (ja)`, url: `${site}/rss.xml`, html: `${site}/posts` },
    { type: 'rss', title: `${siteHandle} posts (en)`, url: `${site}/en/rss.xml`, html: `${site}/en/posts` },
    { type: 'rss', title: `${siteHandle} posts (ja, Atom)`, url: `${site}/atom.xml`, html: `${site}/posts` },
    { type: 'rss', title: `${siteHandle} posts (en, Atom)`, url: `${site}/en/atom.xml`, html: `${site}/en/posts` },
  ];

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
