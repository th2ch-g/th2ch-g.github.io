import { parse } from 'parse5';
import { parsePublicHttpUrl } from './public-http.mjs';

export const MAX_META_BYTES = 256 * 1024;

export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);|&([a-z]+);/gi, (match, numeric, name) => {
    if (name) return Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match;
    const value = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
    return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
  });
}

export function parseMeta(html, pageUrl) {
  if (Buffer.byteLength(html, 'utf8') > MAX_META_BYTES) {
    throw new Error('Link metadata exceeds the HTML input limit');
  }
  const document = parse(html);
  const root = document.childNodes.find((node) => node.tagName === 'html');
  const head = root?.childNodes.find((node) => node.tagName === 'head');
  const map = new Map();
  let titleTag = '';
  for (const node of head?.childNodes ?? []) {
    if (node.tagName === 'meta') {
      const attrs = new Map(node.attrs.map(({ name, value }) => [name, value]));
      const key = attrs.get('property') ?? attrs.get('name');
      const value = attrs.get('content');
      if (key && value !== undefined && !map.has(key.toLowerCase())) {
        map.set(key.toLowerCase(), value.trim());
      }
    } else if (node.tagName === 'title' && !titleTag) {
      titleTag = node.childNodes.map((child) => child.value ?? '').join('').trim();
    }
  }

  const title = map.get('og:title') ?? map.get('twitter:title') ?? titleTag;
  const description = map.get('og:description') ?? map.get('twitter:description') ?? map.get('description') ?? '';
  const imageRaw = map.get('og:image') ?? map.get('og:image:url') ?? map.get('og:image:secure_url')
    ?? map.get('twitter:image') ?? map.get('twitter:image:src') ?? '';
  let image = '';
  if (imageRaw) {
    try {
      image = parsePublicHttpUrl(new URL(imageRaw, pageUrl).toString()).toString();
    } catch {
      // Invalid or private destinations leave a text-only card.
    }
  }
  return { title, description, image, siteName: map.get('og:site_name') ?? '' };
}
