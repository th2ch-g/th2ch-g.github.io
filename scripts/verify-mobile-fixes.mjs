// Verify two mobile fixes:
//   1. Avatar `.link-tip` no longer overflows the viewport on small screens
//   2. Opening the hamburger menu does NOT push the page content down
import { chromium } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';
import { resolve } from 'node:path';

const distDir = resolve(import.meta.dirname, '../dist');
const { url, close } = await startStaticServer(distDir);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });

await page.goto(`${url}/`, { waitUntil: 'networkidle' });

// 1. Avatar tooltip clipping check
await page.locator('.avatar-wrap').first().hover();
await page.waitForTimeout(200);
const tipRect = await page.evaluate(() => {
  const tip = document.querySelector('.avatar-wrap .link-tip');
  if (!tip) return null;
  const r = tip.getBoundingClientRect();
  return { left: r.left, right: r.right, viewportWidth: window.innerWidth, opacity: getComputedStyle(tip).opacity };
});
console.log('avatar tooltip:', JSON.stringify(tipRect));
const tipFits = tipRect && tipRect.left >= 0 && tipRect.right <= tipRect.viewportWidth;
console.log(tipFits ? '✓ avatar tooltip fits within viewport' : '✗ avatar tooltip overflows!');

// 1b. SNS link tooltips - check each one
const linkCount = await page.locator('.links .link-item').count();
let allLinksFit = true;
for (let i = 0; i < linkCount; i++) {
  const item = page.locator('.links .link-item').nth(i);
  await item.hover();
  await page.waitForTimeout(150);
  const linkTip = await page.evaluate((idx) => {
    const items = document.querySelectorAll('.links .link-item');
    const tip = items[idx]?.querySelector('.link-tip');
    if (!tip) return { skipped: true };
    const r = tip.getBoundingClientRect();
    return { left: r.left, right: r.right, viewportWidth: window.innerWidth, opacity: getComputedStyle(tip).opacity, text: tip.textContent };
  }, i);
  if (linkTip.skipped) {
    console.log(`link[${i}]: no tooltip`);
    continue;
  }
  const fits = linkTip.left >= 0 && linkTip.right <= linkTip.viewportWidth;
  console.log(`link[${i}] "${linkTip.text}": left=${linkTip.left.toFixed(1)}, right=${linkTip.right.toFixed(1)} ${fits ? '✓' : '✗ OVERFLOWS'}`);
  if (!fits) allLinksFit = false;
}
console.log(allLinksFit ? '✓ ALL SNS link tooltips fit within viewport' : '✗ some SNS link tooltips overflow');
// Move pointer away to release any hover state before next test.
await page.mouse.move(0, 0);
await page.waitForTimeout(100);

// 2. Hamburger overlay vs push-down check
const heroTopBefore = await page.evaluate(() => {
  const h = document.querySelector('.hero');
  return h ? h.getBoundingClientRect().top : null;
});
await page.click('[data-nav-toggle]');
await page.waitForTimeout(200);
const heroTopAfter = await page.evaluate(() => {
  const h = document.querySelector('.hero');
  return h ? h.getBoundingClientRect().top : null;
});
const navOverlaysHero = await page.evaluate(() => {
  const nav = document.querySelector('nav[data-nav]');
  const hero = document.querySelector('.hero');
  if (!nav || !hero) return null;
  const navRect = nav.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  return {
    navBottom: navRect.bottom,
    heroTop: heroRect.top,
    overlap: navRect.bottom > heroRect.top,
    navPosition: getComputedStyle(nav).position,
  };
});
console.log(`hero top before: ${heroTopBefore}, after: ${heroTopAfter}`);
console.log('nav overlay info:', JSON.stringify(navOverlaysHero));
const heroStable = heroTopBefore === heroTopAfter;
console.log(heroStable ? '✓ hero did NOT shift when menu opened' : '✗ hero shifted (menu pushed content down)');

await browser.close();
await close();
