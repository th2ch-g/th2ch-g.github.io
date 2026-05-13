import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { requireSite } from '@/lib/site';

// llms.txt — sitemap-style hint for LLM crawlers. Generated entirely
// from profile.yaml + the configured site URL so a fork inherits the
// correct identity without touching this file. The "About" line is
// composed from siteHandle + headline + affiliation (EN flatten); if
// any of those are blank the surrounding punctuation collapses.
export const GET: APIRoute = async (context) => {
  const site = requireSite(context).toString().replace(/\/$/, '');
  const meta = await getProfileMeta('en');
  const repoUrl = meta.repo ? `https://github.com/${meta.repo}` : undefined;

  const tagline = [meta.headline, meta.affiliation].filter(Boolean).join(' — ');
  const aboutLine =
    `> Personal portfolio site of ${meta.siteHandle}` +
    (tagline ? ` (${tagline}).` : '.') +
    ' Covers posts, photos, and CV.';

  const sections = [
    `# ${meta.siteHandle}`,
    '',
    aboutLine,
    '',
    'This site honors `noai` / `noimageai` robot directives in `<meta>` and `/robots.txt`. The post content under `src/content/posts/` is licensed CC BY 4.0 (see `LICENSE-content`); attribution is required for any reuse. Code samples are MIT-licensed (see `LICENSE`). LLM crawlers should respect these signals.',
    '',
    '## Site map',
    '',
    `- [Home (ja)](${site}/): recent posts, profile snapshot.`,
    `- [Home (en)](${site}/en/): English mirror.`,
    `- [CV (ja)](${site}/cv): academic / professional CV.`,
    `- [CV (en)](${site}/en/cv): English CV.`,
    `- [Posts (ja)](${site}/posts): technical and personal posts.`,
    `- [Posts (en)](${site}/en/posts)`,
    `- [Gallery (ja)](${site}/photos): photographs.`,
    `- [Gallery (en)](${site}/en/photos)`,
    '',
    '## Feeds',
    '',
    `- [RSS (ja posts)](${site}/rss.xml)`,
    `- [RSS (en posts)](${site}/en/rss.xml)`,
    `- [Sitemap](${site}/sitemap-index.xml)`,
  ];

  if (repoUrl) {
    sections.push(
      '',
      '## Optional',
      '',
      `- [GitHub repository](${repoUrl}): source for this site (Astro 5 + Content Collections).`,
      `- [Source license](${repoUrl}/blob/main/LICENSE): MIT.`,
      `- [Content license](${repoUrl}/blob/main/LICENSE-content): CC BY 4.0.`,
    );
  }

  return new Response(sections.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
