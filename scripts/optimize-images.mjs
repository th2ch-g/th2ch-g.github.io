// Manual image optimizer for committed source images. Run with
// `npm run optimize-images` after adding or replacing photos, then review
// `git diff` before committing. Deliberately NOT wired into predev /
// prebuild: it rewrites committed source files in place, which we never
// want happening silently on every dev start or inside CI.
//
// Why this exists: the site uses `passthroughImageService()` (see
// astro.config.mjs) to dodge sharp's native build deps in CI, so Astro
// performs no resizing or recompression — full-resolution originals would
// otherwise ship straight to the browser. This pre-shrinks the sources
// with jimp (pure JS, already a dependency via build-icon / og-image) so
// the bytes are already small before they ever enter the build.
//
// Idempotent: an image whose longest edge is already <= MAX_DIM is left
// untouched, so re-running never re-encodes an already-optimized file
// (which would stack generational JPEG loss). The file extension is never
// changed, so markdown `./assets/x.png` and `heroImage:` refs keep working.
import { Jimp } from 'jimp';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

// Longest-edge cap in CSS pixels. The gallery masonry tops out at ~400px
// per column and post bodies at ~800px; 1600 keeps 2x-retina crispness
// while cutting multi-megapixel phone photos down dramatically.
const MAX_DIM = 1600;
const JPEG_QUALITY = 80;

// Directories scanned recursively for raster sources.
const ROOTS = [
  resolve(ROOT, 'src/content/gallery'),
  resolve(ROOT, 'src/content/posts'),
];
const EXTS = new Set(['.jpg', '.jpeg', '.png']);

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // missing directory — skip silently
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (EXTS.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(walk);
let processed = 0;
let keptOriginal = 0;
let savedBytes = 0;

for (const file of files) {
  const ext = extname(file).toLowerCase();
  try {
    const before = statSync(file).size;
    const img = await Jimp.read(file);
    const { width, height } = img.bitmap;
    const longest = Math.max(width, height);
    if (longest <= MAX_DIM) continue; // already web-sized — idempotent skip

    const scale = MAX_DIM / longest;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    img.resize({ w, h });

    // Keep the original container format so co-located references stay
    // valid. PNG shrinks purely from the smaller pixel grid; JPEG also
    // re-encodes at a web-appropriate quality.
    const buf =
      ext === '.png'
        ? await img.getBuffer('image/png')
        : await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY });

    // Never regress: a source that's only slightly over MAX_DIM and already
    // tightly compressed can re-encode LARGER than the original (jimp's
    // encoder is less aggressive than whatever produced the source). In
    // that case keep the original — the modest downscale isn't worth a
    // bigger file or a needless quality round-trip.
    if (buf.length >= before) {
      keptOriginal++;
      continue;
    }
    writeFileSync(file, buf);

    processed++;
    savedBytes += before - buf.length;
    console.log(
      `[optimize-images] ${relative(ROOT, file)}  ` +
        `${width}x${height} ${(before / 1024).toFixed(0)}KB -> ` +
        `${w}x${h} ${(buf.length / 1024).toFixed(0)}KB`,
    );
  } catch (err) {
    console.warn(`[optimize-images] skipped ${relative(ROOT, file)}: ${err.message}`);
  }
}

console.log(
  `[optimize-images] done: ${processed}/${files.length} rewritten, ` +
    `${keptOriginal} kept as-is (re-encode not smaller), ` +
    `${(savedBytes / 1024 / 1024).toFixed(1)} MB saved`,
);
