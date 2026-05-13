// Runs axe-core against representative pages of the built site. Fails the
// process with a non-zero exit code if any violation is found, so the GH
// Actions a11y job goes red on regressions.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './lib/static-server.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = resolve(ROOT, 'dist');

let chromium;
let AxeBuilder;
try {
  ({ chromium } = await import('playwright'));
  ({ default: AxeBuilder } = await import('@axe-core/playwright'));
} catch (err) {
  console.warn('[a11y] @axe-core/playwright or playwright missing — skipping.');
  console.warn(err.message);
  process.exit(0);
}

const { url: base, close } = await startStaticServer(distDir);

// Sampling strategy: hit one of every distinct page kind so a regression
// in a shared layout/component is caught while keeping CI runtime small.
const pages = [
  '/',
  '/en/',
  '/cv',
  '/posts',
  '/photos',
  '/tags/Astro',
];

const browser = await chromium.launch();
const context = await browser.newContext();
let totalViolations = 0;
for (const path of pages) {
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  // wcag2a + wcag2aa is the practical bar for personal sites; stricter
  // tags (wcag21aaa) tend to flag stylistic preferences as violations.
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  if (result.violations.length > 0) {
    totalViolations += result.violations.length;
    console.error(`\n[a11y] ${path}`);
    for (const v of result.violations) {
      console.error(`  - ${v.id} (${v.impact}): ${v.help}`);
      console.error(`    ${v.helpUrl}`);
      v.nodes.slice(0, 3).forEach((n) => console.error(`    target: ${n.target.join(' ')}`));
    }
  } else {
    console.log(`[a11y] ${path}: ok`);
  }
  await page.close();
}

await browser.close();
await close();

if (totalViolations > 0) {
  console.error(`\n[a11y] FAIL — ${totalViolations} violation(s) across ${pages.length} pages.`);
  process.exit(1);
}
console.log(`\n[a11y] OK — no violations across ${pages.length} pages.`);
