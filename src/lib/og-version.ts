import { createHash } from 'node:crypto';
import configSource from './og-config.ts?raw';
import rendererSource from './og-image.ts?raw';
import postSource from './page-builders/og-post.ts?raw';
import fontSource from '../../scripts/build-fonts.mjs?raw';

// Give social crawlers a new image URL whenever the renderer or font setup
// changes. Stable source hashes keep URLs identical across unchanged builds.
const revision = createHash('sha256')
  .update([configSource, rendererSource, postSource, fontSource].join('\n'))
  .digest('hex')
  .slice(0, 12);

export function versionOgImage(url: URL): string {
  if (/^\/(?:ja\/)?og\/.+\.png$/.test(url.pathname)) {
    url.searchParams.set('v', revision);
  }
  return url.toString();
}
