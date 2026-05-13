// Verification script for HomePage.astro:174 typo fix.
// Captures computed `.link-tip` color in ja/en × light/dark to ensure the
// var(--color-text) → var(--color-fg) change is visually identical.
import { chromium } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';
import { resolve } from 'node:path';

const distDir = resolve(import.meta.dirname, '../dist');
const { url, close } = await startStaticServer(distDir);
const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];
for (const path of ['/', '/en/']) {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${url}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => {
      localStorage.setItem('theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.reload({ waitUntil: 'networkidle' });
    const color = await page.evaluate(() => {
      const el = document.querySelector('.link-tip');
      return el ? window.getComputedStyle(el).color : 'NO ELEMENT';
    });
    results.push({ path, theme, color });
  }
}
await browser.close();
await close();
console.log(JSON.stringify(results, null, 2));
