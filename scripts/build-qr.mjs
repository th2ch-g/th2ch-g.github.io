// Build-time QR code generator. Reads the canonical site URL from the
// `site:` field of src/content/profile.yaml and writes a PNG to
// public/qr.png.
//
// Wired into npm `prebuild` / `predev` (via `build-assets`) so the QR is
// always in sync with the deployed site URL. Pure JS via `qrcode` to
// keep the asset pipeline free of native binaries (mirrors `build-icon.mjs`).
//
// Soft-skip when `site:` is null / empty: we delete any stale public/qr.png
// and exit successfully so the SitemapPage can hide the QR section. This
// matches the "leave null to disable" contract documented in profile.yaml.
// Localhost URLs remain a hard error so a dev URL never ships in a deploy.
import QRCode from 'qrcode';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProfileShallow } from '../src/lib/profile-yaml.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'public/qr.png');

const url = (await readProfileShallow()).site?.trim();
if (!url) {
  // Clean up a stale PNG from a previous build when `site:` was still set,
  // so a later `npm run build` does not ship an outdated QR.
  if (existsSync(OUT)) {
    unlinkSync(OUT);
    console.log(`[build-qr] \`site:\` is empty — removed stale ${OUT}`);
  } else {
    console.log('[build-qr] `site:` is empty — skipping QR generation');
  }
  process.exit(0);
}
if (url.startsWith('http://localhost')) {
  console.error(`[build-qr] refusing to encode non-public URL: ${url}`);
  process.exit(1);
}

console.log(`[build-qr] encoding ${url}`);
mkdirSync(dirname(OUT), { recursive: true });
await QRCode.toFile(OUT, url, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000ff', light: '#ffffffff' },
});
console.log(`[build-qr] wrote ${OUT}`);
