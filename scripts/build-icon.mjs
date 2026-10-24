// Build-time icon generator. Reads the source avatar URL from
// src/content/profile.yaml (`icon:`), fetches it, and writes a
// circle-cropped PNG with a 1px antialiased edge to public/icon.png.
//
// Wired into npm `prebuild` / `predev` with a short local refresh cache so
// repeated commands avoid refetching the same avatar. Pure JS via `jimp` to
// avoid native-binary build instability.
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, existsSync, unlinkSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconUrl } from '../src/lib/profile-yaml.mjs';
import { fetchPublicHttp } from '../src/plugins/lib/public-http.mjs';
import { readResponseBuffer } from '../src/plugins/lib/response-body.mjs';
import { ICON_SIZES, MAX_ICON_BYTES, renderIcon } from './lib/icon-image.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'public/icon.png');
const PROFILE = resolve(ROOT, 'src/content/profile.yaml');
// Classic favicon path. Google's favicon system and legacy browsers probe
// /favicon.ico directly, so emit a real ICO (16/32/48 PNG-in-ICO) next to
// the PNG variants used by modern browsers.
const ICO_OUT = resolve(ROOT, 'public/favicon.ico');
const REFRESH_MS = 60 * 60 * 1000;
const variantPath = (size) => resolve(ROOT, 'public', 'icon-' + size + '.png');

function writeIconFiles(outputs, variantsOnly = false) {
  const cache = resolve(ROOT, '.cache');
  mkdirSync(cache, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });
  const stage = mkdtempSync(join(cache, 'icon-'));
  const names = [...outputs.keys()].filter((name) => !variantsOnly || name !== 'icon.png');
  try {
    for (const name of names) writeFileSync(join(stage, name), outputs.get(name));
    for (const name of names) renameSync(join(stage, name), join(dirname(OUT), name));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

async function ensureIconVariants() {
  if (!existsSync(OUT)) return;
  const master = statSync(OUT);
  if (existsSync(ICO_OUT) && ICON_SIZES.every((size) => existsSync(variantPath(size)) && statSync(variantPath(size)).mtimeMs >= master.mtimeMs)) return;
  if (master.size > MAX_ICON_BYTES) throw new Error('Cached icon exceeds the input byte limit');
  writeIconFiles(await renderIcon(readFileSync(OUT), { variantsOnly: true }), true);
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
try {
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
  // Fetch the avatar ourselves rather than letting `Jimp.read(url)` do it
  // — Jimp's internal HTTP layer has no abort path, so a stalled CDN
  // could pin `npm run dev` indefinitely. A 15s AbortSignal matches the
  // contract used by `build-fonts.mjs` and the CrossRef sync scripts.
  const res = await fetchPublicHttp(src, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`icon fetch ${res.status} for ${src}`);
  const buffer = await readResponseBuffer(res, MAX_ICON_BYTES);
  writeIconFiles(await renderIcon(buffer));
  console.log('[build-icon] generated icon, variants, and favicon');
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
