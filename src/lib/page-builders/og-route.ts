import type { APIContext, APIRoute } from 'astro';
import { addOgChrome, renderFallbackOgCard, type OgChromeOptions } from '@/lib/og-image';

// astro-og-canvas's default `pathToSlug` strips everything after the last
// dot as a file extension, collapsing a slug/tag like `v2.0` or `node.js`
// down to `v2` / `node` — which diverges from the `/og/<slug>.png` URL the
// page references and 404s the card. Append `.png` to the verbatim key so
// the emitted path and the referenced URL always agree. Shared by the post
// and tag OG builders, which previously duplicated this verbatim.
export const ogPngSlug = (key: string): string => `${key}.png`;

// Wrap an OGImageRoute's GET with chrome decoration + two-tier fail-soft, so
// a font / canvaskit / jimp failure degrades the card instead of aborting
// `astro build`. The post and tag builders previously shared an identical
// inline GET wrapper; centralising it here also gives the try/catch a single
// home.
//
//   Tier 1 — base render ok, chrome (addOgChrome) throws: ship the
//     undecorated-but-valid base card (only the gradient border + credit
//     row are lost).
//   Tier 2 — base render (canvaskit) throws: ship `renderFallbackOgCard()`,
//     a gradient card built without canvaskit or Jimp.read.
//
// Never throws, never returns empty bytes. `og` is typed structurally so we
// don't depend on astro-og-canvas's exported route shape.
export function makeChromedOgGet(og: { GET: APIRoute }, chrome: OgChromeOptions): APIRoute {
  return async (ctx: APIContext) => {
    let base: Buffer;
    try {
      const res = await og.GET(ctx);
      base = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn('[og] base render failed; using fallback card:', err);
      return new Response(new Blob([await renderFallbackOgCard()], { type: 'image/png' }));
    }
    try {
      return new Response(new Blob([await addOgChrome(base, chrome)], { type: 'image/png' }));
    } catch (err) {
      console.warn('[og] chrome decoration failed; serving undecorated card:', err);
      // `new Uint8Array(base)` copies into a concrete ArrayBuffer so the raw
      // canvaskit Buffer is accepted as a BlobPart on Node 22+ (the decorated
      // path already gets this via addOgChrome's concrete-buffer return).
      return new Response(new Blob([new Uint8Array(base)], { type: 'image/png' }));
    }
  };
}
