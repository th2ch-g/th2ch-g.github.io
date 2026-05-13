// Remark plugin: implicit-figure rule. A paragraph that contains exactly
// one image with non-empty alt text is promoted to:
//
//   <figure><img alt="..."><figcaption>...</figcaption></figure>
//
// Same convention as Pandoc / Zenn / Hugo. The image's `alt` attribute
// is preserved on the <img> AND duplicated as the figcaption text — alt
// is the screen-reader hook, figcaption is the visible caption. They
// serve different a11y roles so duplication is the documented pattern.
//
// Promotion is done via `node.data.hName` (same trick as remark-callouts)
// rather than emitting raw HTML, so Astro's `astro:assets` body-image
// resolver still rewrites `./relative.png` URLs on the inner image node.
import { visit } from 'unist-util-visit';

export function remarkFigureCaption() {
  return (tree) => {
    visit(tree, 'paragraph', (node) => {
      // Only meaningful (non-whitespace) children count.
      const meaningful = node.children.filter(
        (c) => !(c.type === 'text' && /^\s*$/.test(c.value)),
      );
      if (meaningful.length !== 1) return;
      const img = meaningful[0];
      if (img.type !== 'image') return;
      const alt = (img.alt ?? '').trim();
      if (!alt) return; // empty alt = decorative; leave as inline image

      // Promote paragraph -> figure.
      node.data = node.data ?? {};
      node.data.hName = 'figure';
      node.data.hProperties = { className: ['md-figure'] };

      // Append a figcaption sibling. Use a paragraph mdast node with
      // hName=figcaption so mdast-util-to-hast forwards the children
      // through the standard text-rendering path (escaping etc.). Drop
      // the surrounding whitespace text nodes.
      const caption = {
        type: 'paragraph',
        data: {
          hName: 'figcaption',
          hProperties: { className: ['md-figcaption'] },
        },
        children: [{ type: 'text', value: alt }],
      };
      node.children = [img, caption];
    });
  };
}
