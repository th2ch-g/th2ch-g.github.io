import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium, firefox } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const distDir = resolve(import.meta.dirname, '../dist');
const server = await startStaticServer(distDir);
const index = await (await fetch(`${server.url}/search-index.json`)).json();
const postItems = index.items.filter((item) => item.lang === 'en' && /^\/posts\/[^/]+\/$/.test(item.url));
const article = postItems.find((item) => /[a-z]{4}/i.test(item.title)) ?? postItems[0];
assert.ok(article, 'Search checks require a published article');
const query = article.title.match(/[a-z]{4,}/i)?.[0] ?? article.title;
const postPath = article.url;

// Compare against rendered pages so newly added routes cannot silently escape fallback search.
const renderedPaths = readdirSync(distDir, { recursive: true })
  .filter((file) => file.endsWith('.html') && file !== '404.html'
    && readFileSync(resolve(distDir, file), 'utf8').includes('<main'))
  .map((file) => '/' + file.split(sep).join('/').replace(/index\.html$/, ''))
  .sort();
assert.deepEqual(index.items.map((item) => decodeURI(item.url)).sort(), renderedPaths,
  'Fallback search does not cover every public content page exactly once');

async function newPage(browser, path, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', ...options });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
  await page.goto(server.url + path, { waitUntil: 'networkidle' });
  return { page, errors };
}

async function mockClipboard(page) {
  await page.evaluate(() => {
    globalThis.__copies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => { globalThis.__copies.push({ 'text/plain': text }); },
        write: async (items) => {
          for (const item of items) {
            const values = {};
            for (const type of item.types) values[type] = await (await item.getType(type)).text();
            globalThis.__copies.push(values);
          }
        },
      },
    });
  });
}

async function copyFromMenu(menu, label) {
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: label, exact: true }).click();
  await menu.page().waitForFunction(() => globalThis.__copies.length > 0);
  const copy = await menu.page().evaluate(() => globalThis.__copies.pop());
  assert.equal(await menu.getAttribute('open'), null, 'Copy menu remains open after copying');
  return copy;
}

async function waitForOpacity(control, opacity) {
  const element = await control.elementHandle();
  await control.page().waitForFunction(({ element, opacity }) =>
    getComputedStyle(element).opacity === opacity, { element, opacity });
  await element.dispose();
}

async function checkCv(browser, path) {
  const { page, errors } = await newPage(browser, path);
  await page.locator('[data-cv-actions] summary').waitFor();
  await mockClipboard(page);
  const paper = page.locator('li.cv-has-bibtex').first();
  const menu = paper.locator('details');
  for (const [region, button] of [
    [page.locator('.cv-header'), page.locator('[data-cv-actions] summary')],
    [paper, menu.locator('summary')],
  ]) {
    await button.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    assert.equal(await button.evaluate((element) => getComputedStyle(element).opacity), '0',
      'CV copy control is visible before hover or focus');
    await region.hover();
    await waitForOpacity(button, '1');
    await page.mouse.move(0, 0);
    await waitForOpacity(button, '0');
    await button.focus();
    await waitForOpacity(button, '1');
    await button.press('Enter');
    await button.evaluate((element) => element.blur());
    assert.equal(await button.evaluate((element) => getComputedStyle(element).opacity), '1',
      'An open CV copy menu loses its trigger when focus moves');
    await page.keyboard.press('Escape');
    await button.evaluate((element) => element.blur());
  }
  const text = await copyFromMenu(menu, 'Text');
  assert.ok(text['text/plain'].length > 30);
  assert.doesNotMatch(text['text/plain'], /Copy list|BibTeX/);
  assert.match(text['text/html'], /font-size:10.5pt;color:#000;background-color:#ffffff/);
  assert.doesNotMatch(text['text/html'], /<(?:button|details|a)\b|heading-anchor/);
  assert.match(text['text/html'], /Times New Roman/);
  if (path === '/ja/') assert.match(text['text/html'], /MS Mincho/);

  const bib = await copyFromMenu(menu, 'BibTeX');
  assert.match(bib['text/plain'], /^@\w+\{/);
  assert.equal(bib['text/html'], undefined, 'BibTeX should be plain text');

  const sectionMenu = page.locator('.cv-section-actions details').first();
  const section = await copyFromMenu(sectionMenu, 'Copy list');
  assert.match(section['text/plain'], /\n\n1\. /);
  assert.match(section['text/html'], /<ol\b/);
  const sectionBib = await copyFromMenu(sectionMenu, 'All as BibTeX');
  assert.match(sectionBib['text/plain'], /^# .+\n\n@/);

  const toolbar = page.locator('[data-cv-actions] details');
  const all = await copyFromMenu(toolbar, 'Copy all');
  assert.ok(all['text/plain'].length > section['text/plain'].length);
  assert.doesNotMatch(all['text/html'], /cv-copy-actions|cv-section-actions|heading-anchor/);
  if (path === '/ja/') assert.match(all['text/html'], /font-family:'MS Mincho'/);
  const allBib = await copyFromMenu(toolbar, 'Copy .bib');
  const response = await page.request.get(server.url + (path === '/ja/' ? '/ja/cv.bib' : '/cv.bib'));
  assert.equal(response.status(), 200);
  assert.equal(allBib['text/plain'], await response.text());

  await toolbar.locator('summary').click();
  await toolbar.locator('button').first().focus();
  await page.keyboard.press('Escape');
  assert.equal(await toolbar.getAttribute('open'), null);
  assert.equal(await toolbar.locator('summary').evaluate((element) => element === document.activeElement), true,
    'Escape must return focus to the CV menu trigger');
  await toolbar.locator('summary').click();
  await menu.locator('summary').click();
  assert.equal(await page.locator('.cv-menu[open]').count(), 1, 'Multiple CV menus remain open');
  await page.locator('.hero h1').click();
  assert.equal(await page.locator('.cv-menu[open]').count(), 0, 'Outside click does not dismiss the CV menu');

  // Rich clipboard rejection must retain a usable text copy.
  await page.evaluate(() => { navigator.clipboard.write = async () => { throw new Error('denied'); }; });
  const fallback = await copyFromMenu(menu, 'Text');
  assert.equal(fallback['text/plain'], text['text/plain']);

  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.site-header').isVisible(), false);
  assert.equal(await page.locator('[data-cv-actions]').isVisible(), false);
  assert.equal(await page.locator('.cv-prose').isVisible(), true);
  assert.equal(await paper.locator('.cv-copy-actions').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
}

async function checkSearch(browser, path, fallback) {
  const { page, errors } = await newPage(browser, path);
  if (fallback) await page.route('**/pagefind/pagefind-ui.js', (route) => route.abort());
  const trigger = page.locator('[data-search-open]');
  await trigger.click();
  const input = page.locator(fallback ? '.search-fallback__input' : '.pagefind-ui__search-input');
  await input.fill(query);
  const result = page.locator(fallback ? '.search-fallback__link' : '.pagefind-ui__result-link').filter({ hasText: article.title }).first();
  await result.waitFor();
  if (!fallback) {
    assert.doesNotMatch(await page.locator('.pagefind-ui__results').innerText(), /Search is unavailable/,
      'Search excerpts include hidden page chrome');
  }
  const destination = new URL(await result.getAttribute('href'), server.url);
  assert.ok(destination.pathname.startsWith(path === '/ja/' ? '/ja/posts/' : '/posts/'));
  assert.equal(await input.getAttribute('placeholder'), 'Search this site...');
  const paperTitle = await page.locator('li.cv-has-bibtex a[href*="doi.org"]').first().textContent();
  const cvQuery = paperTitle.match(/[a-z]{4,}/i)?.[0] ?? paperTitle;
  const prefix = path === '/ja/' ? '/ja' : '';
  const resultSelector = fallback ? '.search-fallback__link' : '.pagefind-ui__result-link';
  for (const [term, expectedPath] of [
    [cvQuery, path],
    ['Google AdSense', `${prefix}/privacy/`],
    ['Gallery', `${prefix}/gallery/`],
    ['Contact', `${prefix}/contact/`],
    ['Sitemap', `${prefix}/sitemap/`],
  ]) {
    await input.fill(term);
    await page.waitForFunction(({ selector, expectedPath }) =>
      [...document.querySelectorAll(selector)].some((link) =>
        new URL(link.href).pathname === expectedPath), { selector: resultSelector, expectedPath });
    const destinations = await page.locator(resultSelector).evaluateAll((links) =>
      links.map((link) => new URL(link.href).pathname));
    assert.ok(destinations.every((pathname) => pathname.startsWith('/ja/') === (path === '/ja/')),
      'Search mixes content from the other locale');
    if (fallback) assert.equal(new Set(destinations).size, destinations.length, 'Search repeats a page');
  }
  await input.fill('qzxqzxqzxqzxqzx');
  if (fallback) {
    await page.waitForFunction(() => /no results/i.test(document.querySelector('.search-fallback__status').textContent));
  } else {
    await page.waitForFunction(() =>
      document.querySelector('.pagefind-ui__message')?.textContent.includes('qzxqzxqzxqzxqzx')
      && document.querySelectorAll('.pagefind-ui__result-link').length === 0);
  }
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Control+k');
  await input.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('.pagefind-ui__search-input, .search-fallback__input'));
  await page.locator('[data-search-close]').click();
  await page.keyboard.press('?');
  assert.equal(await page.locator('[data-shortcuts-dialog]').getAttribute('open'), '');
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('[data-search-dialog]').getAttribute('open'), null, 'Search overlaps another modal');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await page.close();
}

async function checkSearchRecovery(browser) {
  const { page, errors } = await newPage(browser, '/');
  await page.route('**/pagefind/pagefind-ui.js', (route) => route.abort());
  await page.route('**/search-index.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('[data-search-open]').click();
  await page.locator('[data-search-error]').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.unroute('**/search-index.json');
  await page.locator('[data-search-open]').click();
  await page.locator('.search-fallback__input').fill(query);
  await page.locator('.search-fallback__link').first().waitFor();
  assert.equal(await page.locator('[data-search-error]').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.unroute('**/pagefind/pagefind-ui.js');
  let pagefindRetries = 0;
  await page.route('**/pagefind/pagefind-ui.js', (route) => {
    pagefindRetries += 1;
    return route.continue();
  });
  await page.locator('[data-search-open]').click();
  await page.waitForLoadState('networkidle');
  assert.equal(pagefindRetries, 0, 'Reopening an active fallback retries Pagefind');
  assert.equal(await page.locator('[data-search-dialog] input').count(), 1,
    'Reopening fallback search creates duplicate search interfaces');
  assert.equal(await page.locator('.search-fallback__input').inputValue(), query);
  assert.deepEqual(errors, []);
  await page.close();
}

async function checkCopyAndTheme(browser) {
  const { page, errors } = await newPage(browser, postPath, { colorScheme: 'light' });
  await mockClipboard(page);
  const code = page.locator('pre:has(.copy-code)').first();
  await code.locator('.copy-code').focus();
  await code.locator('.copy-code').click();
  await page.waitForFunction(() => globalThis.__copies.length > 0);
  assert.equal(await page.evaluate(() => globalThis.__copies.pop()['text/plain']), await code.locator('code').innerText());
  const share = page.locator('.share-copy');
  await share.click();
  await page.waitForFunction(() => globalThis.__copies.length > 0);
  assert.equal(await page.evaluate(() => globalThis.__copies.pop()['text/plain']), await share.getAttribute('data-share-url'));

  // Both legacy failure modes must remove temporary controls and preserve focus.
  for (const shouldThrow of [false, true]) {
    // Start with successful feedback, then deny the next copy immediately.
    await mockClipboard(page);
    await code.locator('.copy-code').click();
    await share.click();
    await page.evaluate((shouldThrow) => {
      navigator.clipboard.writeText = async () => { throw new Error('denied'); };
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: () => {
          if (shouldThrow) throw new Error('unavailable');
          return false;
        },
      });
    }, shouldThrow);
    const before = await page.locator('textarea').count();
    const codeButton = code.locator('.copy-code');
    await codeButton.focus();
    await codeButton.click();
    assert.equal(await codeButton.getAttribute('aria-label'), 'Copy failed');
    assert.equal(await codeButton.evaluate((element) => element.classList.contains('is-copied')), false,
      'A failed code copy still shows successful feedback');
    assert.equal(await codeButton.evaluate((element) => element === document.activeElement), true);
    await share.focus();
    await share.click();
    await page.waitForFunction(() => document.querySelector('.share-copy').classList.contains('is-failed'));
    assert.equal(await share.evaluate((element) => element.classList.contains('is-copied')), false,
      'A failed retry still shows the previous successful copy state');
    assert.equal(await page.locator('textarea').count(), before, 'Failed copy leaked a temporary textarea');
    assert.equal(await share.evaluate((element) => element === document.activeElement), true);
  }

  await mockClipboard(page);
  await code.locator('.copy-code').click();
  assert.equal(await code.locator('.copy-code').getAttribute('aria-label'), 'Copied');
  assert.equal(await code.locator('.copy-code').evaluate((element) => element.classList.contains('is-failed')), false);

  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.deepEqual(errors, []);
  await page.close();
}

async function checkNavigationAndGallery(browser) {
  const { page, errors } = await newPage(browser, '/ja/', { viewport: { width: 393, height: 852 } });
  const toggle = page.locator('[data-nav-toggle]');
  await toggle.click();
  await page.locator('.cv-prose h2').first().click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Outside click leaves navigation open');
  for (const [key, destination] of [['b', '/ja/posts'], ['p', '/ja/gallery'], ['c', '/ja/#cv'], ['h', '/ja/']]) {
    const target = new URL(destination, server.url);
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await page.waitForURL((location) => `${location.pathname.replace(/\/$/, '')}${location.hash}` === `${target.pathname.replace(/\/$/, '')}${target.hash}`);
    await page.waitForLoadState('networkidle');
  }
  await page.goto(server.url + '/gallery/', { waitUntil: 'networkidle' });
  const slideshow = page.locator('.photo-slideshow');
  const current = () => page.locator('.slideshow-progress-current').textContent();
  const total = await page.locator('.slideshow-progress-total').textContent();
  await slideshow.locator('.prev').click();
  await page.waitForFunction((total) =>
    document.querySelector('.slideshow-progress-current').textContent === total, total);
  assert.equal(await current(), total, 'Previous slide does not wrap to the last image');
  await slideshow.locator('.prev').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.slideshow-progress-current').textContent === '1');
  assert.equal(await current(), '1', 'Arrow navigation does not wrap to the first image');
  await slideshow.locator('[data-speed="8000"]').click();
  assert.equal(await slideshow.locator('[aria-pressed="true"]').getAttribute('data-speed'), '8000');
  await slideshow.locator('.fullscreen-btn').click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('photo-slideshow'));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.slideshow-progress-current').textContent === '2');
  assert.equal(await current(), '2', 'Fullscreen arrow navigation does not advance the image');
  await slideshow.locator('.fullscreen-btn').click();
  await page.waitForFunction(() => !document.fullscreenElement);

  // A single image still exposes a fullscreen button and must wire it.
  await page.route('**/gallery/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replaceAll('class="slide"', 'class="fixture-inactive" hidden');
    await route.fulfill({ response, body: html });
  });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await slideshow.locator('.slide').count(), 1);
  await slideshow.locator('.fullscreen-btn').click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('photo-slideshow'));
  await slideshow.locator('.fullscreen-btn').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.deepEqual(errors, []);
  await page.close();
}

try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      for (const path of ['/', '/ja/']) {
        await checkCv(browser, path);
        await checkSearch(browser, path, false);
        await checkSearch(browser, path, true);
        console.log(`[interactions] ${engine.name()} ${path}: CV, print, search and keyboard passed`);
      }
      await checkSearchRecovery(browser);
      await checkCopyAndTheme(browser);
      await checkNavigationAndGallery(browser);
      console.log(`[interactions] ${engine.name()}: recovery, copy feedback, theme, navigation and fullscreen passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
