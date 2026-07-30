import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
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
  assert.ok(
    anchorLayout.headingTop > anchorLayout.headerBottom,
    `TOC target is hidden by the navbar on ${path} (${anchorLayout.headingTop}px / ${anchorLayout.headerBottom}px)`,
  );
  await page.close();
}

try {
  await assertTocAnchorClearsHeader('/posts/dotfiles-2026-summer/');
  await assertTocAnchorClearsHeader('/cv/');

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

  await mobilePage.locator('.avatar-wrap').first().hover();
  await mobilePage.waitForTimeout(200);
  const tipRect = await mobilePage.locator('.avatar-tip').evaluate((tip) => {
    const rect = tip.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      opacity: getComputedStyle(tip).opacity,
    };
  });
  assert.ok(tipRect.left >= 0, 'Avatar tooltip overflows the left viewport edge');
  assert.ok(
    tipRect.right <= tipRect.viewportWidth,
    'Avatar tooltip overflows the right viewport edge',
  );
  assert.equal(tipRect.opacity, '1', 'Avatar tooltip is not visible on hover');

  await mobilePage.mouse.move(0, 0);
  const heroTopBefore = await mobilePage.locator('.hero').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await mobilePage.click('[data-nav-toggle]');
  await mobilePage.waitForTimeout(200);
  const heroTopAfter = await mobilePage.locator('.hero').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  assert.equal(heroTopAfter, heroTopBefore, 'Mobile navigation pushes page content down');
  await mobilePage.close();

  const cardPage = await newLocalPage({ width: 696, height: 900 });
  await cardPage.goto(`${url}/posts/`, { waitUntil: 'networkidle' });
  const mobileCards = await cardPage.evaluate(() => {
    const grid = document.querySelector('.post-grid');
    const card = grid?.querySelector('.post-card');
    if (!grid || !card) return null;
    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return { gridWidth: gridRect.width, cardWidth: cardRect.width };
  });
  assert.ok(mobileCards, 'Post grid or card is missing at mobile width');
  assert.ok(
    Math.abs(mobileCards.cardWidth - mobileCards.gridWidth) < 1,
    `Mobile card does not fill its grid (${mobileCards.cardWidth}px / ${mobileCards.gridWidth}px)`,
  );
  await cardPage.screenshot({ path: '/tmp/th2ch-mobile-posts.png', fullPage: true });
  await cardPage.close();

  const desktopPage = await newLocalPage({ width: 1280, height: 900 });
  await desktopPage.goto(`${url}/posts/`, { waitUntil: 'networkidle' });
  const desktopLayout = await desktopPage.locator('.post-card').evaluateAll((cards) => {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      expectedCardWidth: 19.5 * rootFontSize,
      cards: cards.slice(0, 2).map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      }),
    };
  });
  assert.equal(desktopLayout.cards.length, 2, 'Expected at least two desktop post cards');
  assert.ok(
    Math.abs(desktopLayout.cards[0].width - desktopLayout.expectedCardWidth) < 1,
    `Desktop card width changed (${desktopLayout.cards[0].width}px)`,
  );
  assert.ok(
    desktopLayout.cards[1].left > desktopLayout.cards[0].left,
    'Desktop post cards do not form multiple columns',
  );
  await desktopPage.close();

  console.log('✓ mobile TOC, tooltip, navigation, and post-card layout checks passed');
} finally {
  await browser.close();
  await close();
}
