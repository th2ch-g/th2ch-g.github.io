// Inject `<?xml-stylesheet ?>` PIs into every dist/sitemap*.xml so
// browsers render the XML using public/sitemap.xsl. Crawlers ignore the
// PI, so SEO is unaffected.
//
// Why post-process instead of @astrojs/sitemap's `xslURL` option:
// that option resolves the URL against `site` and emits an absolute
// production href. Local `npm run preview` then issues a cross-origin
// XSL fetch (or 404 before the first deploy), so the stylesheet never
// applies during local verification. A relative `/sitemap.xsl` works
// on every origin.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = 'dist';
const xslHref = '/sitemap.xsl';
const pi = `<?xml-stylesheet type="text/xsl" href="${xslHref}"?>`;

const entries = await readdir(distDir);
const sitemaps = entries.filter((f) => /^sitemap.*\.xml$/.test(f));

let touched = 0;
for (const f of sitemaps) {
  const path = join(distDir, f);
  let xml = await readFile(path, 'utf8');
  if (xml.includes('<?xml-stylesheet')) continue;
  // Insert immediately after the XML declaration; fall back to prepend
  // if for some reason the declaration is absent.
  if (/^<\?xml[^?]*\?>/.test(xml)) {
    xml = xml.replace(/(<\?xml[^?]*\?>)/, `$1\n${pi}`);
  } else {
    xml = `${pi}\n${xml}`;
  }
  await writeFile(path, xml);
  touched += 1;
}

console.log(
  `inject-sitemap-xsl: stylesheet PI injected into ${touched}/${sitemaps.length} file(s)`,
);
