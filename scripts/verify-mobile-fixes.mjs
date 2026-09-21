import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const distDir = resolve(import.meta.dirname, '../dist');
const { url, close } = await startStaticServer(distDir);
const browser = await chromium.launch({ headless: true });

async function newLocalPage(viewport) {
  const page = await browser.newPage({ viewport });
  const localOrigin = new URL(url).origin;
  await page.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === localOrigin ? route.continue() : route.abort();
  });
  return page;
}

async function assertHomeLocales() {
  const page = await newLocalPage({ width: 1280, height: 900 });
  for (const [lang, path, other] of [['en', '/', '/ja/'], ['ja', '/ja/', '/']]) {
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cv-actions] summary').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    assert.equal(await page.locator('main h1').count(), 1, 'Home must have one page heading');
    assert.equal(await page.locator('.hero + #cv').count(), 1, 'CV does not follow the profile');
    assert.equal(await page.locator('.cv-prose').getAttribute('data-cv-lang'), lang);
    assert.equal(await page.locator('[data-post-row], .posts-section').count(), 0,
      'Home still contains the recent posts list');
    assert.equal(await page.locator('.cv-prose [data-cv-section="peer-reviewed"]').count(), 1,
      'Home is missing its publication section');
    assert.equal(await page.locator('.nav-list a[href$="/cv"]').count(), 0,
      'Navigation still links to the removed CV page');
    assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).pathname, path);
    assert.equal(new URL(await page.locator('link[hreflang="en"]').getAttribute('href')).pathname, '/');
    assert.equal(new URL(await page.locator('link[hreflang="ja"]').getAttribute('href')).pathname, '/ja/');
    assert.equal(new URL(await page.locator('link[hreflang="x-default"]').getAttribute('href')).pathname, '/');
    const previewUrl = new URL(await page.locator('meta[property="og:image"]').getAttribute('content'));
    assert.equal(previewUrl.pathname, `${path}og/default.png`);
    assert.match(previewUrl.searchParams.get('v'), /^[a-f0-9]{12}$/,
      'Social preview URL does not include a renderer revision');
    assert.equal(await page.locator('.lang-switch a:not([aria-current])').getAttribute('href'), other);
    await page.locator('.lang-switch a:not([aria-current])').click();
    await page.waitForURL(`${url}${other}`);
  }

  for (const [from, to] of [
    ['/en/', '/'], ['/cv/', '/ja/#cv'], ['/en/cv/', '/#cv'],
    ['/en/posts/', '/posts'], ['/en/contact/', '/contact'],
    ['/en/posts/dotfiles-2026-summer/', '/posts/dotfiles-2026-summer'],
  ]) {
    const target = new URL(to, url);
    await page.goto(`${url}${from}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((location) =>
      location.pathname.replace(/\/$/, '') + location.hash ===
      target.pathname.replace(/\/$/, '') + target.hash,
    );
    await page.locator('main').waitFor();
  }
  await page.close();
}

async function assertHeadingAnchorClearsHeader(path) {
  const page = await newLocalPage({ width: 393, height: 852 });
  await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('[data-toc-panel], [data-toc-toggle]').count(), 0,
    `A removed table of contents is still rendered on ${path}`);
  const heading = page.locator('.prose :is(h1, h2, h3, h4, h5, h6)[id]').first();
  const targetId = await heading.getAttribute('id');
  assert.ok(targetId, `Page has no heading anchor on ${path}`);
  await page.goto(`${url}${path}#${encodeURIComponent(targetId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (id) => decodeURIComponent(location.hash.slice(1)) === id,
    targetId,
  );

  const anchorLayout = await page.evaluate((id) => {
    const heading = document.getElementById(id);
    const header = document.querySelector('.site-header');
    if (!heading || !header) return null;
    return {
      headingTop: heading.getBoundingClientRect().top,
      headerBottom: header.getBoundingClientRect().bottom,
    };
  }, targetId);
  assert.ok(anchorLayout, `Heading target or navbar is missing on ${path}`);
  assert.ok(
    anchorLayout.headingTop > anchorLayout.headerBottom,
    `Heading target is hidden by the navbar on ${path} (${anchorLayout.headingTop}px / ${anchorLayout.headerBottom}px)`,
  );
  await page.close();
}

async function assertModalKeyboard(page, selector) {
  const modal = page.locator(selector);
  const focusableCount = await modal.locator('a[href], button').count();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < focusableCount + 2; step++) {
      await page.keyboard.press(key);
      assert.equal(
        await modal.evaluate((element) => element.contains(document.activeElement)),
        true,
        `${key} moves focus outside ${selector}`,
      );
    }
  }
  for (const key of ['/', 'Control+k']) {
    await page.keyboard.press(key);
    assert.equal(await page.locator('[data-search-dialog]').evaluate((dialog) => dialog.open), false,
      `${key} opens search while ${selector} is open`);
  }
}

async function assertStableFirstPaint() {
  const page = await newLocalPage({ width: 1280, height: 900 });
  await page.route('**/*.woff2', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.addInitScript(() => {
    globalThis.__layoutShiftTotal = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) globalThis.__layoutShiftTotal += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const path of ['/', '/ja/']) {
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const shift = await page.evaluate(() => globalThis.__layoutShiftTotal);
    assert.ok(shift < 0.001, `Delayed fonts or controls move content on ${path} (CLS ${shift})`);
  }
  await page.close();
}

async function assertCvBibtexCopy() {
  const page = await newLocalPage({ width: 1280, height: 900 });
  await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });

  const papers = page.locator('li.cv-has-bibtex');
  await papers.first().waitFor();
  assert.ok(await papers.count(), 'CV has no per-paper BibTeX menus');
  const firstPaper = papers.first();
  const trigger = firstPaper.locator('summary.cv-copy-btn');
  const opacity = Number.parseFloat(await trigger.evaluate((element) => getComputedStyle(element).opacity));
  assert.equal(opacity, 0, 'CV BibTeX menu is visible before hover');
  await firstPaper.hover();
  await page.waitForFunction(() => getComputedStyle(
    document.querySelector('li.cv-has-bibtex summary.cv-copy-btn'),
  ).opacity === '1');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.__cvCopiedBibtex = text;
        },
      },
    });
  });
  await trigger.click();
  assert.deepEqual(
    await firstPaper.locator('.cv-menu-item').allTextContents(),
    ['Text', 'BibTeX'],
    'CV paper copy menu does not expose text and BibTeX actions',
  );
  await firstPaper.getByRole('button', { name: 'BibTeX', exact: true }).click();
  const copied = await page.evaluate(() => globalThis.__cvCopiedBibtex ?? '');
  assert.match(copied, /^@article\{/, 'CV paper BibTeX action did not copy a BibTeX entry');
  await page.close();
}

async function assertFirefoxTouchAutoplay() {
  const firefoxBrowser = await firefox.launch({ headless: true });
  try {
    const page = await firefoxBrowser.newPage({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    const localOrigin = new URL(url).origin;
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      return requestUrl.origin === localOrigin ? route.continue() : route.abort();
    });
    await page.goto(`${url}/gallery/`, { waitUntil: 'networkidle' });

    const activeSlideIndex = () =>
      page.locator('.photo-slideshow .slide').evaluateAll(
        (slides) => slides.findIndex((slide) => slide.classList.contains('active')),
      );
    const before = await activeSlideIndex();

    // A speed selection is an explicit autoplay request. Dispatch a touch
    // boundary event after it to cover Firefox for Android's event order.
    await page.locator('[data-speed="3000"]').tap();
    await page.locator('.photo-slideshow').dispatchEvent('pointerenter', {
      pointerId: 3,
      isPrimary: true,
      pointerType: 'touch',
    });
    await page.waitForTimeout(3300);

    assert.notEqual(
      await activeSlideIndex(),
      before,
      'Firefox mobile gallery autoplay stops after touch interaction',
    );
    await page.close();
  } finally {
    await firefoxBrowser.close();
  }
}

try {
  await assertHomeLocales();
  await assertStableFirstPaint();
  await assertHeadingAnchorClearsHeader('/posts/dotfiles-2026-summer/');
  await assertHeadingAnchorClearsHeader('/');
  await assertHeadingAnchorClearsHeader('/ja/');
  await assertCvBibtexCopy();
  await assertFirefoxTouchAutoplay();

  const galleryPage = await newLocalPage({ width: 393, height: 852 });
  await galleryPage.goto(`${url}/gallery/`, { waitUntil: 'networkidle' });
  assert.equal(
    await galleryPage.locator('.photo-slideshow img[src]').count(),
    2,
    'The slideshow must load only the first frame and one prefetched frame',
  );
  const activeSlideIndex = () =>
    galleryPage.locator('.photo-slideshow .slide').evaluateAll(
      (slides) => slides.findIndex((slide) => slide.classList.contains('active')),
    );
  const slideBeforeSwipe = await activeSlideIndex();
  await galleryPage.locator('.photo-slideshow .slides').dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 320,
    clientY: 180,
  });
  await galleryPage.locator('.photo-slideshow .slides').dispatchEvent('pointerup', {
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 80,
    clientY: 185,
  });
  await galleryPage.waitForFunction((before) =>
    [...document.querySelectorAll('.photo-slideshow .slide')]
      .findIndex((slide) => slide.classList.contains('active')) !== before, slideBeforeSwipe);
  assert.notEqual(
    await activeSlideIndex(),
    slideBeforeSwipe,
    'Mobile gallery slideshow does not respond to horizontal swipes',
  );

  await galleryPage.locator('.photo-btn').first().click();
  const lightbox = galleryPage.locator('#lightbox');
  await lightbox.waitFor({ state: 'visible' });
  const lightboxImage = lightbox.locator('.lightbox-img');
  const firstLightboxSrc = await lightboxImage.getAttribute('src');
  await lightbox.locator('.lightbox-next').click();
  assert.notEqual(
    await lightboxImage.getAttribute('src'),
    firstLightboxSrc,
    'Mobile gallery lightbox next button does not change the image',
  );
  const secondLightboxSrc = await lightboxImage.getAttribute('src');
  await lightboxImage.dispatchEvent('pointerdown', {
    pointerId: 2,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 320,
    clientY: 420,
  });
  await lightboxImage.dispatchEvent('pointerup', {
    pointerId: 2,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 80,
    clientY: 425,
  });
  assert.notEqual(
    await lightboxImage.getAttribute('src'),
    secondLightboxSrc,
    'Mobile gallery lightbox does not respond to horizontal swipes',
  );
  await assertModalKeyboard(galleryPage, '#lightbox');
  await galleryPage.keyboard.press('Escape');
  await lightbox.waitFor({ state: 'hidden' });
  assert.equal(await galleryPage.locator('.photo-btn').first().evaluate(
    (button) => button === document.activeElement,
  ), true, 'Closing the lightbox does not restore focus to its image button');
  await galleryPage.close();

  const mobilePage = await newLocalPage({ width: 393, height: 852 });
  await mobilePage.goto(`${url}/`, { waitUntil: 'networkidle' });

  const headerLayout = await mobilePage.locator('.site-header .inner').evaluate((header) => {
    const controls = [
      header.querySelector('.brand'),
      header.querySelector('.search-trigger'),
      header.querySelector('.theme-toggle'),
      header.querySelector('.lang-switch'),
      header.querySelector('.nav-toggle'),
    ];
    const rects = controls.map((control) => control?.getBoundingClientRect());
    return {
      centerYs: rects.map((rect) => rect && rect.top + rect.height / 2),
      rightEdge: Math.max(...rects.map((rect) => rect?.right ?? 0)),
      viewportWidth: window.innerWidth,
    };
  });
  const headerCenterRange =
    Math.max(...headerLayout.centerYs) - Math.min(...headerLayout.centerYs);
  assert.ok(
    headerCenterRange < 1,
    `Mobile navigation controls wrap onto multiple rows (${headerLayout.centerYs.join(', ')})`,
  );
  assert.ok(
    headerLayout.rightEdge <= headerLayout.viewportWidth,
    'Mobile navigation controls overflow the viewport',
  );
  assert.deepEqual(
    (await mobilePage.locator('.lang-switch a').allTextContents()).map((label) => label.trim()),
    ['EN', 'JA'],
    'Language switcher labels are not EN/JA',
  );

  assert.equal(await mobilePage.locator('.hero img').count(), 0, 'Home still renders a profile image');
  const heroTopBefore = await mobilePage.locator('.hero').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await mobilePage.click('[data-nav-toggle]');
  await mobilePage.waitForTimeout(200);
  const heroTopAfter = await mobilePage.locator('.hero').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  assert.equal(heroTopAfter, heroTopBefore, 'Mobile navigation pushes page content down');
  await mobilePage.keyboard.press('Escape');
  assert.equal(await mobilePage.locator('[data-nav-toggle]').getAttribute('aria-expanded'), 'false',
    'Escape does not close mobile navigation');

  const mobileNavLabels = await mobilePage.locator('.nav-list a').allTextContents();
  assert.deepEqual(
    mobileNavLabels.map((label) => label.trim()),
    ['Posts', 'Gallery', 'Contact'],
    'Mobile navigation order does not match the primary site sections',
  );
  assert.equal(await mobilePage.locator('[data-post-row]').count(), 0,
    'Mobile Home still contains posts');
  assert.equal(await mobilePage.locator('.hero + #cv .cv-prose').count(), 1,
    'Mobile Home does not contain the CV below the profile');
  await mobilePage.close();

  const listPage = await newLocalPage({ width: 393, height: 852 });
  await listPage.goto(`${url}/posts/`, { waitUntil: 'networkidle' });
  assert.equal(
    (await listPage.locator('h1').first().textContent())?.trim().replace(/\d+$/, '').trim(),
    'Posts',
    'Japanese content route does not use the English Posts heading',
  );
  assert.match(
    (await listPage.locator('[data-post-row] time').first().textContent())?.trim() ?? '',
    /^\d{2}-\d{2}$/,
    'Grouped post date is not MM-DD',
  );
  assert.equal(await listPage.locator('.post-card').count(), 0, 'Post cards still render');
  assert.equal(await listPage.locator('[data-posts-filter]').count(), 0, 'Post filter bar still renders');
  const mobileRow = await listPage.locator('[data-post-row]').first().evaluate((row) => {
    const date = row.querySelector('time')?.getBoundingClientRect();
    const title = row.querySelector('a')?.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (!date || !title) return null;
    return {
      dateBottom: date.bottom,
      titleTop: title.top,
      dateLeft: date.left,
      titleLeft: title.left,
      rowRight: rowRect.right,
      viewportWidth: window.innerWidth,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      titleFontSize: Number.parseFloat(getComputedStyle(row.querySelector('a')).fontSize),
    };
  });
  assert.ok(mobileRow, 'Post archive row is missing at mobile width');
  assert.ok(
    mobileRow.titleTop >= mobileRow.dateBottom,
    'Mobile post date and title do not stack vertically',
  );
  assert.ok(
    Math.abs(mobileRow.dateLeft - mobileRow.titleLeft) < 1,
    'Mobile post date and title do not share the same left edge',
  );
  assert.ok(mobileRow.rowRight <= mobileRow.viewportWidth, 'Mobile post row overflows the viewport');
  assert.ok(
    mobileRow.titleFontSize > mobileRow.rootFontSize,
    'Posts page titles are not larger than the base text',
  );

  const dates = await listPage.locator('[data-post-row] time').evaluateAll((times) =>
    times.map((time) => time.getAttribute('datetime')),
  );
  assert.deepEqual(dates, [...dates].sort().reverse(), 'Posts are not newest first');
  await listPage.locator('[data-post-row] a').first().click();
  const separators = await listPage.locator('.breadcrumb-nav li').evaluateAll((items) =>
    items.map((item) => getComputedStyle(item, '::before').content),
  );
  assert.ok(
    separators.every((content) => content === 'none' || content === 'normal'),
    'Breadcrumb separators have an extra generated glyph',
  );
  assert.equal(await listPage.locator('.breadcrumb-separator').count(), 2);
  await listPage.close();

  const desktopPage = await newLocalPage({ width: 1280, height: 900 });
  await desktopPage.goto(`${url}/posts/`, { waitUntil: 'networkidle' });
  const rootPostTitles = (await desktopPage.locator('[data-post-row] a').allTextContents())
    .map((title) => title.trim());
  const desktopNavLabels = await desktopPage.locator('.nav-list a').allTextContents();
  assert.deepEqual(
    desktopNavLabels.map((label) => label.trim()),
    ['Posts', 'Gallery', 'Contact'],
    'Desktop navigation order does not match the primary site sections',
  );
  const desktopLayout = await desktopPage.locator('[data-post-row]').first().evaluate((row) => {
    const date = row.querySelector('time')?.getBoundingClientRect();
    const title = row.querySelector('a')?.getBoundingClientRect();
    if (!date || !title) return null;
    return {
      dateRight: date.right,
      titleLeft: title.left,
      alignItems: getComputedStyle(row).alignItems,
    };
  });
  assert.ok(desktopLayout, 'Post archive row is missing at desktop width');
  assert.ok(
    desktopLayout.titleLeft > desktopLayout.dateRight,
    'Desktop post date and title do not form separate columns',
  );
  assert.equal(desktopLayout.alignItems, 'baseline', 'Desktop post row is not baseline-aligned');

  const rootFooterPolicies = (await desktopPage.locator('.site-footer a').allTextContents())
    .map((label) => label.trim())
    .filter((label) => label.endsWith('Policy'));
  await desktopPage.goto(`${url}/ja/posts/`, { waitUntil: 'domcontentloaded' });
  const japanesePostTitles = (await desktopPage.locator('[data-post-row] a').allTextContents())
    .map((title) => title.trim());
  assert.deepEqual(japanesePostTitles, rootPostTitles, 'JA and EN routes do not show the same posts');
  const japaneseFooterPolicies = (await desktopPage.locator('.site-footer a').allTextContents())
    .map((label) => label.trim())
    .filter((label) => label.endsWith('Policy'));
  assert.deepEqual(
    japaneseFooterPolicies,
    rootFooterPolicies,
    'Footer policy links change order between JA and EN routes',
  );
  await desktopPage.close();

  const detailPage = await newLocalPage({ width: 1280, height: 900 });
  await detailPage.goto(`${url}/posts/dotfiles-2026-summer/`, { waitUntil: 'networkidle' });
  assert.match(
    (await detailPage.locator('.post-header > .muted').textContent())?.trim() ?? '',
    /^Published: \d{4}-\d{2}-\d{2}/,
    'Standalone post date is not English YYYY-MM-DD',
  );
  const githubCards = detailPage.locator('.link-card[href^="https://github.com/"]');
  const previews = githubCards.locator('.link-card-thumb img');
  assert.ok(await previews.count(), 'Post has no self-hosted GitHub card previews');
  for (const preview of await previews.all()) {
    assert.match(await preview.getAttribute('src') ?? '', /^\/github-og\//,
      'GitHub card still depends on an upstream preview image');
    await preview.scrollIntoViewIfNeeded();
    await preview.evaluate((image) => image.decode());
    assert.ok(await preview.evaluate((image) => image.naturalWidth > 0),
      'Self-hosted GitHub card image failed to decode');
  }

  const card = githubCards.filter({ has: detailPage.locator('.link-card-thumb img') }).first();
  const cardHref = await card.getAttribute('href');
  const cardTitle = await card.locator('.link-card-title').textContent();
  const previewUrl = new URL(await card.locator('img').getAttribute('src'), url).href;
  await detailPage.route(previewUrl, (route) => route.abort());
  await detailPage.reload({ waitUntil: 'networkidle' });
  const fallbackCard = detailPage.locator('.link-card').filter({ hasText: cardTitle });
  await fallbackCard.scrollIntoViewIfNeeded();
  await detailPage.waitForFunction((href) => {
    const link = [...document.querySelectorAll('.link-card')]
      .find((element) => element.getAttribute('href') === href);
    return link?.classList.contains('link-card--no-image');
  }, cardHref);
  assert.equal(await fallbackCard.locator('.link-card-thumb').count(), 0,
    'Failed card image leaves a blank thumbnail');
  assert.equal(await fallbackCard.getAttribute('href'), cardHref,
    'Image failure changes the card destination');
  assert.equal(await fallbackCard.locator('.link-card-title').isVisible(), true,
    'Image failure hides the card title');
  await detailPage.close();

  console.log('✓ Chromium/Firefox English UI, date, gallery, heading, navigation, post-list, and link-card checks passed');
} finally {
  await browser.close();
  await close();
}
