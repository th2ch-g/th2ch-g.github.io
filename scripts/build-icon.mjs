// Build-time icon generator. Reads the source avatar URL from
// src/content/profile.yaml (`icon:`), fetches it, and writes a
// circle-cropped PNG with a 1px antialiased edge to public/icon.png.
//
// Wired into npm `prebuild` / `predev` with a short local refresh cache so
// repeated commands avoid refetching the same avatar. Pure JS via `jimp` to
// avoid native-binary build instability.
import { Jimp } from 'jimp';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, statSync, utimesSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconUrl } from '../src/lib/profile-yaml.mjs';
import { fetchPublicHttp } from '../src/plugins/lib/public-http.mjs';
import { readResponseBuffer } from '../src/plugins/lib/response-body.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'public/icon.png');
const PROFILE = resolve(ROOT, 'src/content/profile.yaml');
// Classic favicon path. Google's favicon system and legacy browsers probe
// /favicon.ico directly, so emit a real ICO (16/32/48 PNG-in-ICO) next to
// the PNG variants used by modern browsers.
const ICO_OUT = resolve(ROOT, 'public/favicon.ico');
const REFRESH_MS = 60 * 60 * 1000;
// Keep the full-size master for social cards. Header, favicon and touch
// icon consumers use PNG variants sized for their display density.
const SIZE = 256;
const ICON_SIZES = [32, 64, 96, 128, 180];
const variantPath = (size) => resolve(ROOT, `public/icon-${size}.png`);

async function writeIconVariants(image) {
  for (const size of ICON_SIZES) {
    const png = await image.clone().resize({ w: size, h: size }).getBuffer('image/png');
    writeFileSync(variantPath(size), png);
  }
}

async function ensureIconVariants() {
  if (!existsSync(OUT)) return;
  const masterMtime = statSync(OUT).mtimeMs;
  if (ICON_SIZES.every((size) => existsSync(variantPath(size)) && statSync(variantPath(size)).mtimeMs >= masterMtime)) return;
  await writeIconVariants(await Jimp.read(OUT));
}

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
  for (const size of ICON_SIZES) {
    if (existsSync(variantPath(size))) unlinkSync(variantPath(size));
  }
  if (existsSync(OUT)) {
    unlinkSync(OUT);
    console.log(`[build-icon] \`icon.url\` is empty — removed stale ${OUT}`);
  } else {
    console.log('[build-icon] `icon.url` is empty — skipping icon generation');
  }
  process.exit(0);
}

const force = process.argv.includes('--force');
if (!force && existsSync(OUT) && existsSync(ICO_OUT)) {
  const outputMtime = Math.min(statSync(OUT).mtimeMs, statSync(ICO_OUT).mtimeMs);
  const profileMtime = statSync(PROFILE).mtimeMs;
  if (outputMtime >= profileMtime && Date.now() - outputMtime < REFRESH_MS) {
    await ensureIconVariants();
    console.log('[build-icon] cached icon is fresh, skipping');
    process.exit(0);
  }
}

console.log(`[build-icon] reading ${src}`);
try {
  // Fetch the avatar ourselves rather than letting `Jimp.read(url)` do it
  // — Jimp's internal HTTP layer has no abort path, so a stalled CDN
  // could pin `npm run dev` indefinitely. A 15s AbortSignal matches the
  // contract used by `build-fonts.mjs` and the CrossRef sync scripts.
  const res = await fetchPublicHttp(src, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`icon fetch ${res.status} for ${src}`);
  // 4MB upper bound: well above realistic avatar sizes (commonly < 200KB)
  // but small enough to bail before pinning RAM on a malformed source.
  const MAX_BYTES = 4 * 1024 * 1024;
  const buf = await readResponseBuffer(res, MAX_BYTES);
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
  await writeIconVariants(image);
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
  // Derive missing variants from the last good master during outages.
  try {
    await ensureIconVariants();
  } catch (variantError) {
    console.warn(`[build-icon] icon variants skipped: ${variantError.message}`);
  }
  if (existsSync(OUT) && existsSync(ICO_OUT)) {
    const retryAfter = new Date();
    for (const output of [OUT, ICO_OUT, ...ICON_SIZES.map(variantPath)]) {
      if (existsSync(output)) utimesSync(output, retryAfter, retryAfter);
    }
  }
  console.warn(`[build-icon] skipped: ${err.message}`);
  process.exit(0);
}
