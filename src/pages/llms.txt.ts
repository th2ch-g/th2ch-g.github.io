import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { requireSite } from '@/lib/site';

// llms.txt — sitemap-style hint for LLM crawlers. Generated entirely
// from profile.yaml + the configured site URL so a fork inherits the
// correct identity without touching this file. The "About" line is
// composed from siteHandle + bio (EN flatten); if
// any of those are blank the surrounding punctuation collapses.
export const GET: APIRoute = async (context) => {
  const site = requireSite(context).toString().replace(/\/$/, '');
  const meta = await getProfileMeta('en');
  const repoUrl = meta.repo ? `https://github.com/${meta.repo}` : undefined;

  const tagline = meta.bio ?? '';
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
    `- [Home (en)](${site}/): profile and academic / professional CV; default language.`,
    `- [Home (ja)](${site}/ja/): Japanese profile and CV.`,
    `- [Posts (en)](${site}/posts): shared Japanese technical and personal posts.`,
    `- [Posts (ja)](${site}/ja/posts)`,
    `- [Gallery (en)](${site}/gallery): photographs.`,
    `- [Gallery (ja)](${site}/ja/gallery)`,
    `- [Contact (en)](${site}/contact): contact form.`,
    `- [Contact (ja)](${site}/ja/contact)`,
    `- [Sitemap](${site}/sitemap-index.xml)`,
  ];

  if (repoUrl) {
    sections.push(
      '',
      '## Optional',
      '',
      `- [GitHub repository](${repoUrl}): source for this site (Astro + Content Collections).`,
      `- [Source license](${repoUrl}/blob/main/LICENSE): MIT.`,
      `- [Content license](${repoUrl}/blob/main/LICENSE-content): CC BY 4.0.`,
    );
  }

  return new Response(sections.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
