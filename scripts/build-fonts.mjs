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
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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

const needed = TARGETS.filter(({ file }) => {
  const p = resolve(OUT_DIR, file);
  if (!existsSync(p)) return true;
  return statSync(p).size < MIN_VALID_BYTES;
});

if (needed.length === 0) {
  console.log('[build-fonts] all fonts already cached, skipping');
  process.exit(0);
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
  console.warn(`[build-fonts] skipped: ${err.message}`);
  process.exit(0);
}
