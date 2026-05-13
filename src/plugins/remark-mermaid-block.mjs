import { visit } from 'unist-util-visit';
import { escapeHtml } from './lib/escape.mjs';
import { replaceWithHtml } from './lib/replace.mjs';

// Convert ```mermaid fenced code blocks into a raw `<pre class="mermaid">`
// HTML node BEFORE Shiki sees them, so Shiki doesn't try to syntax-highlight
// the diagram source. The actual rendering happens client-side via the
// Mermaid library, lazy-loaded only on pages that contain such a block.

export function remarkMermaidBlock() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid' || !parent || index == null) return;
      replaceWithHtml(parent, index, `<pre class="mermaid">${escapeHtml(node.value)}</pre>`);
    });
  };
}
