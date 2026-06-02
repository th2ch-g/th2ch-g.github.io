// Build-time font fetcher for OG card generation. Mirrors the build-icon
// script: pinned local copies of Noto Sans JP (Regular + Bold) + Noto
// Color Emoji under public/fonts/ so `astro-og-canvas` reads them straight
// off disk instead of re-fetching every build.
//
// Why this exists: the previous setup pointed `OG_FONTS` at a v52
// `fonts.gstatic.com` hash URL. Google Fonts increments its version
// (v52, v56, ...) on schedule and old hashes drop, causing OG cards
// to silently degrade to tofu. Resolving the URL via the CSS API at
// build time and saving locally pins the bytes for the lifetime of the
// repo without bloating the git tree (files are gitignored).
//
// Wired into npm `predev` / `prebuild` / `prestart` alongside build-icon.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(ROOT, 'public/fonts');

// `fonts.googleapis.com/css2` returns one @font-face per `unicode-range`
// when the User-Agent looks like a modern browser, but a single full TTF
// when the UA is generic. We rely on the latter behavior so the
// resulting file covers the entire glyph set in one download.
const GENERIC_UA = 'Mozilla/5.0 (compatible; astro-build/1.0)';

// One row per (family, weight, output filename). The CSS API can serve
// every weight of a family in one request, so we group them at fetch time.
const TARGETS = [
  // Primary display face: Zen Maru Gothic — a free, redistributable
  // alternative to commercial 丸ゴ faces (Hiragino Maru Gothic ProN
  // can't be shipped via CI). Friendly rounded gothic, both Latin and
  // CJK covered.
  { family: 'Zen Maru Gothic', weight: 400, file: 'ZenMaruGothic-Regular.ttf' },
  { family: 'Zen Maru Gothic', weight: 700, file: 'ZenMaruGothic-Bold.ttf' },
  // Noto Sans JP stays as glyph fallback (Zen Maru is a more curated
  // subset and may miss the long tail of CJK glyphs).
  { family: 'Noto Sans JP', weight: 400, file: 'NotoSansJP-Regular.ttf' },
  { family: 'Noto Sans JP', weight: 700, file: 'NotoSansJP-Bold.ttf' },
  // Noto Color Emoji ships only weight 400 and uses COLRv1 vector glyphs,
  // which canvaskit-wasm (Skia) supports. Last in the stack so it's
  // consulted only for codepoints the JP fonts can't handle.
  { family: 'Noto Color Emoji', weight: 400, file: 'NotoColorEmoji.ttf' },
];

// A previously-downloaded file is treated as valid only if it is at least
// 500 KB. The full Noto Sans JP TTF is ~5 MB and Noto Color Emoji is
// ~10 MB; anything smaller is almost certainly a Latin-only subset that
// slipped through (which is what was causing CJK tofu in the first place).
const MIN_VALID_BYTES = 500_000;

function familyParam(name) {
  return encodeURIComponent(name).replace(/%20/g, '+');
}

async function fetchCssForFamily(family, weights) {
  const weightSpec = weights.length > 1 || weights[0] !== 400 ? `:wght@${weights.join(';')}` : '';
  const url = `https://fonts.googleapis.com/css2?family=${familyParam(family)}${weightSpec}`;
  // 15s cap on the CSS round-trip; the outer try/catch in this script
  // turns AbortError into a fail-soft skip.
  const res = await fetch(url, {
    headers: { 'User-Agent': GENERIC_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CSS fetch ${res.status} for ${family}`);
  return res.text();
}

function parseFaces(css) {
  // Extract every (weight, ttf URL) pair from the @font-face blocks.
  const faces = [];
  const re = /@font-face\s*\{[^}]*font-weight:\s*(\d+)[^}]*url\((https:[^)]+\.ttf)\)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    faces.push({ weight: Number(m[1]), url: m[2] });
  }
  return faces;
}

async function downloadTo(url, outPath) {
  // 30s for the TTF binary — Noto Sans JP is ~5MB and CJK glyphs run
  // larger; a sluggish CDN should still finish well within this window.
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`font fetch ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_VALID_BYTES) {
    throw new Error(`font too small (${buf.length} bytes), likely a subset rather than a full file`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  return buf.length;
}

// --- 1) OG-card TTFs (full files; canvaskit-wasm reads them off disk) ---
async function buildOgTtfs() {
  const needed = TARGETS.filter(({ file }) => {
    const p = resolve(OUT_DIR, file);
    if (!existsSync(p)) return true;
    return statSync(p).size < MIN_VALID_BYTES;
  });
  if (needed.length === 0) {
    console.log('[build-fonts] all OG TTFs already cached, skipping');
    return;
  }
  // Group needed targets by family so we issue one CSS request per family.
  const byFamily = new Map();
  for (const t of needed) {
    const arr = byFamily.get(t.family) ?? [];
    arr.push(t);
    byFamily.set(t.family, arr);
  }
  try {
    for (const [family, items] of byFamily) {
      const weights = items.map((i) => i.weight);
      const css = await fetchCssForFamily(family, weights);
      const faces = parseFaces(css);
      if (faces.length === 0) {
        console.warn(`[build-fonts] no @font-face entries for ${family}, skipping`);
        continue;
      }
      for (const target of items) {
        const face = faces.find((f) => f.weight === target.weight);
        if (!face) {
          console.warn(`[build-fonts] ${family} weight ${target.weight} missing in CSS`);
          continue;
        }
        const out = resolve(OUT_DIR, target.file);
        const bytes = await downloadTo(face.url, out);
        console.log(`[build-fonts] wrote ${out} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
      }
    }
  } catch (err) {
    // Non-fatal: an offline dev session should not block build-icon and the
    // rest of the pipeline. astro-og-canvas will degrade to its default
    // Latin font if files are missing — the same failure mode as before.
    console.warn(`[build-fonts] OG TTFs skipped: ${err.message}`);
  }
}

// --- 2) Browser WOFF2 unicode-range subsets for the display face ---
// The TTFs above stay for OG cards. For the browser we additionally
// self-host Google's woff2 *subset* files: each page then downloads only
// the subsets covering glyphs it actually renders (a few hundred KB)
// instead of the full ~3.6 MB TTF. Same self-host rationale as the TTFs
// (no v52-hash drift, no third-party origin / CSP entry) — we just keep
// Google's per-`unicode-range` split so the browser fetches the minimum.
const BROWSER_FAMILY = 'Zen Maru Gothic';
const BROWSER_WEIGHTS = [400, 700];
const BROWSER_OUT_DIR = resolve(OUT_DIR, 'zen-maru-gothic');
const BROWSER_CSS = resolve(OUT_DIR, 'zen-maru-gothic.css');
// A real browser UA makes css2 return woff2 + per-subset `unicode-range`
// @font-face blocks. The generic UA used by `fetchCssForFamily` above
// yields a single full TTF instead — the opposite of what we want here.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Parse every (optional `/* label */`) + @font-face block, capturing the
// weight, woff2 URL, and unicode-range. The label (`latin`, `[0]`, ...)
// gives each subset a stable, content-derived filename. `matchAll` keeps
// the scan declarative (no stateful RegExp cursor).
function parseSubsetFaces(css) {
  const faces = [];
  const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let i = 0;
  for (const m of css.matchAll(re)) {
    const body = m[2];
    const weight = Number(body.match(/font-weight:\s*(\d+)/)?.[1]);
    const url = body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;}]+)/)?.[1]?.trim();
    if (!weight || !url || !range) continue;
    const label = (m[1] ?? String(i)).replace(/[^a-z0-9]+/gi, '').toLowerCase() || String(i);
    faces.push({ weight, url, range, file: `${weight}-${label}.woff2` });
    i++;
  }
  return faces;
}

// Bounded-concurrency map so a few hundred subset downloads don't open a
// few hundred sockets at once.
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function browserSubsetsAlreadyBuilt() {
  // A prior failure leaves only the stub CSS (< 200 bytes) and no woff2,
  // so we retry until a real stylesheet + at least one subset exist.
  if (!existsSync(BROWSER_CSS) || statSync(BROWSER_CSS).size < 200) return false;
  try {
    return readdirSync(BROWSER_OUT_DIR).some((f) => f.endsWith('.woff2'));
  } catch {
    return false;
  }
}

async function buildBrowserWoff2() {
  if (browserSubsetsAlreadyBuilt()) {
    console.log('[build-fonts] browser woff2 subsets already cached, skipping');
    return;
  }
  try {
    const weightSpec = `:wght@${BROWSER_WEIGHTS.join(';')}`;
    const url = `https://fonts.googleapis.com/css2?family=${familyParam(BROWSER_FAMILY)}${weightSpec}&display=swap`;
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`woff2 CSS fetch ${res.status}`);
    const faces = parseSubsetFaces(await res.text());
    if (faces.length === 0) throw new Error('no woff2 @font-face entries returned');

    mkdirSync(BROWSER_OUT_DIR, { recursive: true });
    let downloaded = 0;
    await mapLimit(faces, 8, async (face) => {
      const out = resolve(BROWSER_OUT_DIR, face.file);
      if (existsSync(out) && statSync(out).size > 0) return; // per-file cache
      const r = await fetch(face.url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`woff2 fetch ${r.status} for ${face.url}`);
      writeFileSync(out, Buffer.from(await r.arrayBuffer()));
      downloaded++;
    });

    // Emit a self-hosted stylesheet whose src urls point at the local
    // copies. `<link>`-ed from Base.astro; the browser fetches only the
    // subset files whose unicode-range matches glyphs on the page.
    const css = faces
      .map(
        (f) =>
          `@font-face{font-family:'${BROWSER_FAMILY}';font-style:normal;font-weight:${f.weight};` +
          `font-display:swap;src:url(/fonts/zen-maru-gothic/${f.file}) format('woff2');` +
          `unicode-range:${f.range}}`,
      )
      .join('\n');
    writeFileSync(BROWSER_CSS, css + '\n');
    console.log(
      `[build-fonts] wrote ${BROWSER_CSS} (${faces.length} subsets, ${downloaded} downloaded)`,
    );
  } catch (err) {
    // Fail-soft: write a stub so Base.astro's <link> never 404s — the page
    // simply renders in the system fallback stack (Hiragino Maru Gothic
    // ProN etc.), the same degradation as a missing TTF before this.
    if (!existsSync(BROWSER_CSS)) {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(BROWSER_CSS, '/* Zen Maru Gothic web fonts unavailable; system fallback */\n');
    }
    console.warn(`[build-fonts] browser woff2 subsets skipped: ${err.message}`);
  }
}

await buildOgTtfs();
await buildBrowserWoff2();
