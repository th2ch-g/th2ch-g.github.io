// Prebuild: self-host the GitHub repo social-preview images that the
// remark-github-card plugin would otherwise hotlink from
// opengraph.githubassets.com at runtime. GitHub generates those images on
// demand and intermittently throttles / times out, leaving blank (gray)
// cards — especially on posts with several cards firing concurrent
// requests. Downloading them once at build time and serving from our own
// origin (GitHub Pages CDN) makes them reliable.
//
// Mirrors scripts/build-icon.mjs + src/lib/og-image.ts: fetch with a
// timeout + a few retries, skip files refreshed within the TTL, and stay
// fully fail-soft — a missing file just makes the card fall back to the
// upstream hotlink (today's behavior), never blocking the build.
//
// Wired into npm `build-assets` (predev / prebuild / prestart) alongside
// build-icon / build-fonts. The output dir is gitignored.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_URL, ogFilename, ogRemoteUrl } from '../src/plugins/lib/github-og.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(ROOT, 'public/github-og');
const CONTENT_DIR = resolve(ROOT, 'src/content');
// Refresh weekly so the baked card's star count / description doesn't
// drift too far. CI starts from an empty (gitignored) dir, so deploys
// always fetch fresh.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; astro-build/1.0)';

// Recursively collect .md files under src/content.
function walkMd(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// A card is produced only for a *standalone* repo URL (the plugin matches
// REPO_URL against a paragraph containing nothing else). A trimmed
// full-line match is a faithful, dependency-free approximation: inline
// `[text](url)` links and `/issues` paths don't match the anchored regex,
// so they're correctly ignored. Over-matching (e.g. a URL alone inside a
// code fence) only costs an unused download; under-matching falls back to
// the hotlink — both harmless.
function collectRepos() {
  const repos = new Map(); // ogFilename -> { owner, repo }
  for (const file of walkMd(CONTENT_DIR)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = line.trim().match(REPO_URL);
      if (m) repos.set(ogFilename(m[1], m[2]), { owner: m[1], repo: m[2] });
    }
  }
  return repos;
}

async function download(url) {
  // Retry transient network / cold-generation errors with a short backoff,
  // matching og-image.ts:downloadRemoteHero.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.5' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw new Error(`unexpected content-type ${type || '(none)'}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);
      return buf;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const repos = collectRepos();
if (repos.size === 0) {
  console.log('[build-github-og] no GitHub repo cards found, skipping');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
let fetched = 0;
let skipped = 0;
for (const [file, { owner, repo }] of repos) {
  const out = join(OUT_DIR, file);
  if (existsSync(out) && Date.now() - statSync(out).mtimeMs < TTL_MS) {
    skipped++;
    continue;
  }
  try {
    const buf = await download(ogRemoteUrl(owner, repo));
    writeFileSync(out, buf);
    fetched++;
    console.log(`[build-github-og] wrote ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    // Fail-soft: leave the file absent so the card falls back to the
    // upstream opengraph.githubassets.com URL (current behavior).
    console.warn(`[build-github-og] skipped ${owner}/${repo}: ${err.message}`);
  }
}
console.log(`[build-github-og] done: ${fetched} fetched, ${skipped} fresh-cached, ${repos.size} total`);
