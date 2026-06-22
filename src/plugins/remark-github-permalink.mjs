// Remark plugin: convert a standalone GitHub *code permalink* on its own line
// into an inline code-snippet card. A URL like
//   https://github.com/<owner>/<repo>/blob/<ref>/<path>#L10-L20
// becomes a header (octocat + owner/repo/path + "Lines 10 to 20 in <sha>")
// above the referenced lines, syntax-highlighted with the same Shiki theme as
// the site's Markdown code blocks and numbered with the file's real (1690-…)
// line numbers — GitHub's own permalink-embed shape.
//
// Sibling to remark-github-card.mjs (bare repo-root URLs). The two never
// overlap: that plugin's REPO_URL is anchored to reject any extra path
// segment, while this one *requires* `/blob/…#L…`. The referenced file is
// fetched once at build time from raw.githubusercontent.com and cached on
// disk so repeat builds don't re-hit the network. A pinned-commit permalink
// is content-immutable, so its cache never expires; a branch/tag ref falls
// back to a 24 h TTL. Network failures serve a stale cache when present, then
// no-op (the URL is left as a normal Markdown link) — never blocks the build,
// mirroring remark-github-card's fail-soft contract.
//
// Highlighting goes through @astrojs/markdown-remark's createShikiHighlighter
// (a transitive Astro dep) rather than a raw `shiki` import: it defaults to
// the same `github-dark` theme as the Markdown pipeline, trims the trailing
// newline (no phantom blank line), and lazily loads / plaintext-falls-back
// unknown languages. Its built-in transformer stamps `data-language` onto the
// <pre>; we strip it in our own transformer so prose.css's language tab
// doesn't double up with our header.
import { visit } from 'unist-util-visit';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShikiHighlighter } from '@astrojs/markdown-remark';
import { escapeHtml as esc } from './lib/escape.mjs';
import { extractStandaloneUrl } from './lib/extract-url.mjs';
import { replaceWithHtml } from './lib/replace.mjs';
import { siteHost } from '../lib/profile-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../node_modules/.cache/github-permalink');
const TTL_MS = 24 * 60 * 60 * 1000;
// Cap the rendered slice so a pasted multi-hundred-line range can't blow the
// post open vertically; the overflow is linked out to GitHub instead.
const MAX_LINES = 40;

// owner / repo / blob / <ref> / <path> (?query)? (#L<start>(C<col>)? (-L<end>(C<col>)?)?)?
// The `#L…` line anchor is OPTIONAL: a bare `…/blob/<ref>/<path>` URL (no anchor)
// renders the whole file (from line 1, still subject to MAX_LINES truncation).
// `ref` is matched up to the next slash, so a branch name containing a slash
// won't parse — permalinks pin a commit SHA, so this is acceptable. An optional
// query (e.g. `?plain=1` on a Markdown file) is tolerated and discarded, as are
// column anchors (`C\d+`, GitHub's char-precise selection).
const PERMALINK_RE =
  /^https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/blob\/([^/#?]+)\/([^#?]+?)(?:\?[^#]*)?(?:#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?)?$/;

// Inlined GitHub mark (Octicons, MIT) — same path data as remark-github-card.
const ICON_MARK =
  '<svg class="gh-permalink-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

// File-extension → Shiki language id. Unmapped extensions are passed through
// (Shiki loads them if bundled, else warns + falls back to plaintext); files
// with no extension use `text`.
const EXT_TO_LANG = {
  rs: 'rust', py: 'python', ts: 'typescript', tsx: 'tsx', js: 'javascript',
  jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', go: 'go', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', rb: 'ruby', java: 'java',
  kt: 'kotlin', swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'jsonc', toml: 'toml',
  md: 'markdown', mdx: 'mdx', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', php: 'php', lua: 'lua', r: 'r', jl: 'julia', ex: 'elixir',
  exs: 'elixir', hs: 'haskell', scala: 'scala', dart: 'dart', vue: 'vue',
  svelte: 'svelte', astro: 'astro', nix: 'nix', zig: 'zig', proto: 'proto',
  graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff', xml: 'xml',
  ini: 'ini', pl: 'perl', pm: 'perl', tf: 'hcl', hcl: 'hcl',
};

function langFromPath(path) {
  const base = path.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  if (/^makefile$/i.test(base)) return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  // `||` (not `??`) so an extension-less file (ext === '') falls through to
  // `text` instead of passing an empty lang that makes Shiki warn every build.
  return EXT_TO_LANG[ext] || ext || 'text';
}

function parsePermalink(url) {
  const m = url.match(PERMALINK_RE);
  if (!m) return null;
  // No #L anchor → whole file: start at line 1, end left open (`null`) and
  // resolved to the file's length at fetch time.
  if (m[5] == null) {
    return { owner: m[1], repo: m[2], ref: m[3], path: m[4], start: 1, end: null };
  }
  let start = parseInt(m[5], 10);
  let end = m[6] ? parseInt(m[6], 10) : start;
  if (start > end) [start, end] = [end, start];
  return { owner: m[1], repo: m[2], ref: m[3], path: m[4], start, end };
}

const isSha = (ref) => /^[0-9a-f]{40}$/i.test(ref);

function cachePath(p) {
  const key = `${p.owner}__${p.repo}__${p.ref}__${p.path}__${p.start}-${p.end}`
    .replace(/[^A-Za-z0-9._-]/g, '_');
  return join(CACHE_DIR, `${key}.json`);
}

async function readCache(p) {
  try {
    return JSON.parse(await readFile(cachePath(p), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(p, data) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(p), JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // best-effort cache; never fail the build
  }
}

async function fetchSnippet(p) {
  const headers = { 'User-Agent': `${await siteHost()}-build` };
  // raw.githubusercontent.com serves public files unauthenticated; a token
  // (CI passes GITHUB_TOKEN automatically) lifts the rate limit and reaches
  // private repos.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const raw = `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.ref}/${p.path}`;
  // Cap at 15s so a network hang doesn't pin the whole markdown render; the
  // AbortError surfaces through getSnippet's catch and serves stale cache.
  const res = await fetch(raw, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`raw.githubusercontent ${res.status}`);
  const all = (await res.text()).split('\n');
  // 1-indexed inclusive slice, clamped to the file's actual length. A null end
  // (whole-file URL, no #L anchor) slices through to the last line.
  const sliced = p.end == null ? all.slice(p.start - 1) : all.slice(p.start - 1, p.end);
  // A file-final "\n" makes split() yield a trailing "" element. If the range
  // over-reaches the last content line, that empty tail would inflate the gutter
  // by one while createShikiHighlighter trims the trailing newline away — a
  // phantom line number. Drop it so the gutter count matches the rendered code.
  if (sliced.at(-1) === '') sliced.pop();
  if (sliced.length === 0) throw new Error('empty slice (range outside file)');
  const truncated = sliced.length > MAX_LINES;
  const lines = truncated ? sliced.slice(0, MAX_LINES) : sliced;
  return {
    code: lines.join('\n'),
    lang: langFromPath(p.path),
    startLine: p.start,
    endLine: p.start + lines.length - 1,
    remaining: truncated ? sliced.length - MAX_LINES : 0,
  };
}

async function getSnippet(p) {
  const cached = await readCache(p);
  // A 40-char hex ref is an immutable commit SHA: its content never changes,
  // so cache forever. A branch / tag ref can move — age it out after the TTL.
  const fresh = cached && (isSha(p.ref) || Date.now() - cached.fetchedAt < TTL_MS);
  if (fresh) return cached.data;
  try {
    const data = await fetchSnippet(p);
    await writeCache(p, data);
    return data;
  } catch (err) {
    if (cached) return cached.data; // serve stale on network/API failure
    console.warn(
      `[remark-github-permalink] failed to fetch ${p.owner}/${p.repo} ${p.path}: ${err.message}`,
    );
    return null;
  }
}

// Lazily created once per build process. createShikiHighlighter caches the
// underlying highlighter internally and shares it with Astro's pipeline, so
// calling it per snippet is cheap.
let _highlighter;
const getHighlighter = () => (_highlighter ??= createShikiHighlighter());

async function renderCard(url, p, snip) {
  const highlighter = await getHighlighter();
  let codeBg = '#24292e'; // github-dark editor background; refined from Shiki below
  const inner = await highlighter.codeToHtml(snip.code, snip.lang, {
    transformers: [
      {
        pre(node) {
          const style = String(node.properties.style ?? '');
          const bg = /background(?:-color)?:\s*([^;]+)/i.exec(style);
          if (bg) codeBg = bg[1].trim();
          // Strip the data-language Astro stamps on (prevents prose.css's
          // language tab from doubling our header) and relocate the
          // horizontal scroller from <pre> to <code> by dropping the pre's
          // overflow — so the sticky line-number gutter and header don't
          // drift when a wide line scrolls.
          delete node.properties.dataLanguage;
          node.properties.style = `${style.replace(/overflow-x:\s*auto;?/gi, '')}; overflow: hidden`;
          node.properties.class = `${node.properties.class ?? ''} gh-permalink-pre`.trim();
        },
        code(node) {
          node.properties.tabindex = '0'; // keep the wide-code scroller keyboard-focusable
        },
      },
    ],
  });
  const shortRef = isSha(p.ref) ? p.ref.slice(0, 7) : p.ref;
  const range =
    snip.startLine === snip.endLine
      ? `Line ${snip.startLine}`
      : `Lines ${snip.startLine} to ${snip.endLine}`;
  // Line numbers live in a separate, non-scrolling column OUTSIDE the <pre>:
  // the gutter then stays pinned while the code scrolls horizontally, and the
  // digits never reach the copy button's `pre.textContent`. Alignment with the
  // code is by shared font-size / line-height / top padding (see prose.css).
  const gutterNums = Array.from(
    { length: snip.endLine - snip.startLine + 1 },
    (_, i) => snip.startLine + i,
  ).join('\n');
  const more =
    snip.remaining > 0
      ? `<a class="gh-permalink-more" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${snip.remaining} more line${snip.remaining === 1 ? '' : 's'} on GitHub &rarr;</a>`
      : '';
  return (
    `<figure class="gh-permalink-card" style="--gh-code-bg: ${esc(codeBg)}">` +
    `<a class="gh-permalink-header" href="${esc(url)}" target="_blank" rel="noopener noreferrer">` +
    ICON_MARK +
    `<span class="gh-permalink-path">${esc(`${p.owner}/${p.repo}/${p.path}`)}</span>` +
    `<span class="gh-permalink-meta">${esc(range)} in ${esc(shortRef)}</span>` +
    `</a>` +
    `<div class="gh-permalink-body">` +
    `<div class="gh-permalink-nums" aria-hidden="true">${gutterNums}</div>` +
    inner +
    `</div>` +
    more +
    `</figure>`
  );
}

export function remarkGithubPermalink() {
  return async (tree) => {
    // Two-pass: collect synchronously (visit is sync), then resolve snippets
    // and replace by index. Indices stay valid because each task is a 1:1
    // child replacement — no insert/remove shifts the array.
    const tasks = [];
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index == null || !parent) return;
      const url = extractStandaloneUrl(node, PERMALINK_RE);
      if (!url) return;
      const p = parsePermalink(url);
      if (!p) return;
      tasks.push({ index, parent, url, p });
    });
    if (tasks.length === 0) return;
    const resolved = await Promise.all(
      tasks.map(async (t) => ({ t, snip: await getSnippet(t.p) })),
    );
    for (const { t, snip } of resolved) {
      if (!snip) continue;
      replaceWithHtml(t.parent, t.index, await renderCard(t.url, t.p, snip));
    }
  };
}
