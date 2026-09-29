import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { Jimp, diff } from 'jimp';
import { startStaticServer } from './lib/static-server.mjs';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, output: { type: 'string' }, dist: { type: 'string' },
} });
const dist = values.dist ? resolve(values.dist) : resolve(import.meta.dirname, '../dist');
const output = resolve(values.output ?? '.cache/ui-consistency');
const paths = readdirSync(dist, { recursive: true })
  .filter((file) => file.endsWith('.html') && readFileSync(resolve(dist, file), 'utf8').includes('<main'))
  .map((file) => '/' + file.split(sep).join('/').replace(/index\.html$/, ''))
  .sort();
assert.ok(paths.length, 'Build the site before checking UI consistency');
const post = paths.find((path) => /^\/posts\/[^/]+\/$/.test(path));
if (post) paths.push(`${post}?diagram-fixture=1`);
mkdirSync(output, { recursive: true });
const server = await startStaticServer(dist);
const baseline = values.baseline ? await startStaticServer(resolve(values.baseline)) : null;
const browser = await chromium.launch();
const failures = [];
const report = [];

async function visit(page, origin, path) {
  const response = await page.goto(origin + path, { waitUntil: 'load' });
  assert.equal(response?.status(), 200, `Page request failed: ${path}`);
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('pre.mermaid').count()) {
    await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid')].every((node) => node.querySelector('svg')));
  }
  // Normalize only the gallery's intentionally randomized build-time order.
  await page.evaluate(async () => {
    const masonry = document.querySelector('.masonry');
    if (masonry) {
      const buttons = [...masonry.querySelectorAll('.photo-btn')];
      const source = (button) => {
        const image = button.querySelector('img');
        return image.dataset.src || image.getAttribute('src');
      };
      buttons.sort((a, b) => source(a).localeCompare(source(b)));
      masonry.append(...buttons);
      for (const button of buttons) {
        const image = button.querySelector('img');
        if (image.dataset.src) image.src = image.dataset.src;
      }
    }
    await Promise.all([...document.querySelectorAll('main img[src], .brand-icon')].map((image) => {
      image.loading = 'eager';
      return image.decode().catch(() => {});
    }));
  });
}

async function sharedStyles(page) {
  return page.evaluate(() => {
    const selectors = ['.site-header', '.brand', '[data-theme-toggle]', '[data-search-open]',
      '[data-nav-toggle]', '.lang-switch', '.site-footer'];
    const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color',
      'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius'];
    return Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const style = getComputedStyle(element);
      const result = Object.fromEntries(properties.map((property) => [property, style[property]]));
      if (element.matches('button, .lang-switch')) {
        const { width, height } = element.getBoundingClientRect();
        Object.assign(result, { width, height });
      }
      return [selector, result];
    }));
  });
}

try {
  for (const width of [393, 1280]) {
    for (const colorScheme of ['light', 'dark']) {
      for (const lang of ['en', 'ja']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme,
          reducedMotion: 'reduce', hasTouch: width < 600, isMobile: width < 600 });
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== server.url && url.origin !== baseline?.url) return route.abort();
          if (route.request().isNavigationRequest() && url.searchParams.has('diagram-fixture')) {
            const response = await route.fetch();
            const markup = '<div class="prose"><pre class="mermaid">graph LR\n A[Alpha]--&gt;B[Beta]</pre>'
              + '<pre class="mermaid">sequenceDiagram\n Alice-&gt;&gt;Bob: Hello</pre></div>';
            return route.fulfill({ response, body: (await response.text()).replace('</main>', `${markup}</main>`) });
          }
          return route.continue();
        });
        const page = await context.newPage();
        const before = baseline ? await context.newPage() : null;
        let reference;
        try {
          for (const path of paths) {
            const url = `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`;
            const label = `${width}-${colorScheme}-${lang}-${encodeURIComponent(path)}`;
            try {
              await visit(page, server.url, url);
              const shared = await sharedStyles(page);
              reference ??= shared;
              for (const [selector, styles] of Object.entries(shared)) {
                if (path === '/404.html' && selector === '.lang-switch') {
                  assert.equal(styles, null, 'The single-locale error page has a language switcher');
                } else {
                  assert.deepEqual(styles, reference[selector], `${selector} differs on ${url}`);
                }
              }
              assert.ok(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
                `Horizontal overflow on ${url}`);
              const row = { path: url, width, colorScheme };
              if (before) {
                await visit(before, baseline.url, url);
                const snapshots = await Promise.all([before, page].map((tab) => tab.screenshot({ fullPage: true, animations: 'disabled' })));
                const images = await Promise.all(snapshots.map((buffer) => Jimp.read(buffer)));
                const sizes = images.map(({ bitmap }) => [bitmap.width, bitmap.height]);
                snapshots.forEach((buffer, index) => writeFileSync(resolve(output, `${label}-${index ? 'after' : 'before'}.png`), buffer));
                assert.deepEqual(sizes[0], sizes[1], `Page dimensions changed on ${url}`);
                const difference = diff(images[0], images[1], 0.1);
                row.differentPixels = difference.percent;
                if (difference.percent > 0.0001) {
                  await difference.image.write(resolve(output, `${label}-diff.png`));
                  assert.fail(`Visual difference ${(difference.percent * 100).toFixed(4)}% on ${url}`);
                }
              }
              report.push(row);
            } catch (error) {
              failures.push({ label, error: error.message });
              console.error(`[consistency] ${label}: ${error.message}`);
            }
          }
        } finally {
          await context.close();
        }
        console.log(`[consistency] ${width}px ${colorScheme} ${lang}: ${paths.length} pages checked`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  await baseline?.close();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks: report, failures }, null, 2));
}
assert.deepEqual(failures, [], 'UI consistency checks failed');
console.log(`[consistency] ${report.length} layouts passed${baseline ? ' including baseline image comparisons' : ''}`);
