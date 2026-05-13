// Optional post-deploy IndexNow ping. Reads the sitemap from `dist/`,
// extracts every URL, and POSTs them in one batch to api.indexnow.org.
// Skip when the indexnow key is empty so the script is a safe no-op
// in default configurations.
//
// Run after a successful deploy:
//
//   node scripts/indexnow-submit.mjs
//
// CI integration: add a workflow step gated on `secrets.INDEXNOW_KEY`.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = resolve(ROOT, 'dist');

const key = process.env.INDEXNOW_KEY;
if (!key) {
  console.log('[indexnow] INDEXNOW_KEY not set, skipping.');
  process.exit(0);
}

let sitemap = '';
try {
  sitemap = await readFile(join(distDir, 'sitemap-index.xml'), 'utf-8');
} catch {
  console.warn('[indexnow] sitemap-index.xml not found — run `npm run build` first.');
  process.exit(0);
}

// `<loc>https://...</loc>` extraction. Sitemap-index points at shards,
// each shard contains the actual URLs; gather URLs from every reachable
// shard before submitting.
const shardUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);

// Derive the site origin from the first shard URL rather than hardcoding
// it here. Sitemap shards are absolute URLs whose origin matches astro
// config's `site:`, so we stay in sync without depending on env vars or
// re-importing the Astro config.
if (shardUrls.length === 0) {
  console.warn('[indexnow] sitemap-index.xml has no <loc> entries — skipping.');
  process.exit(0);
}
const SITE = new URL(shardUrls[0]).origin;
const KEY_LOCATION = `${SITE}/indexnow-key.txt`;
const urls = new Set();
for (const shardUrl of shardUrls) {
  try {
    const res = await fetch(shardUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const body = await res.text();
    for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      urls.add(m[1]);
    }
  } catch {
    // Ignore unreachable shards (including AbortError on timeout); submit whatever we have.
  }
}

if (urls.size === 0) {
  console.warn('[indexnow] no URLs found in sitemap shards — skipping submission.');
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
