import assert from 'node:assert/strict';
import { assertOgLayout, OgLayoutError, paintedBounds } from '../src/lib/og-layout.mjs';

const gradient = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
for (let y = 0; y < gradient.height; y++) {
  for (let x = 0; x < gradient.width; x++) {
    gradient.data.set([240 - y, 245 - y, 250 - y, 255], (y * gradient.width + x) * 4);
  }
}
assert.equal(paintedBounds(gradient, 'gradient'), null);
gradient.data.set([15, 23, 42, 255], (7 * gradient.width + 5) * 4);
assert.deepEqual(paintedBounds(gradient, 'gradient'), { left: 5, top: 7, right: 6, bottom: 8 });

const transparent = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
assert.equal(paintedBounds(transparent), null);
transparent.data.set([15, 23, 42, 255], (4 * transparent.width + 3) * 4);
assert.deepEqual(paintedBounds(transparent), { left: 3, top: 4, right: 4, bottom: 5 });

const card = { width: 1200, height: 630, inset: 56 };
const body = { name: 'title/description', bounds: { left: 140, top: 140, right: 920, bottom: 430 } };
const icon = { name: 'credit icon', bounds: { left: 140, top: 474, right: 220, bottom: 554 } };
const name = { name: 'profile name', bounds: { left: 240, top: 482, right: 680, bottom: 532 } };
assert.doesNotThrow(() => assertOgLayout([body, icon, name], card));
assert.throws(() => assertOgLayout([{ ...body, bounds: { ...body.bounds, bottom: 486 } }, icon, name], card),
  (error) => error instanceof OgLayoutError && /title\/description overlaps credit icon/.test(error.message));
assert.throws(() => assertOgLayout([body, icon, { ...name, bounds: { ...name.bounds, left: 210 } }], card), /overlaps/);
assert.throws(() => assertOgLayout([{ ...name, bounds: { ...name.bounds, right: 1180 } }], card), /safe area/);
assert.throws(() => assertOgLayout([{ ...body, bounds: { ...body.bounds, bottom: 630 } }], card), /safe area/);
assert.doesNotThrow(() => assertOgLayout([{ ...body, bounds: { ...body.bounds, bottom: 462 } }, icon], card));
assert.throws(() => assertOgLayout([{ ...body, bounds: { ...body.bounds, bottom: 463 } }, icon], card), /12px/);
console.log('[og] Painted bounds, overlap, spacing, and clipping checks passed.');
