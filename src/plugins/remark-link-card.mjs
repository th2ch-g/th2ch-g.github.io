// Remark plugin: convert a standalone non-GitHub/Twitter URL on its own
// line into a Twitter-style link-preview card. OpenGraph metadata
// (og:title / og:description / og:image / og:site_name) is fetched at
// build time and cached on disk, mirroring `remark-github-card.mjs`.
// Network failures fall back to a stale cache, then to no-op (the URL
// renders as a normal Markdown link) — never blocks the build.
import { visit } from 'unist-util-visit';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { escapeHtml as esc } from './lib/escape.mjs';
import { replaceWithHtml } from './lib/replace.mjs';
import { siteHost, readProfileShallow } from '../lib/profile-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../node_modules/.cache/link-card');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Accept any http(s) URL; the host-based skip below filters out hosts
// that already have a dedicated card/embed plugin.
const ANY_HTTP_URL = /^https?:\/\/\S+$/;
const SKIP_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
  'mobile.twitter.com',
]);

// Extensions we treat as "this URL *is* an image, don't try OG-fetching".
// Matched against the URL's pathname so query strings (CDN sizing params,
// signed-URL tokens, ...) don't get in the way.
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
function isImageUrl(url) {
  try {
    return IMAGE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Cap response body to avoid pulling a multi-MB SPA bundle for one card.
// 256 KB is enough to hold a typical <head> several times over.
const MAX_BYTES = 256 * 1024;

function cachePath(url) {
  const h = createHash('sha1').update(url).digest('hex').slice(0, 20);
  return join(CACHE_DIR, `${h}.json`);
}

async function readCache(url) {
  try {
    return JSON.parse(await readFile(cachePath(url), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(url, data) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      cachePath(url),
      JSON.stringify({ fetchedAt: Date.now(), data }),
    );
  } catch {
    // best-effort cache; never fail the build
  }
}

// Decode the handful of HTML entities that legitimately appear inside
// meta `content="..."` attribute values. We intentionally stay narrow —
// running a full HTML parser here would be overkill and pulls in deps.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function parseMeta(html, pageUrl) {
  // Slice the <head> region when present to bound regex work. Sites that
  // emit OG tags below </head> are rare enough that the fallback to
  // first-64KB scan is fine.
  const headMatch = html.match(/<head[\s>][\s\S]*?<\/head>/i);
  const region = headMatch ? headMatch[0] : html.slice(0, 64 * 1024);

  const map = new Map();
  // Tolerates attribute order, single/double quotes, and self-closing
  // slashes. `content` may also precede `property|name`.
  const metaRe = /<meta\s+([^>]+?)\s*\/?>(?![^<]*<\/meta>)/gi;
  for (const [, attrs] of region.matchAll(metaRe)) {
    const key = attrs.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    const val = attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!key || val == null) continue;
    const k = key.toLowerCase();
    // First write wins — OG and twitter cards tend to appear before the
    // generic meta description, so we get the higher-quality value.
    if (!map.has(k)) map.set(k, decodeEntities(val).trim());
  }

  const titleTag = region.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title =
    map.get('og:title') ??
    map.get('twitter:title') ??
    (titleTag ? decodeEntities(titleTag).trim() : '');

  const description =
    map.get('og:description') ??
    map.get('twitter:description') ??
    map.get('description') ??
    '';

  const imageRaw =
    map.get('og:image') ??
    map.get('og:image:url') ??
    map.get('og:image:secure_url') ??
    map.get('twitter:image') ??
    map.get('twitter:image:src') ??
    '';

  // Normalise relative og:image to absolute. URL accepts protocol-
  // relative and root-relative forms; an invalid value throws and we
  // simply drop the image rather than crashing.
  let image = '';
  if (imageRaw) {
    try {
      image = new URL(imageRaw, pageUrl).toString();
    } catch {
      image = '';
    }
  }

  const siteName = map.get('og:site_name') ?? '';
  return { title, description, image, siteName };
}

async function fetchMeta(url) {
  const res = await fetch(url, {
    headers: {
      // Some sites serve a stripped-down page (or a 403) to obvious bots;
      // a plain browser-ish UA is a low-effort dodge that's polite enough.
      'User-Agent': `Mozilla/5.0 (link-card-bot; +${await siteHost()})`,
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(ct)) {
    throw new Error(`non-html content-type: ${ct}`);
  }

  // Stream-cap the body so a giant page can't blow up memory.
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no response body');
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const html = new TextDecoder('utf-8', { fatal: false }).decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  );

  const meta = parseMeta(html, res.url || url);
  return {
    url: res.url || url,
    title: meta.title,
    description: meta.description,
    image: meta.image,
    siteName: meta.siteName,
  };
}

// DOI extraction. Matches the canonical `10.<registrant>/<suffix>` shape
// wherever it appears in the path — works for `doi.org/10.xxx`,
// `pubs.acs.org/doi/10.xxx`, `onlinelibrary.wiley.com/doi/10.xxx`,
// `link.springer.com/article/10.xxx`, etc. Trailing punctuation that
// regex can pick up from prose is trimmed.
const DOI_IN_PATH = /\/(10\.\d{4,9}\/[^\s?#]+)/i;
function extractDoi(url) {
  const m = url.match(DOI_IN_PATH);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/[.,;]+$/, '');
  } catch {
    return m[1].replace(/[.,;]+$/, '');
  }
}

// CrossRef polite-pool User-Agent, sourced from profile.yaml to keep
// site identity single-sourced (same pattern as scripts/lib/fetch-cache.mjs).
let crossrefUaPromise = null;
function crossrefUa() {
  if (!crossrefUaPromise) {
    crossrefUaPromise = (async () => {
      try {
        const host = await siteHost();
        const { email } = await readProfileShallow();
        return email ? `${host} (mailto:${email})` : host;
      } catch {
        return 'remark-link-card';
      }
    })();
  }
  return crossrefUaPromise;
}

// CrossRef fallback for publisher pages that hide behind a JS challenge
// (ACS, Wiley, Nature, etc.) — when OG fetch can't reach real metadata
// we can still get title + journal + abstract from the DOI registry.
// Returns null on any failure; the caller decides whether to keep the
// previous cached value or skip card rendering altogether.
async function fetchCrossref(doi) {
  const res = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    {
      headers: { 'User-Agent': await crossrefUa(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  const j = await res.json();
  const w = j?.message ?? {};
  const title = Array.isArray(w.title) ? w.title[0] : (w.title ?? '');
  if (!title) throw new Error('CrossRef: no title');
  // CrossRef abstracts arrive as JATS XML (`<jats:p>…</jats:p>`). Strip
  // every tag, collapse whitespace; we don't try to render the markup.
  const abstract = String(w.abstract ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const container = Array.isArray(w['container-title'])
    ? w['container-title'][0]
    : (w['container-title'] ?? '');
  const publisher = w.publisher ?? '';
  const primaryUrl =
    w?.resource?.primary?.URL ?? w.URL ?? `https://doi.org/${doi}`;
  return {
    url: primaryUrl,
    title: decodeEntities(String(title)).trim(),
    description: decodeEntities(abstract),
    image: '',
    siteName: container || publisher || '',
  };
}

async function getMeta(url) {
  const cached = await readCache(url);
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS;
  if (fresh) return cached.data;
  let data = null;
  let primaryErr = null;
  try {
    const og = await fetchMeta(url);
    if (og.title) data = og;
  } catch (err) {
    primaryErr = err;
  }
  // Anti-bot CDNs (Cloudflare's Managed Challenge on ACS/Wiley/Nature
  // …) make OG scraping structurally impossible. If a DOI is present
  // in the URL, fall through to CrossRef so academic links still render.
  if (!data || !data.title) {
    const doi = extractDoi(url);
    if (doi) {
      try {
        data = await fetchCrossref(doi);
      } catch (err) {
        if (!primaryErr) primaryErr = err;
      }
    }
  }
  if (data && data.title) {
    await writeCache(url, data);
    return data;
  }
  if (cached) return cached.data;
  console.warn(
    `[remark-link-card] failed to fetch ${url}: ${primaryErr?.message ?? 'no usable metadata'}`,
  );
  return null;
}

// "Bare URL paragraph" extractor — stricter than the shared
// `extractStandaloneUrl` helper. We only treat a paragraph as card-
// worthy when the user pasted the URL verbatim:
//   - either as plain text:    `https://example.com`
//   - or as a self-labelled link: `[https://example.com](https://example.com)`
// Anything with non-URL link text (`[my article](https://...)`) is left
// alone, matching the Twitter "expand a naked URL" convention.
function extractBareUrl(paragraph) {
  const children = paragraph.children.filter(
    (c) => !(c.type === 'text' && /^\s*$/.test(c.value)),
  );
  if (children.length !== 1) return null;
  const child = children[0];
  if (child.type === 'text') {
    const t = child.value.trim();
    return ANY_HTTP_URL.test(t) ? t : null;
  }
  if (child.type === 'link' && ANY_HTTP_URL.test(child.url)) {
    const text = (child.children ?? [])
      .map((c) => (c.type === 'text' ? c.value : ''))
      .join('')
      .trim();
    if (text === child.url) return child.url;
  }
  return null;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function renderCard(d) {
  // Title falls back to the host so the card is never empty even when a
  // site ships no OG tags at all.
  const host = hostnameOf(d.url);
  const title = d.title || host || d.url;
  const desc = d.description
    ? `<p class="link-card-desc">${esc(d.description)}</p>`
    : '';
  const image = d.image
    ? `<div class="link-card-thumb"><img src="${esc(d.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></div>`
    : '';
  const site = esc(d.siteName || host);
  // Google's favicon service is a pragmatic source for a tiny site icon
  // without us shipping a per-host asset. Falls back to nothing on error
  // (the <img> alt is empty and the surrounding flex still lays out).
  const favicon = host
    ? `<img class="link-card-favicon" src="https://www.google.com/s2/favicons?domain=${esc(host)}&sz=32" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  return (
    `<a class="link-card${d.image ? '' : ' link-card--no-image'}" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">` +
    `<div class="link-card-body">` +
    `<p class="link-card-title">${esc(title)}</p>` +
    desc +
    `<p class="link-card-site">${favicon}<span>${site}</span></p>` +
    `</div>` +
    image +
    `</a>`
  );
}

export function remarkLinkCard() {
  return async (tree) => {
    const tasks = [];
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index == null || !parent) return;
      // Only top-level paragraphs become cards. Inside listItem,
      // blockquote, etc. a lone link is part of structured prose
      // (footnote-ish references, quoted attribution) and should stay
      // a regular inline link.
      if (parent.type !== 'root') return;
      const url = extractBareUrl(node);
      if (!url) return;
      // Bare image URL on its own line → render as an actual <img>.
      // Doing this before host/SKIP and OG-fetch is essential: the OG
      // fetch refuses non-text/html content types and silently leaves
      // the URL as plain text, which surprises authors who pasted an
      // image link expecting "this is an image". Empty `alt` keeps
      // remark-figure-caption from wrapping it in <figure> — readers
      // who want a caption can still use the explicit ![alt](url) form.
      if (isImageUrl(url)) {
        node.children = [
          {
            type: 'image',
            url,
            alt: '',
            title: null,
            data: { hProperties: { loading: 'lazy', decoding: 'async' } },
          },
        ];
        return;
      }
      const host = hostnameOf(url);
      if (!host || SKIP_HOSTS.has(host)) return;
      tasks.push({ index, parent, url });
    });
    if (tasks.length === 0) return;
    const resolved = await Promise.all(
      tasks.map(async (t) => ({ t, data: await getMeta(t.url) })),
    );
    for (const { t, data } of resolved) {
      if (!data || !data.title) continue;
      replaceWithHtml(t.parent, t.index, renderCard(data));
    }
  };
}
