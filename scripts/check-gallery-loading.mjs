import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const server = await startStaticServer(resolve(import.meta.dirname, '../dist'));

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

async function checkViewportLoading(browser, path, viewport) {
  const { page, requests, errors } = await newPage(browser, { viewport });
  try {
    await page.goto(server.url + path, { waitUntil: 'networkidle' });
    const tiles = await page.locator('.photo-btn > img').evaluateAll((images) => images.map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        src: new URL(image.dataset.src || image.src, location.href).href,
        top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
        expectedRatio: Number(image.getAttribute('width')) / Number(image.getAttribute('height')),
      };
    }));
    assert.ok(tiles.length > 0, 'Gallery checks need at least one image');
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
    const heights = await page.locator('.photo-btn > img').evaluateAll((images) =>
      images.map((image) => image.getBoundingClientRect().height));
    assert.ok(heights.every((height, index) => Math.abs(height - tiles[index].height) < 1),
      'Loading tiles changes the masonry layout');
    assert.deepEqual(errors, []);
    return tiles.map((tile) => tile.src);
  } finally {
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

try {
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      for (const path of ['/gallery/?lang=en', '/gallery/?lang=ja']) {
        let sources;
        for (const viewport of [{ width: 393, height: 852 }, { width: 1280, height: 900 }]) {
          sources = await checkViewportLoading(browser, path, viewport);
        }
        await checkSlowNavigation(browser, path, sources);
        await checkFallbacks(browser, path);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
console.log('[gallery] OK: bounded loading, stable layouts, ready frames, navigation races and fallbacks in all engines');
