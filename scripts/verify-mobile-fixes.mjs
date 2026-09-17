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

async function assertTocAnchorClearsHeader(path) {
  const page = await newLocalPage({ width: 393, height: 852 });
  await page.goto(`${url}${path}`, { waitUntil: 'networkidle' });

  const toggle = page.locator('[data-toc-toggle]');
  assert.equal(await toggle.isVisible(), true, `TOC toggle is missing on ${path}`);
  await toggle.click();
  await assertModalKeyboard(page, '[data-toc-panel]');

  const firstLink = page.locator('[data-toc-link]').first();
  const targetId = await firstLink.getAttribute('data-toc-link');
  assert.ok(targetId, `TOC has no target on ${path}`);
  await firstLink.click();
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
  assert.ok(anchorLayout, `TOC target or navbar is missing on ${path}`);
  assert.equal(
    await page.evaluate((id) => document.activeElement?.id === id, targetId),
    true,
    `TOC link leaves keyboard focus in the hidden drawer on ${path}`,
  );
  assert.ok(
    anchorLayout.headingTop > anchorLayout.headerBottom,
    `TOC target is hidden by the navbar on ${path} (${anchorLayout.headingTop}px / ${anchorLayout.headerBottom}px)`,
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
  for (const path of ['/', '/cv/']) {
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const shift = await page.evaluate(() => globalThis.__layoutShiftTotal);
    assert.ok(shift < 0.001, `Delayed fonts or controls move content on ${path} (CLS ${shift})`);
  }
  await page.close();
}

async function assertCvBibtexCopy() {
  const page = await newLocalPage({ width: 1280, height: 900 });
  await page.goto(`${url}/cv/`, { waitUntil: 'networkidle' });

  const papers = page.locator('li.cv-has-bibtex');
  assert.ok(await papers.count(), 'CV has no per-paper BibTeX menus');
  const firstPaper = papers.first();
  const trigger = firstPaper.locator('summary.cv-copy-btn');
  const opacity = Number.parseFloat(await trigger.evaluate((element) => getComputedStyle(element).opacity));
  assert.ok(opacity >= 0.65, `CV BibTeX menu is hidden before hover (opacity ${opacity})`);

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
  await assertStableFirstPaint();
  await assertTocAnchorClearsHeader('/posts/dotfiles-2026-summer/');
  await assertTocAnchorClearsHeader('/cv/');
  await assertCvBibtexCopy();
  await assertFirefoxTouchAutoplay();

  const galleryPage = await newLocalPage({ width: 393, height: 852 });
  await galleryPage.goto(`${url}/gallery/`, { waitUntil: 'networkidle' });
  assert.equal(
    await galleryPage.locator('.photo-slideshow img[src]').count(),
    1,
    'Inactive slideshow images load during initial page rendering',
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
    ['JA', 'EN'],
    'Language switcher labels are not JA/EN',
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
    ['Posts', 'CV', 'Gallery', 'Contact'],
    'Mobile navigation order does not match the primary site sections',
  );
  const homePostRows = mobilePage.locator('[data-post-row]');
  const homePostCount = await homePostRows.count();
  assert.ok(homePostCount > 0, 'Home does not show any posts');
  assert.ok(homePostCount <= 7, `Home shows more than seven posts (${homePostCount})`);
  const homePostTypography = await homePostRows.first().evaluate((row) => {
    const title = row.querySelector('a');
    const date = row.querySelector('time');
    return {
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      title: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      date: date ? Number.parseFloat(getComputedStyle(date).fontSize) : 0,
    };
  });
  assert.ok(
    homePostTypography.title > homePostTypography.root,
    'Home post titles are not larger than the base text',
  );
  assert.ok(
    homePostTypography.date > homePostTypography.root * 0.9,
    'Home post dates are not using the enlarged list treatment',
  );
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
  assert.match(
    await listPage.locator('.tags-index-link').getAttribute('href') ?? '',
    /^\/tags\/?$/,
    'JA Posts page does not link to the tags index',
  );
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
  await listPage.locator('.tags-index-link').click();
  const firstTag = listPage.locator('.tag-cloud a').first();
  const selectedTag = (await firstTag.locator('.tag-name').textContent())?.replace(/^#/, '');
  assert.ok(selectedTag, 'Tags index has no tag links');
  await firstTag.click();
  const countAlignment = await listPage.locator('.count-heading').evaluate((heading) => {
    const badge = heading.querySelector('.count-badge');
    if (!badge) return null;
    const titleRange = document.createRange();
    titleRange.selectNodeContents(heading.firstChild);
    const title = titleRange.getBoundingClientRect();
    const numberRange = document.createRange();
    numberRange.selectNodeContents(badge);
    const number = numberRange.getBoundingClientRect();
    const rect = badge.getBoundingClientRect();
    return {
      horizontalOffset: Math.abs(number.x + number.width / 2 - rect.x - rect.width / 2),
      verticalOffset: Math.abs(number.y + number.height / 2 - rect.y - rect.height / 2),
      titleOffset: Math.abs(title.y + title.height / 2 - rect.y - rect.height / 2),
    };
  });
  assert.ok(countAlignment, 'Tag count badge is missing');
  assert.ok(countAlignment.horizontalOffset < 1, 'Tag count is not horizontally centered');
  assert.ok(countAlignment.verticalOffset < 2, 'Tag count is not vertically centered');
  assert.ok(countAlignment.titleOffset < 3, 'Tag count badge is not aligned with the title');
  const taggedRows = listPage.locator('[data-post-row]');
  assert.ok(await taggedRows.count(), 'Tag page has no posts');
  assert.ok(
    (await taggedRows.evaluateAll((rows) => rows.map((row) => JSON.parse(row.dataset.tags ?? '[]'))))
      .every((tags) => tags.includes(selectedTag)),
    'Tag page includes a post outside the selected tag',
  );
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
  const jaPostTitles = (await desktopPage.locator('[data-post-row] a').allTextContents())
    .map((title) => title.trim());
  const desktopNavLabels = await desktopPage.locator('.nav-list a').allTextContents();
  assert.deepEqual(
    desktopNavLabels.map((label) => label.trim()),
    ['Posts', 'CV', 'Gallery', 'Contact'],
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

  const jaFooterPolicies = (await desktopPage.locator('.site-footer a').allTextContents())
    .map((label) => label.trim())
    .filter((label) => label.endsWith('Policy'));
  await desktopPage.goto(`${url}/en/posts/`, { waitUntil: 'networkidle' });
  assert.match(
    await desktopPage.locator('.tags-index-link').getAttribute('href') ?? '',
    /^\/en\/tags\/?$/,
    'EN Posts page does not link to the tags index',
  );
  const enPostTitles = (await desktopPage.locator('[data-post-row] a').allTextContents())
    .map((title) => title.trim());
  assert.deepEqual(enPostTitles, jaPostTitles, 'JA and EN routes do not show the same posts');
  const enFooterPolicies = (await desktopPage.locator('.site-footer a').allTextContents())
    .map((label) => label.trim())
    .filter((label) => label.endsWith('Policy'));
  assert.deepEqual(
    enFooterPolicies,
    jaFooterPolicies,
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
  await detailPage.close();

  console.log('✓ Chromium/Firefox English UI, date, gallery, TOC, navigation, and post-list checks passed');
} finally {
  await browser.close();
  await close();
}
