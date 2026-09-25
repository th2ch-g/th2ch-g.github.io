import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { createIndex, close } from 'pagefind';

const distDir = resolve(import.meta.dirname, '../dist');
const { items } = JSON.parse(await readFile(resolve(distDir, 'search-index.json'), 'utf8'));
const markdown = await createMarkdownProcessor({ syntaxHighlight: false });
const escape = (text) => text.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const check = (result) => {
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return result;
};

try {
  const { index } = check(await createIndex());
  if (!index) throw new Error('Pagefind did not create an index');
  for (const item of items) {
    const { code } = await markdown.render(item.body);
    const year = item.date && item.url.startsWith('/posts/')
      ? `<span data-pagefind-filter="year:${item.date.slice(0, 4)}"></span>` : '';
    check(await index.addHTMLFile({
      url: item.url,
      content: `<html lang="${item.lang}"><head><title>${escape(item.title)}</title></head>`
        + `<body><main data-pagefind-body><h1>${escape(item.title)}</h1>`
        + `<p>${escape(item.description)}</p>${year}${code}</main></body></html>`,
    }));
  }
  check(await index.writeFiles({ outputPath: resolve(distDir, 'pagefind') }));
  console.log(`[search] Indexed ${items.length} pages with language query URLs.`);
} finally {
  await close();
}
