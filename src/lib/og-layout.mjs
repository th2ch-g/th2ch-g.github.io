export class OgLayoutError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`OG layout error: ${message}`);
    this.name = 'OgLayoutError';
  }
}

/** @typedef {{left: number, top: number, right: number, bottom: number}} Bounds */
/** @typedef {{width: number, height: number, data: Uint8Array}} Bitmap */

/**
 * Measure visible pixels before layers are composited or clipped.
 * Base cards have a vertical gradient; each row's first pixel is its background.
 * @param {Bitmap} bitmap
 * @param {'transparent' | 'gradient'} background
 * @returns {Bounds | null}
 */
export function paintedBounds({ width, height, data }, background = 'transparent') {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const visible = data[i + 3] > 8 && (background === 'transparent'
        || Math.max(Math.abs(data[i] - data[row]), Math.abs(data[i + 1] - data[row + 1]),
          Math.abs(data[i + 2] - data[row + 2])) > 8);
      if (!visible) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/**
 * @param {{name: string, bounds: Bounds | null}[]} layers
 * @param {{width: number, height: number, inset: number, gap?: number}} card
 */
export function assertOgLayout(layers, { width, height, inset, gap = 12 }) {
  for (const [i, layer] of layers.entries()) {
    const a = layer.bounds;
    if (!a) continue;
    if (a.left < inset || a.top < inset || a.right > width - inset || a.bottom > height - inset) {
      throw new OgLayoutError(`${layer.name} exceeds the card's safe area (${JSON.stringify(a)}). Shorten the text or adjust the layout.`);
    }
    for (const other of layers.slice(i + 1)) {
      const b = other.bounds;
      if (b && a.left < b.right + gap && b.left < a.right + gap
        && a.top < b.bottom + gap && b.top < a.bottom + gap) {
        throw new OgLayoutError(`${layer.name} overlaps ${other.name} or leaves less than ${gap}px spacing. Shorten the text or adjust the layout.`);
      }
    }
  }
}
