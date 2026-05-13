// Renders the CV pages (ja + en) to PDF files via headless Chromium and
// places them under `dist/` so the deployed site can offer a "Download PDF"
// link. Runs after `astro build` so the static HTML is already on disk.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './lib/static-server.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = join(ROOT, 'dist');

// CI runs and explicit `--strict` invocations turn the soft-skip paths
// below into hard failures, so a broken CI deploy can't ship a site that
// silently drops the CV PDF download links. Local builds remain fail-soft
// (CLAUDE.md documents this contract).
const STRICT = process.env.CI === 'true' || process.argv.includes('--strict');

function softFail(message, err) {
  if (err?.message) console.warn(err.message);
  if (STRICT) {
    console.error(`[cv-pdf] ${message} (strict mode)`);
    process.exit(1);
  }
  console.warn(`[cv-pdf] ${message}`);
}

// Playwright is a devDependency. If for any reason its browser binaries
// aren't installed (e.g. CI didn't run `npx playwright install chromium`),
// we skip cleanly rather than failing the whole build.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  softFail('playwright not installed, skipping CV PDF generation', err);
  process.exit(0);
}

const { url: base, close } = await startStaticServer(distDir);

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  await close();
  softFail('failed to launch Chromium — run `npx playwright install chromium` first.', err);
  process.exit(0);
}

const targets = [
  { url: `${base}/cv`, out: join(distDir, 'cv.pdf') },
  { url: `${base}/en/cv`, out: join(distDir, 'en', 'cv.pdf') },
];

try {
  for (const target of targets) {
    const page = await browser.newPage();
    // Match the printed CSS branch so the PDF doesn't include site chrome.
    await page.emulateMedia({ media: 'print' });
    await page.goto(target.url, { waitUntil: 'networkidle' });
    await mkdir(join(target.out, '..'), { recursive: true });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    await writeFile(target.out, pdf);
    await page.close();
    console.log(`[cv-pdf] wrote ${target.out} (${pdf.length} bytes)`);
  }
} catch (err) {
  // Browser crashes (SIGSEGV under sandbox/Rosetta) are environmental,
  // not source-of-truth issues. Fail soft so the surrounding `npm run
  // build` still succeeds — the rest of `dist/` is already on disk.
  softFail('page rendering failed, skipping CV PDF generation.', err);
}

try { await browser.close(); } catch { /* already dead */ }
await close();

if (STRICT) {
  // Final guard: even if every step above silently completed (e.g. Playwright
  // returned an empty buffer without throwing), make sure the expected
  // artefacts actually exist on disk before we declare success.
  const missing = targets.filter((t) => !existsSync(t.out));
  if (missing.length > 0) {
    console.error(
      `[cv-pdf] strict mode: missing artefacts: ${missing.map((t) => t.out).join(', ')}`,
    );
    process.exit(1);
  }
}
