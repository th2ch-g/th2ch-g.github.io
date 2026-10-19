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
// fully fail-soft — a missing file leaves a text-only card, never
// blocking the build or depending on a flaky upstream image at runtime.
//
// Wired into npm `build-assets` (predev / prebuild / prestart) alongside
// build-icon / build-fonts. The output dir is gitignored.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { REPO_URL, ogFilename, ogRemoteUrl } from '../src/plugins/lib/github-og.mjs';
import { readResponseBuffer } from '../src/plugins/lib/response-body.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(ROOT, 'public/github-og');
const CONTENT_DIR = resolve(ROOT, 'src/content');
// Refresh weekly so the baked card's star count / description doesn't
// drift too far. CI preserves this directory between deployments.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_BACKOFF_MS = 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; astro-build/1.0)';
const run = promisify(execFile);

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
// code fence) only costs an unused download; under-matching leaves a
// text-only card.
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

async function restorePublishedImages(repos) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (process.env.GITHUB_ACTIONS !== 'true' || !repository || !token) return;
  if ([...repos.keys()].some((file) => existsSync(join(OUT_DIR, file)))) return;

  // Recover a cold or evicted cache from successful deployments. Extract only
  // the requested images, and keep the newest available copy of each file.
  const workDir = mkdtempSync(join(tmpdir(), 'github-card-restore-'));
  const options = { env: { ...process.env, GH_TOKEN: token }, timeout: 120_000 };
  try {
    const { stdout } = await run('gh', [
      'run', 'list', '--repo', repository, '--workflow', 'deploy.yml',
      '--branch', process.env.GITHUB_REF_NAME || 'main', '--status', 'success',
      '--limit', '3', '--json', 'databaseId',
    ], options);
    for (const { databaseId } of JSON.parse(stdout)) {
      if (!Number.isSafeInteger(databaseId)) continue;
      const artifactDir = join(workDir, String(databaseId));
      try {
        await run('gh', [
          'run', 'download', String(databaseId), '--repo', repository,
          '--name', 'github-pages', '--dir', artifactDir,
        ], options);
        const archive = join(artifactDir, 'artifact.tar');
        const { stdout: listing } = await run('tar', ['-tf', archive]);
        const available = new Set(listing.split('\n'));
        const files = [...repos.keys()].filter((file) => !existsSync(join(OUT_DIR, file)));
        const members = files.map((file) => [`./github-og/${file}`, `github-og/${file}`]
          .find((member) => available.has(member))).filter(Boolean);
        if (!members.length) continue;
        const extracted = join(artifactDir, 'images');
        mkdirSync(extracted, { recursive: true });
        await run('tar', ['-xf', archive, '-C', extracted, '--', ...members]);
        let restored = 0;
        for (const file of files) {
          const source = join(extracted, 'github-og', file);
          if (!existsSync(source)) continue;
          const stat = lstatSync(source);
          if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) continue;
          const destination = join(OUT_DIR, file);
          copyFileSync(source, destination);
          utimesSync(destination, stat.atime, stat.mtime);
          restored++;
        }
        console.log(`[build-github-og] restored ${restored} images from successful Pages build ${databaseId}`);
        if ([...repos.keys()].every((file) => existsSync(join(OUT_DIR, file)))) break;
      } catch (err) {
        console.warn(`[build-github-og] could not restore Pages build ${databaseId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[build-github-og] published image recovery unavailable: ${err.message}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
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
      if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw new Error(`unexpected content-type ${type || '(none)'}`);
      const buf = await readResponseBuffer(res, MAX_BYTES);
      if (buf.length === 0) throw new Error('empty body');
      return buf;
    } catch (err) {
      lastErr = err;
      if (err.status === 429) throw err;
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
await restorePublishedImages(repos);
let fetched = 0;
let skipped = 0;
let rateLimited = false;
for (const [file, { owner, repo }] of repos) {
  const out = join(OUT_DIR, file);
  if (existsSync(out) && Date.now() - statSync(out).mtimeMs < TTL_MS) {
    skipped++;
    continue;
  }
  try {
    if (rateLimited) throw new Error('GitHub preview requests paused after HTTP 429');
    const buf = await download(ogRemoteUrl(owner, repo));
    writeFileSync(out, buf);
    fetched++;
    console.log(`[build-github-og] wrote ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    if (err.status === 429) rateLimited = true;
    // Keep a text-only card when no local image could be downloaded.
    if (existsSync(out)) {
      // Keep a stale-but-valid local image and avoid retrying a failing
      // endpoint on every local dev/build command. Its synthetic mtime makes
      // it eligible for refresh again after the short backoff.
      const retryMtime = new Date(Date.now() - TTL_MS + RETRY_BACKOFF_MS);
      utimesSync(out, retryMtime, retryMtime);
    }
    console.warn(`[build-github-og] skipped ${owner}/${repo}: ${err.message}`);
  }
}
// `astro check` can render and cache Markdown before prebuild downloads
// these images. Re-render it after asset preparation so image paths reflect
// the files that will actually be deployed, including warm local builds.
rmSync(resolve(ROOT, 'node_modules/.astro/data-store.json'), { force: true });
console.log(`[build-github-og] done: ${fetched} fetched, ${skipped} fresh-cached, ${repos.size} total`);
