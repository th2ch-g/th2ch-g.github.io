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
// Classic favicon path. Google's favicon system and legacy browsers probe
// /favicon.ico directly, so emit a real ICO (16/32/48 PNG-in-ICO) next to
// the hi-res icon.png used by the rel=icon PNG link.
const ICO_OUT = resolve(ROOT, 'public/favicon.ico');
// 256 covers every consumer at 2x density: the home avatar (72px CSS →
// 144px retina), the OG-card credit thumb (re-sized to 80px in
// og-image.ts), and the favicon.ico tiles (<= 48px). The previous 512
// produced a ~330 KB PNG that the home page downloaded just to draw at
// 72px; 256 quarters the pixel count (~90 KB) with no visible loss.
const SIZE = 256;

// Assemble a Windows ICO from one or more PNG buffers. Each directory entry
// points at a PNG-encoded image — supported by every modern browser and
// Google's favicon fetcher — so we avoid a BMP encoder. A 256px dimension
// would be written as the byte 0 per the ICO spec; we only emit <= 48 here.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // image type: 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // image data offset
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const src = (await iconUrl())?.trim();
if (!src) {
  // Soft-skip: profile.yaml allows omitting `icon:` entirely. Drop any
  // stale PNG so downstream consumers (favicon link, OG credit row,
  // PostEntry thumb fallback) can fall back to "no icon" rendering.
  if (existsSync(ICO_OUT)) unlinkSync(ICO_OUT);
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

  // Also emit /favicon.ico from the same circular master at the three sizes
  // browsers and Google care about, so the favicon matches the avatar /
  // rel=icon PNG exactly.
  const icoImages = [];
  for (const size of [16, 32, 48]) {
    const variant = image.clone().resize({ w: size, h: size });
    icoImages.push({ size, png: await variant.getBuffer('image/png') });
  }
  writeFileSync(ICO_OUT, buildIco(icoImages));
  const icoBytes = icoImages.reduce((n, i) => n + i.png.length, 0);
  console.log(`[build-icon] wrote ${ICO_OUT} (${(icoBytes / 1024).toFixed(1)} KB)`);
} catch (err) {
  // Non-fatal: a transient fetch failure or unsupported source image must
  // not block `npm run dev` / `npm run build`. Mirrors the fail-soft
  // contract used by `build-fonts.mjs`. Any stale `public/icon.png` from a
  // previous run is intentionally preserved so the site keeps a usable
  // favicon / OG credit thumb until the URL works again.
  console.warn(`[build-icon] skipped: ${err.message}`);
  process.exit(0);
}
