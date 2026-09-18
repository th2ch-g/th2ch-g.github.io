import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { startStaticServer } from './lib/static-server.mjs';

const distDir = resolve(import.meta.dirname, '../dist');
const paths = readdirSync(distDir, { recursive: true })
  .filter((file) => file.endsWith('.html') && readFileSync(resolve(distDir, file), 'utf8').includes('<main'))
  .map((file) => '/' + file.split(sep).join('/').replace(/index\.html$/, ''))
  .sort();
assert.ok(paths.length, 'Build the site before checking mobile pages');

const profiles = [
  { name: 'compact', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 },
  { name: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 },
  { name: 'wide', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3 },
];
const server = await startStaticServer(distDir);
const failures = [];
let checked = 0;

async function visit(page, path) {
  await page.goto(server.url + path, { waitUntil: 'load' });
  await page.locator('main').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('.mermaid').count()) {
    await page.waitForFunction(() => [...document.querySelectorAll('.mermaid')]
      .every((diagram) => diagram.dataset.processed === 'true' && diagram.querySelector('svg')));
  }
}

async function assertLayout(page) {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const controls = [...document.querySelectorAll('.site-header .inner > a, .site-header .inner > button, .lang-switch')]
      .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    return {
      overflow: document.documentElement.scrollWidth - width,
      clippedControls: controls.filter((rect) => rect.left < -1 || rect.right > width + 1).length,
      controlCenters: controls.map((rect) => rect.top + rect.height / 2),
      thickUnderlines: [...document.querySelectorAll('a, u, .gh-permalink-path')].filter((element) => {
        if (!element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.textDecorationLine.includes('underline') && style.textDecorationThickness !== '1px';
      }).map((element) => element.textContent.trim().slice(0, 80)),
    };
  });
  assert.ok(layout.overflow <= 1, `Horizontal overflow: ${layout.overflow}px`);
  assert.equal(layout.clippedControls, 0, 'Header controls are clipped');
  assert.ok(Math.max(...layout.controlCenters) - Math.min(...layout.controlCenters) < 1,
    'Header controls wrap onto multiple rows');
  assert.deepEqual(layout.thickUnderlines, [], 'Visible links have browser-dependent underline thickness');
}

async function assertTapFeedback(page) {
  const toggle = page.locator('[data-nav-toggle]');
  if (await toggle.isVisible()) {
    await toggle.tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await assertLayout(page);
    await toggle.tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  }

  // Prevent navigation only while inspecting the styles left behind by taps.
  // Actual link destinations are exercised separately below.
  await page.evaluate(() => {
    globalThis.__preventLinkNavigation = (event) => {
      if (event.target.closest('a')) event.preventDefault();
    };
    document.addEventListener('click', globalThis.__preventLinkNavigation, true);
  });
  try {
    for (const selector of [
      '.cv-profile-links a', '.cv-prose li a', '.row > a', '.breadcrumb-nav a',
      '.series-name', '.gh-permalink-header', '.gh-permalink-more',
      '.prose p a:not([class])', '.license a', '.site-footer a',
    ]) {
      const link = page.locator(selector).first();
      if (!await link.isVisible()) continue;
      const before = await link.evaluate((element) => getComputedStyle(element).textDecorationLine);
      await link.tap();
      const after = await link.evaluate((element) => ({
        line: getComputedStyle(element).textDecorationLine,
        thickness: getComputedStyle(element).textDecorationThickness,
      }));
      assert.equal(after.line, before, `${selector}: a tap leaves a hover underline behind`);
      if (after.line.includes('underline')) {
        assert.equal(after.thickness, '1px', `${selector}: a tap thickens an inline underline`);
      }
    }
  } finally {
    await page.evaluate(() => document.removeEventListener('click', globalThis.__preventLinkNavigation, true));
  }
}

async function assertTouchFlows(context, prefix) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await visit(page, `${prefix}/`);
    await page.locator('[data-nav-toggle]').tap();
    await page.locator('.nav-list a').first().tap();
    await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === `${prefix}/posts`);
    const firstPost = page.locator('[data-post-row] a').first();
    const postUrl = new URL(await firstPost.getAttribute('href'), server.url);
    await firstPost.tap();
    await page.waitForURL(postUrl.href);
    await page.locator('article').waitFor();

    await visit(page, `${prefix}/`);
    const previousTheme = await page.locator('html').getAttribute('data-theme');
    await page.locator('[data-theme-toggle]').tap();
    const nextTheme = await page.locator('html').getAttribute('data-theme');
    assert.notEqual(nextTheme, previousTheme, 'Theme toggle ignores touch');
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), nextTheme);
    await page.locator('[data-theme-toggle]').tap();

    const otherLocale = page.locator('.lang-switch a').filter({ hasText: prefix ? 'EN' : 'JA' });
    await otherLocale.tap();
    await page.waitForURL((url) => url.pathname === (prefix ? '/' : '/ja/'));
    await visit(page, `${prefix}/`);
    await page.locator('li.cv-has-bibtex').first().waitFor();
    await page.evaluate(() => {
      globalThis.__copiedText = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { globalThis.__copiedText = text; } },
      });
    });
    const menu = page.locator('li.cv-has-bibtex details').first();
    await menu.locator('summary').tap();
    await menu.getByRole('button', { name: 'BibTeX', exact: true }).tap();
    await page.waitForFunction(() => globalThis.__copiedText.startsWith('@'));
    assert.equal(await menu.getAttribute('open'), null, 'Copy menu stays open after a touch selection');

    const index = await (await context.request.get(server.url + '/search-index.json')).json();
    const article = index.items.find((item) => /[a-z]{4}/i.test(item.title)) ?? index.items[0];
    const query = article.title.match(/[a-z]{4,}/i)?.[0] ?? article.title;
    for (const fallback of [false, true]) {
      if (fallback) await page.route('**/pagefind/pagefind-ui.js', (route) => route.abort());
      await visit(page, `${prefix}/`);
      await page.locator('[data-search-open]').tap();
      const input = page.locator(fallback ? '.search-fallback__input' : '.pagefind-ui__search-input');
      await input.fill(query);
      const result = page.locator(fallback ? '.search-fallback__link' : '.pagefind-ui__result-link')
        .filter({ hasText: article.title }).first();
      await result.waitFor();
      await assertLayout(page);
      const href = new URL(await result.getAttribute('href'), server.url);
      await result.tap();
      await page.waitForURL(href.href);
      await page.locator('article').waitFor();
    }

    await visit(page, `${prefix}/gallery/`);
    const currentSlide = () => page.locator('.slideshow-progress-current').textContent();
    const before = await currentSlide();
    await page.locator('.photo-slideshow .next').tap();
    assert.notEqual(await currentSlide(), before, 'Slideshow ignores touch navigation');
    await page.locator('.photo-btn').first().tap();
    const lightbox = page.locator('#lightbox');
    await lightbox.waitFor({ state: 'visible' });
    const image = lightbox.locator('.lightbox-img');
    const firstImage = await image.getAttribute('src');
    await lightbox.locator('.lightbox-next').tap();
    assert.notEqual(await image.getAttribute('src'), firstImage, 'Lightbox ignores touch navigation');
    await assertLayout(page);
    await lightbox.locator('.lightbox-close').tap();
    await lightbox.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, [], 'Touch interactions produced JavaScript errors');
  } finally {
    await page.close();
  }
}

async function assertMouseFeedback(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
    await visit(page, '/posts/');
    const link = page.locator('[data-post-row] a').first();
    await link.hover();
    assert.deepEqual(await link.evaluate((element) => ({
      line: getComputedStyle(element).textDecorationLine,
      thickness: getComputedStyle(element).textDecorationThickness,
    })), { line: 'underline', thickness: '1px' }, 'Mouse hover must retain a thin underline');
    await page.keyboard.press('Tab');
    await link.focus();
    assert.equal(await link.evaluate((element) => getComputedStyle(element).outlineWidth), '2px',
      'Keyboard focus must remain visible');
  } finally {
    await page.close();
  }
}

try {
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      for (const { name, ...profile } of profiles) {
        for (const colorScheme of ['light', 'dark']) {
          const label = `${engine.name()} ${name} ${colorScheme}`;
          const context = await browser.newContext({
            ...profile, colorScheme, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
          });
          await context.route('**/*', (route) =>
            new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
          try {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            for (const path of paths) {
              errors.length = 0;
              try {
                await visit(page, path);
                assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
                await assertLayout(page);
                if (name === 'phone') {
                  await assertTapFeedback(page);
                  if (engine === chromium) {
                    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
                    assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
                      [], 'Mobile accessibility violations');
                  }
                }
                assert.deepEqual(errors, [], 'Mobile rendering produced JavaScript errors');
              } catch (error) {
                failures.push(`${label} ${path}: ${error.message}`);
                console.error(failures.at(-1));
              }
              checked++;
            }
            await page.close();
            if (name === 'phone') {
              for (const prefix of ['', '/ja']) {
                try {
                  await assertTouchFlows(context, prefix);
                } catch (error) {
                  failures.push(`${label} ${prefix || '/'} touch flow: ${error.message}`);
                  console.error(failures.at(-1));
                }
              }
            }
            console.log(`[mobile] ${label}: ${paths.length} pages checked`);
          } finally {
            await context.close();
          }
        }
      }
      await assertMouseFeedback(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
assert.deepEqual(failures, [], 'Mobile page or touch regressions');
console.log(`[mobile] OK: ${checked} layouts, all pages in both themes, touch flows in both locales, and mobile axe checks`);
