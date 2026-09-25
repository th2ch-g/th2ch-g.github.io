// Optional post-deploy IndexNow ping using the built page inventory.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteUrl } from '../src/lib/profile-yaml.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = resolve(ROOT, 'dist');

const key = process.env.INDEXNOW_KEY;
if (!key) {
  console.log('[indexnow] INDEXNOW_KEY not set, skipping.');
  process.exit(0);
}

const SITE = await siteUrl();
const KEY_LOCATION = new URL('/indexnow-key.txt', SITE).href;
let items;
try {
  ({ items } = JSON.parse(await readFile(join(distDir, 'search-index.json'), 'utf8')));
} catch {
  console.warn('[indexnow] Search index not found - run npm run build first.');
  process.exit(0);
}
const urls = new Set(items.map((item) => new URL(item.url, SITE).href));
if (urls.size === 0) {
  console.warn('[indexnow] No pages found - skipping submission.');
  process.exit(0);
}

const payload = {
  host: new URL(SITE).host,
  key,
  keyLocation: KEY_LOCATION,
  urlList: [...urls],
};

try {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    // 15s cap so a network hang doesn't strand a manual post-deploy step.
    signal: AbortSignal.timeout(15_000),
  });

  console.log(`[indexnow] submitted ${urls.size} URLs — status ${res.status}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(text);
  }
} catch (err) {
  // IndexNow is best-effort; a timeout or network error must not exit
  // non-zero (deploys still finish even when indexing pings fail).
  console.warn(`[indexnow] submission failed: ${err.message}`);
  process.exit(0);
}
