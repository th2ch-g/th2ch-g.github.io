import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';
import { browserEngines } from './lib/browser-engines.mjs';

const { values } = parseArgs({ options: { dist: { type: 'string' } } });
const server = await startStaticServer(values.dist ? resolve(values.dist) : resolve(import.meta.dirname, '../dist'));

async function newPage(browser, options = {}) {
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 }, reducedMotion: 'reduce', ...options,
  });
  page.setDefaultTimeout(10_000);
  const requests = new Set();
  const errors = [];
  page.on('request', (request) => requests.add(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
  return { page, requests, errors };
}

async function waitForSlide(page, index) {
  await page.waitForFunction((index) => {
    const slides = [...document.querySelectorAll('.photo-slideshow .slide')];
    const image = slides[index].querySelector('img');
    return slides[index].classList.contains('active') && image.complete && image.naturalWidth > 0;
  }, index);
}

async function goToSlide(page, index) {
  await page.locator('.photo-slideshow').evaluate((root, index) =>
    root.dispatchEvent(new CustomEvent('photoslideshow:goto', { detail: { index } })), index);
}

async function readTiles(page) {
  return page.locator('.photo-btn > img').evaluateAll((images) => images.map((image) => {
    const rect = image.getBoundingClientRect();
    return {
      src: new URL(image.dataset.src || image.src, location.href).href,
      left: rect.left + scrollX, top: rect.top + scrollY, bottom: rect.bottom + scrollY,
      width: rect.width, height: rect.height,
      expectedRatio: Number(image.getAttribute('width')) / Number(image.getAttribute('height')),
    };
  }));
}

function assertStableTiles(before, after) {
  assert.equal(after.length, before.length);
  assert.ok(after.every((tile, index) => ['left', 'top', 'width', 'height']
    .every((key) => Math.abs(tile[key] - before[index][key]) < 1)),
  'Image responses change gallery tile positions or sizes');
}

async function checkViewportLoading(browser, path, viewport) {
  const { page, requests, errors } = await newPage(browser, { viewport });
  const imagesReady = gate();
  await page.route('**/_astro/*', async (route) => {
    if (route.request().resourceType() !== 'image') return route.fallback();
    await imagesReady.ready;
    await route.continue();
  });
  try {
    await page.goto(server.url + path, { waitUntil: 'domcontentloaded' });
    // WebKit's fonts.ready also waits for the image responses held below.
    await page.waitForFunction(() => [...document.fonts].every((font) => font.status !== 'loading'));
    await page.waitForFunction(() => document.querySelector('.photo-btn > img[src]'));
    // Hold responses across rendering frames so pending-image column breaks are observable.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pendingTiles = await readTiles(page);
    imagesReady.release();
    await page.waitForLoadState('networkidle');
    const tiles = await readTiles(page);
    assert.ok(tiles.length > 0, 'Gallery checks need at least one image');
    assertStableTiles(pendingTiles, tiles);
    const expected = new Set(tiles.filter((tile) => tile.top <= viewport.height + 301 && tile.bottom >= -301)
      .map((tile) => tile.src));
    tiles.slice(0, 2).forEach((tile) => expected.add(tile.src));
    const initial = tiles.filter((tile) => requests.has(tile.src));
    assert.deepEqual(initial.filter((tile) => !expected.has(tile.src)), [], 'Distant tiles were fetched');
    assert.equal(await page.locator('.photo-slideshow img[src]').count(), Math.min(2, tiles.length),
      'Prefetch must stop at one adjacent frame');
    for (const tile of tiles) {
      assert.ok(tile.height > 0 && Math.abs(tile.width / tile.height - tile.expectedRatio) < 0.01,
        'An unloaded tile does not reserve its image aspect ratio');
    }
    console.log(`[gallery] ${browser.browserType().name()} ${path} ${viewport.width}px: ${initial.length}/${tiles.length} initial images`);

    // Opening the last preview must work even though its tile has no src yet.
    await page.locator('.photo-btn').first().click();
    if (tiles.length > 1) await page.locator('.lightbox-prev').click();
    await page.waitForFunction((src) => {
      const image = document.querySelector('.lightbox-img');
      return image.src === src && image.complete && image.naturalWidth > 0;
    }, tiles.at(-1).src);
    await page.locator('.lightbox-close').click();
    await page.locator('#lightbox').waitFor({ state: 'hidden' });

    const distantIndex = tiles.reduce((best, tile, index) => tile.top > tiles[best].top ? index : best, 0);
    await page.locator('.photo-btn').nth(distantIndex).scrollIntoViewIfNeeded();
    await page.waitForFunction((index) => {
      const image = document.querySelectorAll('.photo-btn > img')[index];
      return image.hasAttribute('src') && image.complete && image.naturalWidth > 0;
    }, distantIndex);
    assertStableTiles(tiles, await readTiles(page));
    assert.deepEqual(errors, []);
    return tiles.map((tile) => tile.src);
  } finally {
    imagesReady.release();
    await page.close();
  }
}

function gate() {
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return { ready, release };
}

async function checkSlowNavigation(browser, path, sources) {
  if (sources.length < 10) return;
  const { page, requests, errors } = await newPage(browser);
  const slow = sources.length - 8;
  const stale = sources.length - 5;
  const latest = stale + 1;
  const broken = sources.length - 2;
  const gates = new Map([0, slow, stale, latest].map((index) => [sources[index], gate()]));
  let failImage = true;
  await page.route((url) => gates.has(url.href) || url.href === sources[broken], async (route) => {
    if (route.request().url() === sources[broken] && failImage) return route.abort('failed');
    await gates.get(route.request().url())?.ready;
    await route.continue();
  });
  try {
    await page.goto(server.url + path, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.photo-slideshow img[src]').count(), 1,
      'Prefetch competes with the unfinished first frame');
    gates.get(sources[0]).release();
    await page.waitForLoadState('networkidle');

    let loading = page.waitForRequest(sources[slow]);
    await goToSlide(page, slow);
    await loading;
    await waitForSlide(page, 0);
    gates.get(sources[slow]).release();
    await waitForSlide(page, slow);

    loading = page.waitForRequest(sources[stale]);
    await goToSlide(page, stale);
    await loading;
    loading = page.waitForRequest(sources[latest]);
    await page.locator('.photo-slideshow .next').click();
    await loading;
    await waitForSlide(page, slow);
    gates.get(sources[latest]).release();
    await waitForSlide(page, latest);
    gates.get(sources[stale]).release();
    await page.waitForLoadState('networkidle');
    await waitForSlide(page, latest);
    assert.ok(requests.has(sources[latest + 1]), 'The next frame was not prefetched');
    assert.equal(requests.has(sources[latest + 2]), false, 'Prefetch cascades beyond one frame');

    await page.locator('.photo-slideshow .next').click();
    await waitForSlide(page, latest + 1);
    await page.waitForFunction((index) =>
      document.querySelectorAll('.slide img')[index].hasAttribute('data-src'), broken);
    const failure = page.waitForEvent('requestfailed', { predicate: (request) => request.url() === sources[broken] });
    await page.locator('.photo-slideshow .next').click();
    await failure;
    await page.waitForFunction((index) =>
      document.querySelectorAll('.slide img')[index].hasAttribute('data-src'), broken);
    await waitForSlide(page, latest + 1);
    await page.locator('.photo-slideshow .next').click();
    await waitForSlide(page, broken + 1);
    failImage = false;
    await goToSlide(page, broken);
    await waitForSlide(page, broken);
    assert.deepEqual(errors, [], 'Image failures produced an unhandled exception');
    console.log(`[gallery] ${browser.browserType().name()} ${path}: delayed loads, rapid navigation, failures and retries passed`);
  } finally {
    gates.forEach(({ release }) => release());
    await page.close();
  }
}

async function checkFallbacks(browser, path) {
  for (const javaScriptEnabled of [false, true]) {
    const { page, errors } = await newPage(browser, { javaScriptEnabled });
    try {
      if (javaScriptEnabled) await page.addInitScript(() => { delete window.IntersectionObserver; });
      await page.goto(server.url + path, { waitUntil: 'networkidle' });
      const images = page.locator(javaScriptEnabled ? '.photo-btn > img' : '.photo-btn noscript img');
      assert.ok(await images.count() > 0);
      assert.ok(await images.evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
        'The image-loading fallback leaves empty tiles');
      assert.equal(await images.first().isVisible(), true);
      if (!javaScriptEnabled) assert.equal(await page.locator('.photo-btn > img').first().isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
}

async function checkImageResidency(browser) {
  const { page, errors } = await newPage(browser);
  try {
    await page.goto(`${server.url}/gallery/`, { waitUntil: 'networkidle' });
    const total = await page.locator('.slide').count();
    for (let index = 0; index < total; index++) {
      await goToSlide(page, index);
      await waitForSlide(page, index);
      await page.waitForFunction(() => document.querySelectorAll('.slide img[src]').length <= 2);
    }
    await goToSlide(page, 0);
    await waitForSlide(page, 0);

    // Closing before the opening animation frame must not resurrect the modal.
    await page.locator('.photo-btn').first().focus();
    await page.evaluate(() => {
      document.querySelector('.photo-btn').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden);
    assert.equal(await page.locator('.lightbox-img').getAttribute('src'), null);
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.equal(await page.locator('.photo-btn').first().evaluate((button) => button === document.activeElement), true);

    // A previous close timeout must not hide a preview that was reopened.
    await page.evaluate(() => {
      const button = document.querySelector('.photo-btn');
      button.click();
      document.querySelector('.lightbox-close').click();
      button.click();
    });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lightbox').isVisible(), true);
    assert.equal(await page.locator('#lightbox').evaluate((element) => element.classList.contains('open')), true);
    assert.ok(await page.locator('[inert]').count() > 0);
    await page.locator('.lightbox-close').click();
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden);
    assert.equal(await page.locator('.lightbox-img').getAttribute('src'), null);
    assert.deepEqual(errors, []);

    if (total > 3) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await goToSlide(page, 2);
      await waitForSlide(page, 2);
      assert.ok(await page.locator('.slide img').first().getAttribute('src'), 'The outgoing frame was released before its crossfade');
      await page.waitForFunction(() => !document.querySelector('.slide img').hasAttribute('src'));
      assert.equal(await page.locator('.slide img[src]').count(), 2);
    }
    console.log(`[gallery] ${browser.browserType().name()}: ${total} slides visited, at most 2 retained images; preview races passed`);
  } finally {
    await page.close();
  }
}

try {
  for (const engine of browserEngines([chromium, firefox, webkit])) {
    const browser = await engine.launch();
    try {
      for (const path of ['/gallery/?lang=en', '/gallery/?lang=ja']) {
        let sources;
        for (const viewport of [{ width: 393, height: 852 }, { width: 768, height: 900 }, { width: 1280, height: 900 }]) {
          sources = await checkViewportLoading(browser, path, viewport);
        }
        await checkSlowNavigation(browser, path, sources);
        await checkFallbacks(browser, path);
      }
      await checkImageResidency(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
console.log('[gallery] OK: bounded loading, stable layouts, ready frames, navigation races and fallbacks');
