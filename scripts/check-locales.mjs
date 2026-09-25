import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const server = await startStaticServer(resolve(import.meta.dirname, '../dist'));
try {
  for (const path of ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-0.xml', '/sitemap-images.xml', '/sitemap.xsl']) {
    assert.equal((await fetch(server.url + path)).status, 404, `${path} is still published`);
  }
  assert.doesNotMatch(await (await fetch(`${server.url}/robots.txt`)).text(), /^Sitemap:/m);
  const { items } = await (await fetch(`${server.url}/search-index.json`)).json();
  const sourcePosts = readdirSync(resolve(import.meta.dirname, '../src/content/posts'), { recursive: true })
    .filter((file) => file.endsWith('.md'));
  for (const lang of ['en', 'ja']) {
    assert.equal(items.filter((item) => item.lang === lang && item.date && item.url.startsWith('/posts/')).length,
      sourcePosts.length, 'Every post must be included in the production index');
  }
  const legalPages = items.filter((item) => item.date && !item.url.startsWith('/posts/'));
  const post = items.find((item) => item.date && item.url.startsWith('/posts/') && item.lang === 'en');

  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
      for (const query of ['', '?lang=invalid', '?lang=en']) {
        await page.goto(`${server.url}/${query}`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('html').getAttribute('lang'), 'en');
        assert.equal(await page.locator('.cv-prose').getAttribute('data-cv-lang'), 'en');
      }
      await page.goto(`${server.url}/?tag=alpha&lang=ja#cv`, { waitUntil: 'networkidle' });
      await page.locator('.lang-switch a[hreflang="en"]').click();
      await page.waitForLoadState('networkidle');
      const switched = new URL(page.url());
      assert.equal(switched.pathname, '/');
      assert.equal(switched.searchParams.get('lang'), 'en');
      assert.equal(switched.searchParams.get('tag'), 'alpha');
      assert.equal(switched.hash, '#cv');
      await page.goBack({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('.cv-prose').getAttribute('data-cv-lang'), 'ja');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('.cv-prose').getAttribute('data-cv-lang'), 'ja');

      for (const item of legalPages) {
        await page.goto(server.url + item.url, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('main h1').innerText(), item.title);
        assert.equal(await page.locator('html').getAttribute('lang'), item.lang);
        assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), item.description);
        assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).searchParams.get('lang'), item.lang);
        assert.equal(await page.locator('link[rel="sitemap"]').count(), 0);
      }
      const legacy = new URL(post.url, server.url).pathname;
      await page.goto(`${server.url}/ja${legacy}?tag=beta#main-content`, { waitUntil: 'networkidle' });
      const redirected = new URL(page.url());
      assert.equal(redirected.pathname.replace(/\/$/, ''), legacy.replace(/\/$/, ''));
      assert.equal(redirected.searchParams.get('lang'), 'ja');
      assert.equal(redirected.searchParams.get('tag'), 'beta');
      assert.equal(redirected.hash, '#main-content');
      assert.equal(await page.locator('.nav-list a[aria-current="page"]').innerText(), 'Posts');
      assert.equal(await page.locator('.draft, .draft-badge').count(), 0);
      const links = await page.locator('header a[href], .breadcrumb-nav a[href], .post-nav a[href], footer a[href]')
        .evaluateAll((anchors) => anchors.filter((anchor) => !anchor.closest('.lang-switch')).map((anchor) => anchor.href));
      for (const href of links) {
        const url = new URL(href);
        if (url.origin === server.url) assert.equal(url.searchParams.get('lang'), 'ja');
      }
      const shared = new URL(await page.locator('[data-share-url]').getAttribute('data-share-url'));
      assert.equal(shared.searchParams.get('lang'), 'ja');
      assert.equal(shared.searchParams.has('tag'), false);
      assert.equal(new URL(await page.locator('.share-btn--x').getAttribute('href')).searchParams.get('url'), shared.href);
      assert.deepEqual(errors, []);
      await page.close();

      const noScript = await browser.newPage({ javaScriptEnabled: false });
      await noScript.route('**/*', (route) =>
        new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
      await noScript.goto(`${server.url}/?lang=ja`, { waitUntil: 'networkidle' });
      assert.equal(await noScript.locator('.cv-prose').getAttribute('data-cv-lang'), 'en');
      await noScript.close();
      console.log(`[locales] ${engine.name()}: query URLs, content, metadata, redirects, sharing, and fallback passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
