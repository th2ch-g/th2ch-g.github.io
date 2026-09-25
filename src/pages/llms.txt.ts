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
    `- [Home (en)](${site}/?lang=en): profile and academic / professional CV; default language.`,
    `- [Home (ja)](${site}/?lang=ja): Japanese profile and CV.`,
    `- [Posts (en)](${site}/posts?lang=en): shared Japanese technical and personal posts.`,
    `- [Posts (ja)](${site}/posts?lang=ja)`,
    `- [Gallery (en)](${site}/gallery?lang=en): photographs.`,
    `- [Gallery (ja)](${site}/gallery?lang=ja)`,
    `- [Contact (en)](${site}/contact?lang=en): contact form.`,
    `- [Contact (ja)](${site}/contact?lang=ja)`,
    `- [Sitemap](${site}/sitemap?lang=en)`,
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
