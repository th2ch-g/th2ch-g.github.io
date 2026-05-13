// Build-time icon generator. Reads the source avatar URL from
// src/content/profile.yaml (`icon:`), fetches it, and writes a
// circle-cropped PNG with a 1px antialiased edge to public/icon.png.
//
// Wired into npm `prebuild` / `predev` so the asset is always fresh before
// Astro starts. Pure JS via `jimp` to avoid native-binary build instability.
import { Jimp } from 'jimp';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconUrl } from '../src/lib/profile-yaml.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'public/icon.png');
const SIZE = 512;

const src = (await iconUrl())?.trim();
if (!src) {
  // Soft-skip: profile.yaml allows omitting `icon:` entirely. Drop any
  // stale PNG so downstream consumers (favicon link, OG credit row,
  // PostEntry thumb fallback) can fall back to "no icon" rendering.
  if (existsSync(OUT)) {
    unlinkSync(OUT);
    console.log(`[build-icon] \`icon.url\` is empty — removed stale ${OUT}`);
  } else {
    console.log('[build-icon] `icon.url` is empty — skipping icon generation');
  }
  process.exit(0);
}

// Restrict the icon source to http(s) so a malformed/footgun profile.yaml
// can't make Jimp read file:// or other local URIs from the build host.
// Fail-soft to match the rest of this script's contract.
if (!/^https?:\/\//i.test(src)) {
  console.warn(`[build-icon] skipped: icon.url must be http(s), got: ${src}`);
  process.exit(0);
}

console.log(`[build-icon] reading ${src}`);
try {
  // Fetch the avatar ourselves rather than letting `Jimp.read(url)` do it
  // — Jimp's internal HTTP layer has no abort path, so a stalled CDN
  // could pin `npm run dev` indefinitely. A 15s AbortSignal matches the
  // contract used by `build-fonts.mjs` and the CrossRef sync scripts.
  const res = await fetch(src, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`icon fetch ${res.status} for ${src}`);
  // 4MB upper bound: well above realistic avatar sizes (commonly < 200KB)
  // but small enough to bail before pinning RAM on a malformed source.
  const MAX_BYTES = 4 * 1024 * 1024;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error(`icon too large (${buf.length} bytes, max ${MAX_BYTES})`);
  }
  const image = await Jimp.read(buf);
  image.cover({ w: SIZE, h: SIZE });

  // Build an antialiased circular mask. Jimp's `mask()` multiplies the target
  // alpha by the source pixel's average channel value (white = keep, black =
  // transparent). We blanket the canvas white, then darken pixels outside the
  // circle with a 1px linear ramp so the edge is smooth at any display size.
  const mask = new Jimp({ width: SIZE, height: SIZE, color: 0xffffffff });
  const r = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - r + 0.5, y - r + 0.5);
      let v;
      if (d >= r) v = 0;
      else if (d >= r - 1) v = Math.round(255 * (r - d));
      else continue;
      const color = (((v << 24) | (v << 16) | (v << 8) | 0xff) >>> 0);
      mask.setPixelColor(color, x, y);
    }
  }
  image.mask(mask);

  mkdirSync(dirname(OUT), { recursive: true });
  const png = await image.getBuffer('image/png');
  writeFileSync(OUT, png);
  console.log(`[build-icon] wrote ${OUT} (${(png.length / 1024).toFixed(1)} KB)`);
} catch (err) {
  // Non-fatal: a transient fetch failure or unsupported source image must
  // not block `npm run dev` / `npm run build`. Mirrors the fail-soft
  // contract used by `build-fonts.mjs`. Any stale `public/icon.png` from a
  // previous run is intentionally preserved so the site keeps a usable
  // favicon / OG credit thumb until the URL works again.
  console.warn(`[build-icon] skipped: ${err.message}`);
  process.exit(0);
}
