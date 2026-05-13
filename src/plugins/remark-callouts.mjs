import { visit } from 'unist-util-visit';

// GitHub-style callouts (a.k.a. admonitions). Authors write:
//
//     > [!NOTE]
//     > A note for the reader.
//
//     > [!WARNING]
//     > Heads up — this changes behavior in v3.
//
// The first line of a blockquote that matches `[!TYPE]` is consumed; the
// remaining children are rendered inside `<aside class="callout callout-{type}">`
// with a small icon header. Anything that doesn't match the pattern stays
// as a normal blockquote.

const TYPES = {
  note: { label: 'Note', icon: 'info' },
  tip: { label: 'Tip', icon: 'lightbulb' },
  important: { label: 'Important', icon: 'flag' },
  warning: { label: 'Warning', icon: 'alert' },
  caution: { label: 'Caution', icon: 'octagon' },
};

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

// Single-glyph, currentColor SVG icons (Lucide, ISC). Inlined so callouts
// have zero asset dependencies.
const ICONS = {
  info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  lightbulb: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M2 9a10 10 0 0 1 20 0c0 3-2 5-3.5 6S15 17 14 18h-4c-1-1-2-2-3.5-3S2 12 2 9z"/></svg>',
  flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  alert: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  octagon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

export function remarkCallouts() {
  return (tree) => {
    visit(tree, 'blockquote', (node) => {
      const first = node.children?.[0];
      if (!first || first.type !== 'paragraph') return;
      const firstText = first.children?.[0];
      if (!firstText || firstText.type !== 'text') return;
      const match = MARKER.exec(firstText.value);
      if (!match) return;

      const type = match[1].toLowerCase();
      const meta = TYPES[type];
      if (!meta) return;

      // Strip the marker from the first text node. If that empties the
      // node out completely, remove it; if it also empties the paragraph,
      // remove the paragraph too. Keeps rendered output tidy when the
      // marker sits on its own line (the common GitHub form).
      const remainder = firstText.value.replace(MARKER, '').trimStart();
      if (remainder) {
        firstText.value = remainder;
      } else {
        first.children.shift();
        if (first.children.length === 0) node.children.shift();
      }

      // Promote blockquote -> aside via mdast-util-to-hast metadata.
      // hName overrides the tag; hProperties projects HTML attributes.
      node.data = node.data ?? {};
      node.data.hName = 'aside';
      node.data.hProperties = {
        className: ['callout', `callout-${type}`],
        role: 'note',
      };
      node.children.unshift({
        type: 'html',
        value: `<div class="callout-header">${ICONS[meta.icon]}<span>${meta.label}</span></div>`,
      });
    });
  };
}
