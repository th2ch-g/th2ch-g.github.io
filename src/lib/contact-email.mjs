import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeMarkdown } from './markdown-summary.mjs';

// Build-time callers cannot use Astro's content collection API.
export async function contactEmail() {
  for (const lang of ['en', 'ja']) {
    let body;
    try {
      body = await readFile(resolve('src/content/contact', `${lang}.md`), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const { links } = await summarizeMarkdown(body);
    const email = links.find((href) => href.startsWith('mailto:'))?.slice(7).split('?')[0];
    if (email) return email;
  }
}
