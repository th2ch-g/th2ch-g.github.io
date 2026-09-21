import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const distDir = resolve(import.meta.dirname, '../dist');
const pages = readdirSync(distDir, { recursive: true })
  .filter((file) => file.endsWith('.html'))
  .map((file) => ({
    path: '/' + file.split(sep).join('/').replace(/index\.html$/, ''),
    html: readFileSync(resolve(distDir, file), 'utf8'),
  }))
  .filter(({ html }) => html.includes('<main'));
const tweets = pages.filter(({ html }) => html.includes('class="tweet-embed"'));
const server = await startStaticServer(distDir);
const widgetUrl = 'https://platform.twitter.com/widgets.js';

async function newPage(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce', ...options });
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
  return { page, requests, errors };
}

async function checkIcons(browser) {
  for (const deviceScaleFactor of [1, 2, 3, 4]) {
    const { page, requests, errors } = await newPage(browser, { deviceScaleFactor });
    try {
      await page.goto(server.url, { waitUntil: 'networkidle' });
      const icon = page.locator('.brand-icon');
      if (!await icon.count()) continue;
      const image = await icon.evaluate(async (image) => {
        await image.decode();
        return { source: image.currentSrc, width: image.getBoundingClientRect().width };
      });
      const bytes = await (await fetch(image.source)).arrayBuffer();
      const pixels = new DataView(bytes).getUint32(16);
      assert.ok(pixels >= image.width * deviceScaleFactor && pixels <= 128,
        'Header image is blurry or downloads an oversized master');
      assert.ok(!requests.some((url) => new URL(url).pathname === '/icon.png'),
        'The header still downloads the full-size social-card icon');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
}

async function checkTweets(browser, path, mode) {
  const { page, requests, errors } = await newPage(browser, { javaScriptEnabled: mode !== 'no-js' });
  try {
    if (mode === 'no-observer') await page.addInitScript(() => { delete window.IntersectionObserver; });
    if (mode !== 'blocked') {
      await page.route(widgetUrl, (route) => route.fulfill({
        contentType: 'application/javascript', body: 'globalThis.__widgetLoads = (globalThis.__widgetLoads || 0) + 1;',
      }));
    }
    await page.goto(server.url + path, { waitUntil: 'networkidle' });
    const links = page.locator('.tweet-embed a');
    const initialCount = requests.filter((url) => url === widgetUrl).length;
    if (mode === 'no-js') {
      assert.equal(initialCount, 0);
    } else if (mode === 'no-observer') {
      assert.equal(initialCount, 1);
    } else {
      const nearby = await page.locator('.tweet-embed').evaluateAll((embeds) => embeds.some((embed) =>
        embed.getBoundingClientRect().top <= innerHeight + 300));
      assert.equal(initialCount, Number(nearby), 'Distant embeds start third-party work during initial loading');
    }
    await links.first().scrollIntoViewIfNeeded();
    assert.equal(await links.first().isVisible(), true, 'The fallback source link is unavailable');
    if (mode !== 'no-js') {
      await page.waitForFunction((url) => document.querySelectorAll(`script[src="${url}"]`).length === 1, widgetUrl);
      if (mode !== 'blocked') await page.waitForFunction(() => globalThis.__widgetLoads === 1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await links.last().scrollIntoViewIfNeeded();
      await page.waitForLoadState('networkidle');
      assert.equal(requests.filter((url) => url === widgetUrl).length, 1, 'The SDK was loaded more than once');
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  for (const { path, html } of pages) {
    assert.equal(/<link[^>]+href="[^"]*katex[^>]+>/.test(html), html.includes('class="katex"'),
      `Math stylesheet presence does not match the rendered formulae: ${path}`);
  }
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      await checkIcons(browser);
      for (const { path } of tweets) await checkTweets(browser, path, 'normal');
      if (tweets.length) {
        for (const mode of ['blocked', 'no-js', 'no-observer']) await checkTweets(browser, tweets[0].path, mode);
      }
      console.log(`[loading] ${engine.name()}: icon density, deferred embeds and fallbacks passed`);
    } finally {
      await browser.close();
    }
  }
  console.log(`[loading] Math stylesheet selection checked on ${pages.length} pages`);
} finally {
  await server.close();
}
