// Runs axe-core against representative pages of the built site. Fails the
// process with a non-zero exit code if any violation is found, so the GH
// Actions a11y job goes red on regressions.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './lib/static-server.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = resolve(ROOT, 'dist');

// Pick an existing tag page from the build output so the sample URL is
// guaranteed to exist (URLs are case-sensitive on GitHub Pages, and the
// tag set drifts with content edits — hard-coding a literal would rot).
function firstTagPath(localePrefix) {
  const dir = resolve(distDir, localePrefix.replace(/^\/|\/$/g, ''), 'tags');
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const tag = entries.find((e) => e.isDirectory())?.name;
  return tag ? `${localePrefix}tags/${tag}` : null;
}

function postPaths() {
  return ['', '/en'].flatMap((prefix) => {
    try {
      return readdirSync(resolve(distDir, prefix.slice(1), 'posts'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${prefix}/posts/${entry.name}`);
    } catch {
      return [];
    }
  });
}

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

// Cover shared page types and every post: tables and highlighted embeds vary
// by content. Pick tags dynamically so the sample follows content changes.
const pages = [
  '/',
  '/en/',
  '/cv',
  '/en/cv',
  '/posts',
  ...postPaths(),
  '/gallery',
  '/contact',
  '/404.html',
  firstTagPath('/'),
  firstTagPath('/en/'),
].filter(Boolean);

let browser;
let totalViolations = 0;
try {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const localOrigin = new URL(base).origin;
  // Audit the built site without waiting for third-party services, matching
  // the network isolation used by the mobile regression checks.
  await context.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === localOrigin ? route.continue() : route.abort();
  });

  for (const path of pages) {
    for (const theme of ['light', 'dark']) {
      const page = await context.newPage();
      try {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
        await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 });
        // Font metrics affect contrast and layout checks. Wait for rendering
        // readiness instead of requiring every network connection to go idle.
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30_000 });
        // wcag2a + wcag2aa is the practical bar for personal sites; stricter
        // tags (wcag21aaa) tend to flag stylistic preferences as violations.
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        if (result.violations.length > 0) {
          totalViolations += result.violations.length;
          console.error(`\n[a11y] ${path} (${theme})`);
          for (const v of result.violations) {
            console.error(`  - ${v.id} (${v.impact}): ${v.help}`);
            console.error(`    ${v.helpUrl}`);
            v.nodes.slice(0, 3).forEach((n) => console.error(`    target: ${n.target.join(' ')}`));
          }
        } else {
          console.log(`[a11y] ${path} (${theme}): ok`);
        }
      } catch (error) {
        throw new Error(`[a11y] ${path}: ${error.message}`, { cause: error });
      } finally {
        await page.close();
      }
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await close();
  }
}

if (totalViolations > 0) {
  console.error(`\n[a11y] FAIL — ${totalViolations} violation(s) across ${pages.length} pages.`);
  process.exit(1);
}
console.log(`\n[a11y] OK — no violations across ${pages.length} pages in both themes.`);
