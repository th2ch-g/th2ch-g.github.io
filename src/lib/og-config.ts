import { generateOpenGraphImage } from 'astro-og-canvas';
import { getProfileMeta } from '@/lib/content';
import { addOgChrome } from './og-image';
import type { Lang } from '@/i18n/ui';

// Shared visual config for OG card generation. Extracted so that the four
// route files (post / tag x ja / en) stay in sync — color shifts, padding
// tweaks, and font additions ripple from here. The explicit `[r, g, b][]`
// type keeps the constants mutable-compatible so `astro-og-canvas`'s
// `RGBColor[]` parameter type accepts them as-is.
export type RGB = [number, number, number];

// Light card surface (slate-50 → slate-200) with near-black title text
// and slate-600 description, mirroring the Zenn link-card vibe.
export const OG_BG_GRADIENT: RGB[] = [
  [248, 250, 252],
  [226, 232, 240],
];
export const OG_TITLE_COLOR: RGB = [15, 23, 42];
// Description shares the title's near-black color; differentiation comes
// from font size only. slate-700 felt washed out on hero-backed cards;
// slate-900 reads as clean black on the light gradient.
export const OG_DESC_COLOR: RGB = [15, 23, 42];

// Colors used to outline the link card perimeter as a horizontal
// gradient (Zenn-style). The left edge is fully green, the right edge
// fully blue, and the top/bottom edges interpolate left-to-right. We
// draw all four sides ourselves in `addOgChrome` (see og-image.ts)
// because astro-og-canvas's `border` API only paints a single side and
// has no gradient option.
export const OG_BORDER_COLOR_LEFT: RGB = [74, 222, 128];
export const OG_BORDER_COLOR_RIGHT: RGB = [121, 184, 255];
export const OG_BORDER_WIDTH = 24;

// Local TTF copies maintained by `scripts/build-fonts.mjs`. Both Regular
// and Bold are loaded so that `font: { title: { weight: 'Bold' } }` resolves
// to a real bold glyph set rather than synthesized faux-bold over Regular.
// Noto Color Emoji is appended last so that astro-og-canvas's font-stack
// fallback only consults it for codepoints that the CJK + Latin fonts
// can't handle (regional-indicator flag pairs, pictographs, etc.).
// Paths are relative to the repo root because that's the cwd Astro uses
// when invoking image-route handlers.
export const OG_FONTS = [
  './public/fonts/ZenMaruGothic-Regular.ttf',
  './public/fonts/ZenMaruGothic-Bold.ttf',
  './public/fonts/NotoSansJP-Regular.ttf',
  './public/fonts/NotoSansJP-Bold.ttf',
  './public/fonts/NotoColorEmoji.ttf',
];

// Family names that match what `canvaskit-wasm` reads from the loaded
// TTFs' `name` tables. The list is the runtime font stack: glyphs are
// looked up in the first family and missing codepoints fall through to
// the next. Without this, astro-og-canvas defaults to `['Noto Sans']`,
// which silently won't pick up Noto Color Emoji even after we load it
// via `OG_FONTS` — the families array is what gates which loaded font
// is consulted, not the raw fonts list. Zen Maru Gothic is the friendly
// rounded display face (free Hiragino-Maru-style stand-in); Noto Sans
// JP catches glyphs Zen Maru doesn't ship.
export const OG_FONT_FAMILIES = ['Zen Maru Gothic', 'Noto Sans JP', 'Noto Color Emoji'];

// Vertical padding inside the card body. Larger value pushes the title
// further from the top edge — astro-og-canvas pins the paragraph at
// `padding` when no logo is present, so this is the only knob for
// title vertical position. 140 lands the title at ~22% from the top,
// leaving room above for visual breathing space and below for the
// description + bottom-row chrome.
export const OG_PADDING = 140;

// The OUTER edge of the card stays rectangular (matches the canvas
// perimeter) so SNS viewers' alpha handling is irrelevant. The INNER
// edge of the gradient border ring, however, is rounded — producing a
// "rectangular frame, rounded inner window" look that adds polish
// without forcing alpha=0 corners. Set to 0 to fully square the border.
export const OG_INNER_CORNER_RADIUS = 40;

// Inner shadow on the border that fakes a "floating" body — the
// gradient ring darkens just outside the inner rounded rect, fading
// linearly with distance, as if the body content is raised above the
// frame and casting a shadow on it. Width 14 covers the inner ~half
// of the 24px border; intensity 0.35 = up to 35% darkening at the
// edge. Set INTENSITY to 0 to disable the effect.
export const OG_INNER_SHADOW_WIDTH = 14;
export const OG_INNER_SHADOW_INTENSITY = 0.35;

// Pass-through normaliser for OG strings. Previously this stripped emoji
// because the font stack lacked emoji coverage; now Noto Color Emoji is
// loaded so we keep emoji as-is and only collapse runs of whitespace.
// Kept as a single helper so all OG routes funnel through one entry point
// if future sanitisation is needed.
export function stripForOg(s: string): string {
  return s.replace(/\s{2,}/g, ' ').trim();
}

// One-shot helper for the "section" OG cards (Home / Works / Gallery /
// CV / Posts ...). They all share the same composition — title only,
// section label bottom-left, profile credit bottom-right, gradient
// border — so the actual route file is a one-liner that just picks the
// label and locale.
export interface SectionOgInput {
  lang: Lang;
  title: string;
  description?: string;
  pageLabel: string;
}

export async function renderSectionOg(input: SectionOgInput): Promise<Response> {
  const meta = await getProfileMeta(input.lang);
  const png = await generateOpenGraphImage({
    title: stripForOg(input.title),
    description: stripForOg(input.description ?? ''),
    bgGradient: OG_BG_GRADIENT,
    padding: OG_PADDING,
    font: {
      title: { color: OG_TITLE_COLOR, size: 96, weight: 'Bold', families: OG_FONT_FAMILIES },
      description: { color: OG_DESC_COLOR, size: 32, weight: 'Bold', lineHeight: 1.4, families: OG_FONT_FAMILIES },
    },
    fonts: OG_FONTS,
  });
  const decorated = await addOgChrome(png as Buffer, {
    name: meta.name,
    // `meta.icon` reflects profile.yaml's `icon.url`. When it's empty,
    // scripts/build-icon.mjs skips writing public/icon.png, so we must
    // omit `iconPath` here too — `addOgChrome` then collapses the credit
    // row to "name only" instead of failing on a missing file.
    iconPath: meta.icon ? './public/icon.png' : undefined,
    pageLabel: input.pageLabel,
  });
  return new Response(new Blob([decorated], { type: 'image/png' }));
}

// Description suffix for tag OG cards. Keeps the locale-specific phrasing
// out of the route file so the route bodies are pure logic.
export function describeTagCounts(lang: Lang, postCount: number): string {
  return lang === 'ja' ? `${postCount} 記事` : `${postCount} posts`;
}
