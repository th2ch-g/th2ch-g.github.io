import { promises as fsp } from 'node:fs';
import { Jimp } from 'jimp';
import CanvasKitInit from 'canvaskit-wasm';
import {
  OG_BG_GRADIENT,
  OG_FONTS,
  OG_FONT_FAMILIES,
  OG_TITLE_COLOR,
  OG_PADDING,
  OG_BORDER_COLOR_LEFT,
  OG_BORDER_COLOR_RIGHT,
  OG_BORDER_WIDTH,
  OG_INNER_CORNER_RADIUS,
  OG_INNER_SHADOW_WIDTH,
  OG_INNER_SHADOW_INTENSITY,
  type RGB,
} from './og-config';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Post-process step: paint the bottom-right credit (profile icon + name,
// Zenn-style) and then stroke a gradient outline around the perimeter.
// astro-og-canvas exposes only a single-side `border` option and no way
// to inject extra elements at custom positions, so both pieces of chrome
// are added here by manipulating the bitmap directly.
//
// Order matters: credit first, gradient border on top. The border path
// only touches the OG_BORDER_WIDTH outermost pixels on each side, which
// stays clear of the credit's footprint at the chosen padding. Drawing
// the border last means stray icon/text antialiased edges that fall over
// the perimeter (e.g. if the card's 1200x630 ever shrinks) get cleanly
// overdrawn rather than peeking out.
//
// Returns `Uint8Array<ArrayBuffer>` (the concrete-buffer variant) so the
// result drops cleanly into `new Response(...)` / `new Blob([...])`.
// Without the explicit generic, Node 22+ types resolve the buffer to
// `ArrayBufferLike` which DOM body types reject.
export interface OgChromeOptions {
  /** Display name shown after the credit avatar in the bottom-left row. */
  name: string;
  /**
   * Filesystem path to the profile icon (already circle-masked).
   * Omit / undefined when profile.yaml has no `icon.url` — the credit row
   * is then rendered without the avatar, anchored from the same left edge.
   */
  iconPath?: string;
  /** Optional section label rendered between the avatar and the name in the bottom-left row (Home / CV / Works / etc.). */
  pageLabel?: string;
}

const CREDIT_ICON_SIZE = 80;
const CREDIT_FONT_HEIGHT = 64;
const CREDIT_GAP = 18;
// Keep the chrome row a stable distance inside the colored frame when the
// border thickness changes.
const CHROME_BOTTOM = OG_BORDER_WIDTH + 36;
// Optical-centering nudge for credit-row text. canvaskit's paragraph
// bitmap height = ascent + descent + leading, so glyph cap-heights sit
// in the upper ~40% of the bitmap. Centering the bitmap mathematically
// against the round icon makes text look "sunken" by ~8–10px. Pull text
// up by this much so the cap-height midpoint aligns with the icon's
// geometric center. Only applied to text composites, not the icon.
const CREDIT_TEXT_OPTICAL_NUDGE = 10;

export async function addOgChrome(
  input: Uint8Array | Buffer,
  opts: OgChromeOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const img = await Jimp.read(Buffer.from(input));
  const { width, height } = img.bitmap;

  // --- 1) Bottom-left unified credit row: [icon] [label] | [name] ---
  // All elements left-anchored to `OG_PADDING`, vertically centered
  // against the icon's 80px height (or text height when iconPath is
  // omitted — profile.yaml may leave `icon.url` empty). Text rendered via
  // canvaskit-wasm so credit and label share the title's Zen Maru Bold
  // face. Pipe separator only drawn when a pageLabel is present.
  const PIPE_GAP = 16;
  const icon = opts.iconPath ? await Jimp.read(opts.iconPath) : undefined;
  icon?.resize({ w: CREDIT_ICON_SIZE, h: CREDIT_ICON_SIZE });

  // Chrome row uses Bold to match the title's weight — same family,
  // same Bold cut, just a smaller size for hierarchy.
  const nameImg = await Jimp.read(
    await renderText(opts.name, CREDIT_FONT_HEIGHT, 'Bold', OG_TITLE_COLOR),
  );
  const labelImg = opts.pageLabel
    ? await Jimp.read(await renderText(opts.pageLabel, CREDIT_FONT_HEIGHT, 'Bold', OG_TITLE_COLOR))
    : undefined;
  const pipeImg = opts.pageLabel
    ? await Jimp.read(await renderText('|', CREDIT_FONT_HEIGHT, 'Bold', OG_TITLE_COLOR))
    : undefined;

  const rowLeft = OG_PADDING;
  // Row height collapses to the text height when there is no avatar, so
  // the bottom of the chrome row stays at the same canvas offset whether
  // an icon is present or not.
  const rowHeight = icon ? CREDIT_ICON_SIZE : CREDIT_FONT_HEIGHT;
  const rowTop = height - CHROME_BOTTOM - rowHeight;
  // `vCenter` aligns text against the row's geometric middle, then lifts
  // it by `CREDIT_TEXT_OPTICAL_NUDGE` so the cap-height midpoint (not the
  // bitmap midpoint) sits on the icon's centerline.
  const vCenter = (h: number) =>
    rowTop + Math.round((rowHeight - h) / 2) - CREDIT_TEXT_OPTICAL_NUDGE;

  let xCursor = rowLeft;
  if (icon) {
    img.composite(icon, xCursor, rowTop);
    xCursor += CREDIT_ICON_SIZE + CREDIT_GAP;
  }
  if (labelImg) {
    img.composite(labelImg, xCursor, vCenter(labelImg.bitmap.height));
    xCursor += labelImg.bitmap.width + PIPE_GAP;
  }
  if (pipeImg) {
    img.composite(pipeImg, xCursor, vCenter(pipeImg.bitmap.height));
    xCursor += pipeImg.bitmap.width + PIPE_GAP;
  }
  img.composite(nameImg, xCursor, vCenter(nameImg.bitmap.height));

  // --- 2) Gradient border: rectangular outer, rounded inner ---
  // Fills every pixel that's outside the inner rounded rect (inset by
  // OG_BORDER_WIDTH from canvas, with corners radius
  // OG_INNER_CORNER_RADIUS) but still inside the canvas. Result: the
  // outer edge is the canvas perimeter (rectangular, no alpha cut) and
  // the inner edge curves at each corner.
  const data = img.bitmap.data;
  const [r1, g1, b1] = OG_BORDER_COLOR_LEFT;
  const [r2, g2, b2] = OG_BORDER_COLOR_RIGHT;
  const colR = new Uint8Array(width);
  const colG = new Uint8Array(width);
  const colB = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    const t = width <= 1 ? 0 : x / (width - 1);
    colR[x] = Math.round(r1 + (r2 - r1) * t);
    colG[x] = Math.round(g1 + (g2 - g1) * t);
    colB[x] = Math.round(b1 + (b2 - b1) * t);
  }

  const cxCanvas = width / 2;
  const cyCanvas = height / 2;
  const hwInner = width / 2 - OG_BORDER_WIDTH;
  const hhInner = height / 2 - OG_BORDER_WIDTH;
  const rInner = OG_INNER_CORNER_RADIUS;
  const sdfInner = (px: number, py: number) => {
    const qx = Math.abs(px - cxCanvas) - hwInner + rInner;
    const qy = Math.abs(py - cyCanvas) - hhInner + rInner;
    const inside = Math.min(Math.max(qx, qy), 0);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return inside + outside - rInner;
  };

  // Band must cover the full border thickness AND the inner-corner arc
  // sweep, which extends rInner pixels deeper than the straight edges.
  const bandExtent = OG_BORDER_WIDTH + rInner + 1;
  for (let y = 0; y < height; y++) {
    const inBandY = y < bandExtent || y >= height - bandExtent;
    for (let x = 0; x < width; x++) {
      const inBandX = x < bandExtent || x >= width - bandExtent;
      if (!inBandY && !inBandX) continue;

      const s = sdfInner(x + 0.5, y + 0.5);
      // s > 0: outside inner rect → in border ring
      // s in (-0.5, 0.5): AA edge
      // s < -0.5: inside body, skip
      let ringWeight = 0;
      if (s > 0.5) ringWeight = 1;
      else if (s > -0.5) ringWeight = 0.5 + s;
      if (ringWeight <= 0) continue;

      const idx = (y * width + x) * 4;
      if (ringWeight >= 1) {
        data[idx] = colR[x];
        data[idx + 1] = colG[x];
        data[idx + 2] = colB[x];
      } else {
        const oneMinus = 1 - ringWeight;
        data[idx]     = Math.round(data[idx]     * oneMinus + colR[x] * ringWeight);
        data[idx + 1] = Math.round(data[idx + 1] * oneMinus + colG[x] * ringWeight);
        data[idx + 2] = Math.round(data[idx + 2] * oneMinus + colB[x] * ringWeight);
      }
      data[idx + 3] = 0xff;

      // Inner shadow: darken the border just outside the body's inner
      // rounded rect, fading linearly with distance. Combined with the
      // gradient ring above, this produces the impression that the
      // body is floating above the frame.
      if (OG_INNER_SHADOW_INTENSITY > 0 && s > 0 && s < OG_INNER_SHADOW_WIDTH) {
        const fade = 1 - s / OG_INNER_SHADOW_WIDTH;
        const factor = 1 - fade * OG_INNER_SHADOW_INTENSITY;
        data[idx]     = Math.round(data[idx]     * factor);
        data[idx + 1] = Math.round(data[idx + 1] * factor);
        data[idx + 2] = Math.round(data[idx + 2] * factor);
      }
    }
  }

  const out = await img.getBuffer('image/png');
  // Build a Uint8Array backed by a concrete ArrayBuffer (not the
  // ArrayBufferLike that Node's Buffer types resolve to), so the result
  // is accepted as a BlobPart / Response body without TS friction.
  const ab = new ArrayBuffer(out.byteLength);
  const copy = new Uint8Array(ab);
  copy.set(out);
  return copy;
}

// CanvasKit + FontMgr singletons. We use canvaskit-wasm directly (rather
// than jimp's BMFont print) for the bottom-row credit and section label
// because jimp ships only Open Sans Regular bitmap fonts; rendering via
// canvaskit lets us reuse the same Zen Kaku Gothic Bold face that
// astro-og-canvas uses for the title, so all card text shares one
// consistent typography.
let _canvasKit: Awaited<ReturnType<typeof CanvasKitInit>> | undefined;
let _ogFontMgr: ReturnType<NonNullable<typeof _canvasKit>['FontMgr']['FromData']> | undefined;
async function getOgCanvasKit() {
  if (!_canvasKit) _canvasKit = await CanvasKitInit({});
  return _canvasKit;
}
async function getOgFontMgr() {
  if (_ogFontMgr) return _ogFontMgr;
  const CK = await getOgCanvasKit();
  const fontBuffers = await Promise.all(
    OG_FONTS.map(async (p) => {
      const buf = await fsp.readFile(p);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }),
  );
  const mgr = CK.FontMgr.FromData(...fontBuffers);
  if (!mgr) throw new Error('canvaskit FontMgr.FromData returned null');
  _ogFontMgr = mgr;
  return _ogFontMgr;
}

// Render a single line of text via canvaskit-wasm and return PNG bytes
// of a transparent canvas sized to fit. Used for credit + label so they
// pick up the proper Zen Kaku Gothic Bold weight (jimp's BMFont can't).
async function renderText(
  text: string,
  fontSize: number,
  weight: 'Bold' | 'Normal',
  color: RGB,
  italic = false,
): Promise<Buffer> {
  const CK = await getOgCanvasKit();
  const fontMgr = await getOgFontMgr();
  const textStyle = {
    color: CK.Color(color[0], color[1], color[2], 1),
    fontFamilies: OG_FONT_FAMILIES,
    fontSize,
    fontStyle: {
      weight: CK.FontWeight[weight],
      // Zen Maru Gothic doesn't ship an italic cut, so canvaskit
      // synthesizes oblique by skewing — fine for Latin labels (Home /
      // Posts / Tags) which are the only callers that pass italic=true.
      slant: italic ? CK.FontSlant.Italic : CK.FontSlant.Upright,
    },
  };

  // First pass: lay out at unrestricted width to measure the line.
  const measureBuilder = CK.ParagraphBuilder.Make(
    new CK.ParagraphStyle({ textStyle }),
    fontMgr,
  );
  measureBuilder.addText(text);
  const measurePara = measureBuilder.build();
  measurePara.layout(4096);
  const textWidth = Math.max(1, Math.ceil(measurePara.getLongestLine()));
  const textHeight = Math.max(1, Math.ceil(measurePara.getHeight()));
  measurePara.delete();
  measureBuilder.delete();

  // Second pass: render into a tight canvas. A few pixels of padding
  // protects against descenders / Italic-style overhang.
  const PAD = 4;
  const surface = CK.MakeSurface(textWidth + PAD * 2, textHeight + PAD * 2);
  if (!surface) throw new Error('canvaskit MakeSurface failed');
  const canvas = surface.getCanvas();
  canvas.clear(CK.Color(0, 0, 0, 0));

  const renderBuilder = CK.ParagraphBuilder.Make(
    new CK.ParagraphStyle({ textStyle }),
    fontMgr,
  );
  renderBuilder.addText(text);
  const para = renderBuilder.build();
  para.layout(textWidth);
  canvas.drawParagraph(para, PAD, PAD);

  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes(CK.ImageFormat.PNG, 100);
  para.delete();
  renderBuilder.delete();
  surface.delete();
  if (!bytes) throw new Error('canvaskit encodeToBytes returned null');
  return Buffer.from(bytes);
}

// Guaranteed-safe OG fallback card: a 1200x630 vertical gradient built
// with jimp construction only. It touches neither canvaskit nor
// `Jimp.read`, so it survives every failure mode that breaks the real
// cards (FontMgr.FromData / MakeSurface / encodeToBytes in renderText, and
// the icon/name `Jimp.read` decode steps in addOgChrome). The OG
// route handlers fall back to this instead of aborting `astro build` —
// extending the CV-PDF "fail soft" guarantee to image endpoints. It is
// identity-free (no name / icon / text) so it stays forkable and needs no
// profile.yaml read. Computed once and cached for the whole build.
let _fallbackCard: Uint8Array<ArrayBuffer> | undefined;
export async function renderFallbackOgCard(): Promise<Uint8Array<ArrayBuffer>> {
  if (_fallbackCard) return _fallbackCard;
  const img = new Jimp({ width: OG_WIDTH, height: OG_HEIGHT, color: 0xffffffff });
  const [r1, g1, b1] = OG_BG_GRADIENT[0];
  const [r2, g2, b2] = OG_BG_GRADIENT[OG_BG_GRADIENT.length - 1];
  const data = img.bitmap.data;
  for (let y = 0; y < OG_HEIGHT; y++) {
    const t = OG_HEIGHT <= 1 ? 0 : y / (OG_HEIGHT - 1);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    for (let x = 0; x < OG_WIDTH; x++) {
      const idx = (y * OG_WIDTH + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 0xff;
    }
  }
  const out = await img.getBuffer('image/png');
  // Concrete-ArrayBuffer copy (same dance as addOgChrome) so the result is
  // accepted as a BlobPart / Response body without TS friction on Node 22+.
  const ab = new ArrayBuffer(out.byteLength);
  _fallbackCard = new Uint8Array(ab);
  _fallbackCard.set(out);
  return _fallbackCard;
}
