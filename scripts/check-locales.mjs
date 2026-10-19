import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { chromium, firefox, webkit } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';
import { browserEngines } from './lib/browser-engines.mjs';

const server = await startStaticServer(resolve(import.meta.dirname, '../dist'));
try {
  for (const path of ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-0.xml', '/sitemap-images.xml', '/sitemap.xsl', '/indexnow-key.txt']) {
    assert.equal((await fetch(server.url + path)).status, 404, `${path} is still published`);
  }
  assert.doesNotMatch(await (await fetch(`${server.url}/robots.txt`)).text(), /^Sitemap:/m);
  const { items } = await (await fetch(`${server.url}/search-index.json`)).json();
  const postsDir = resolve(import.meta.dirname, '../src/content/posts');
  const sourcePosts = readdirSync(postsDir, { recursive: true })
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({
      path: `/posts/${file.replace(/\.md$/, '')}/`,
      ...parseFrontmatter(readFileSync(resolve(postsDir, file), 'utf8')).frontmatter,
    }));
  for (const lang of ['en', 'ja']) {
    const actual = items.filter((item) => item.lang === lang && item.date && item.url.startsWith('/posts/'))
      .map((item) => decodeURI(new URL(item.url, server.url).pathname)).sort();
    const expected = sourcePosts.filter((post) => post.lang.includes(lang)).map((post) => post.path).sort();
    assert.deepEqual(actual, expected, `Search index does not match declared post languages (${lang})`);
  }
  const legalPages = items.filter((item) => item.date && !item.url.startsWith('/posts/'));
  const post = items.find((item) => item.date && item.url.startsWith('/posts/') && item.lang === 'ja')
    ?? items.find((item) => item.date && item.url.startsWith('/posts/'));

  for (const engine of browserEngines([chromium, firefox, webkit])) {
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
      await page.evaluate(() => {
        globalThis.__linkMutations = [];
        new MutationObserver((records) => {
          globalThis.__linkMutations.push(...records.filter((record) => !record.target.closest('.lang-switch')));
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['href'] });
        location.hash = 'main-content';
      });
      await page.waitForFunction(() => document.querySelector('.lang-switch a').hash === '#main-content');
      assert.equal(await page.evaluate(() => globalThis.__linkMutations.length), 0,
        'Hash navigation rewrites unrelated page links');

      for (const lang of ['en', 'ja']) {
        await page.goto(`${server.url}/?lang=${lang}`, { waitUntil: 'networkidle' });
        const identity = await page.locator('.cv-prose').evaluate((prose) => {
          const heading = prose.querySelector('h1');
          const clone = heading.cloneNode(true);
          clone.querySelectorAll('.heading-anchor, .cv-section-actions').forEach((node) => node.remove());
          const intro = heading.nextElementSibling;
          const section = prose.querySelector('h2');
          const toolbar = document.querySelector('.cv-header');
          return {
            name: clone.textContent.trim(),
            bio: intro.textContent.trim(),
            gap: section.getBoundingClientRect().top - intro.getBoundingClientRect().bottom,
            toolbarOffset: toolbar.getBoundingClientRect().top - heading.getBoundingClientRect().top,
          };
        });
        assert.equal(await page.locator('main h1').count(), 1, 'The CV duplicates the profile heading');
        assert.equal(await page.title(), identity.name);
        assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), identity.bio);
        assert.equal(await page.locator('meta[property="og:site_name"]').getAttribute('content'), identity.name);
        assert.equal(await page.locator('.cv-prose h1 .cv-section-actions').count(), 0);
        assert.equal(await page.locator('.cv-prose h2').first().locator('.cv-section-actions').count(), 1);
        assert.ok(identity.gap <= 32, `Empty CV toolbar row leaves a ${identity.gap}px gap`);
        assert.ok(Math.abs(identity.toolbarOffset) <= 1, 'The copy toolbar is detached from the CV title');
        const graph = await page.locator('script[type="application/ld+json"]').textContent();
        assert.equal(JSON.parse(graph)['@graph'].find((node) => node['@type'] === 'Person').name, identity.name);
        assert.equal(await page.locator('link[rel="webmention"], link[rel="pingback"]').count(), 0);

        await page.goto(`${server.url}/contact?lang=${lang}`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('[data-contact-lang]').getAttribute('data-contact-lang'), lang);
        assert.equal(await page.locator('.contact-form').count(), 1);
        const form = new URL(await page.locator('.contact-form').getAttribute('src'));
        assert.equal(form.searchParams.get('embedded'), 'true');
        assert.equal(await page.locator('main a[href*="/forms/"]').count(), 0, 'Contact still shows a redundant form link');

        const expectedPosts = sourcePosts.filter((post) => post.lang.includes(lang));
        await page.goto(`${server.url}/posts/?lang=${lang}`, { waitUntil: 'networkidle' });
        const archivePaths = await page.locator('[data-post-row] a').evaluateAll((links) =>
          links.map((link) => decodeURI(new URL(link.href).pathname).replace(/\/$/, '')).sort());
        assert.deepEqual(archivePaths, expectedPosts.map((post) => post.path.replace(/\/$/, '')).sort(),
          `Post archive ignores declared languages (${lang})`);
        if (!expectedPosts.length) {
          assert.equal(await page.getByText('Nothing here yet.', { exact: true }).isVisible(), true);
        }
        await page.goto(`${server.url}/sitemap/?lang=${lang}`, { waitUntil: 'networkidle' });
        const sitemapPaths = await page.locator('main a[href]').evaluateAll((links) =>
          links.map((link) => new URL(link.href)).filter((url) => /^\/posts\/[^/]+\/$/.test(url.pathname))
            .map((url) => decodeURI(url.pathname)).sort());
        assert.deepEqual(sitemapPaths, expectedPosts.map((post) => post.path).sort(),
          `Sitemap ignores declared languages (${lang})`);

        for (const sourcePost of sourcePosts) {
          await page.goto(`${server.url}${sourcePost.path}?lang=${lang}`, { waitUntil: 'networkidle' });
          if (!sourcePost.lang.includes(lang)) {
            await page.waitForURL((url) => url.pathname === '/posts/' && url.searchParams.get('lang') === lang);
            assert.equal(await page.locator('article').count(), 0, 'Unavailable post content remains visible');
            continue;
          }
          assert.equal(await page.locator('article').getAttribute('lang'), lang);
          assert.equal(await page.locator('.post-header h1').innerText(), sourcePost.title);
          const alternates = await page.locator('link[rel="alternate"][hreflang]:not([hreflang="x-default"])')
            .evaluateAll((links) => links.map((link) => link.hreflang).sort());
          assert.deepEqual(alternates, [...sourcePost.lang].sort(), 'Post advertises an unavailable locale');
          for (const target of ['en', 'ja']) {
            const switchLink = page.locator(`.lang-switch a[hreflang="${target}"]`);
            const switchUrl = new URL(await switchLink.getAttribute('href'), server.url);
            assert.equal(decodeURI(switchUrl.pathname), sourcePost.lang.includes(target) ? sourcePost.path : '/posts/');
          }
        }
      }

      for (const item of legalPages) {
        await page.goto(server.url + item.url, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('main h1').innerText(), item.title);
        assert.equal(await page.locator('html').getAttribute('lang'), item.lang);
        assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), item.description);
        assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).searchParams.get('lang'), item.lang);
        assert.equal(await page.locator('link[rel="sitemap"]').count(), 0);
      }
      const legacy = new URL(post.url, server.url).pathname;
      await page.goto(`${server.url}/${post.lang}${legacy}?tag=beta#main-content`, { waitUntil: 'networkidle' });
      const redirected = new URL(page.url());
      assert.equal(redirected.pathname.replace(/\/$/, ''), legacy.replace(/\/$/, ''));
      assert.equal(redirected.searchParams.get('lang'), post.lang);
      assert.equal(redirected.searchParams.get('tag'), 'beta');
      assert.equal(redirected.hash, '#main-content');
      assert.equal(await page.locator('.nav-list a[aria-current="page"]').innerText(), 'Posts');
      assert.equal(await page.locator('.draft, .draft-badge').count(), 0);
      const links = await page.locator('header a[href], .breadcrumb-nav a[href], .post-nav a[href], footer a[href]')
        .evaluateAll((anchors) => anchors.filter((anchor) => !anchor.closest('.lang-switch')).map((anchor) => anchor.href));
      for (const href of links) {
        const url = new URL(href);
        if (url.origin === server.url) assert.equal(url.searchParams.get('lang'), post.lang);
      }
      const shared = new URL(await page.locator('[data-share-url]').getAttribute('data-share-url'));
      assert.equal(shared.searchParams.get('lang'), post.lang);
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
