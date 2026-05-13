// Remark plugin: convert a standalone GitHub repo URL on its own line
// into a Zenn / GitHub-style repo card. Repo metadata (description, star
// count, primary language) is fetched from the public GitHub REST API at
// build time and cached on disk so subsequent builds don't re-hit the
// 60-req/h unauthenticated rate limit. Network/API failures fall back to
// a stale cache when available, then to no-op (the URL is left alone and
// renders as a normal Markdown link) — never blocks the build, matching
// the convention used by `scripts/build-icon.mjs` / `scripts/build-fonts.mjs`.
import { visit } from 'unist-util-visit';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml as esc } from './lib/escape.mjs';
import { extractStandaloneUrl } from './lib/extract-url.mjs';
import { replaceWithHtml } from './lib/replace.mjs';
import { siteHost } from '../lib/profile-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../node_modules/.cache/github-card');
const TTL_MS = 24 * 60 * 60 * 1000;

// Strict match: only canonical owner/repo URLs. Reject anything with an
// extra path segment (`/issues`, `/blob/main/...`, `/pull/123`, etc.) so
// in-body file/issue links are not mis-promoted into cards.
// - owner: 1–39 chars, alnum or hyphens (GitHub username spec, simplified)
// - repo: 1–100 chars, alnum + `._-`
const REPO_URL = /^https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/?$/;

// Octicons (MIT, GitHub). Inlined so cards have zero asset dependencies,
// matching the `remark-callouts` convention.
const ICON_MARK = '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>';
const ICON_CODE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>';

function cachePath(owner, repo) {
  const key = `${owner}__${repo}`.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(CACHE_DIR, `${key}.json`);
}

async function readCache(owner, repo) {
  try {
    const buf = await readFile(cachePath(owner, repo), 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function writeCache(owner, repo, data) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      cachePath(owner, repo),
      JSON.stringify({ fetchedAt: Date.now(), data }),
    );
  } catch {
    // best-effort cache; never fail the build
  }
}

async function fetchRepo(owner, repo) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${await siteHost()}-build`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Authenticated requests get 5000 req/h instead of 60. CI passes
  // `GITHUB_TOKEN` automatically; locally it's optional.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    // GitHub API normally responds in <1s; cap at 15s so a network hang
    // doesn't pin the whole markdown render. AbortError surfaces through
    // the existing `getRepoData` catch and serves stale cache when present.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  return {
    owner: json.owner?.login ?? owner,
    name: json.name ?? repo,
    description: json.description ?? '',
    stars: json.stargazers_count ?? 0,
    language: json.language ?? '',
    url: json.html_url ?? `https://github.com/${owner}/${repo}`,
  };
}

async function getRepoData(owner, repo) {
  const cached = await readCache(owner, repo);
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS;
  if (fresh) return cached.data;
  try {
    const data = await fetchRepo(owner, repo);
    await writeCache(owner, repo, data);
    return data;
  } catch (err) {
    if (cached) return cached.data; // serve stale on network/API failure
    console.warn(`[remark-github-card] failed to fetch ${owner}/${repo}: ${err.message}`);
    return null;
  }
}

function formatStars(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(n / 1000) + 'k';
}

function renderCard(d) {
  const desc = d.description
    ? `<p class="gh-card-desc">${esc(d.description)}</p>`
    : '';
  const stars = `<span class="gh-card-stat" title="Stars">${ICON_STAR}<span>${esc(formatStars(d.stars))}</span></span>`;
  const lang = d.language
    ? `<span class="gh-card-stat" title="Language">${ICON_CODE}<span>${esc(d.language)}</span></span>`
    : '';
  return (
    `<a class="gh-card" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">` +
    `<div class="gh-card-head"><span class="gh-card-mark">${ICON_MARK}</span>` +
    `<span class="gh-card-title"><span class="gh-card-owner">${esc(d.owner)}</span>` +
    `<span class="gh-card-sep">/</span>` +
    `<span class="gh-card-repo">${esc(d.name)}</span></span></div>` +
    `${desc}<div class="gh-card-meta">${stars}${lang}</div></a>`
  );
}

export function remarkGithubCard() {
  return async (tree) => {
    // Two-pass: collect first (visit is sync), then resolve metadata in
    // parallel and replace by index. Indices stay valid because each task
    // is a 1:1 child replacement — no insert/remove shifts the array.
    const tasks = [];
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index == null || !parent) return;
      const url = extractStandaloneUrl(node, REPO_URL);
      if (!url) return;
      const m = url.match(REPO_URL);
      if (!m) return;
      tasks.push({ index, parent, owner: m[1], repo: m[2] });
    });
    if (tasks.length === 0) return;
    const resolved = await Promise.all(
      tasks.map(async (t) => ({ t, data: await getRepoData(t.owner, t.repo) })),
    );
    for (const { t, data } of resolved) {
      if (!data) continue;
      replaceWithHtml(t.parent, t.index, renderCard(data));
    }
  };
}
