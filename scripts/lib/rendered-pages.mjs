import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function renderedPages(distDir) {
  return readdirSync(distDir, { recursive: true })
    .filter((file) => file.endsWith('.html'))
    .map((file) => ({
      path: '/' + file.split(sep).join('/').replace(/index\.html$/, ''),
      html: readFileSync(resolve(distDir, file), 'utf8'),
    }))
    .filter(({ html }) => html.includes('<main'))
    .map((page) => ({
      ...page,
      locales: page.html.match(/<html\b[^>]*\bdata-content-locales="([^"]+)"/)?.[1].split(' ') ?? ['en', 'ja'],
    }));
}

export function localizedPagePaths(distDir) {
  return renderedPages(distDir).flatMap(({ path, locales }) =>
    path === '/404.html' ? [path] : locales.map((lang) => `${path}?lang=${lang}`)).sort();
}
