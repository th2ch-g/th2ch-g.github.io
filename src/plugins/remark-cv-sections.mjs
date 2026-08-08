// Remark plugin: turn the CV's HTML-comment markers into data attributes.
//
// The CV markdown declares which lists hold which kind of entry:
//
//   ## [論文(査読付き)](https://orcid.org/...)
//   <!-- cv:section peer-reviewed -->
//   1. ...
//   <!-- /cv:section -->
//
// Every top-level list inside the marked region gets
// `data-cv-section="<kind>"`, and the marker nodes themselves are dropped
// so they never reach the rendered HTML. This is the ONLY contract for
// "which section holds publications" — heading text is free-form and may
// be renamed or translated without breaking anything downstream
// (CVPage.astro's BibTeX buttons / clipboard fonts, and the
// orcid-cv-sync skill's insertion points).
//
// Markers must sit OUTSIDE the list. A comment line placed between list
// items splits the `<ol>` in two, which restarts CommonMark's auto
// numbering and renders every entry as "1." — see CLAUDE.md.
//
// The other half of the CV's self-contained config — the ORCID iD the sync
// script pulls from — lives in the CV's frontmatter, not here.

const SECTION_START = /^<!--\s*cv:section\s+([a-z][a-z0-9-]*)\s*-->$/;
const SECTION_END = /^<!--\s*\/cv:section\s*-->$/;

// Kinds CVPage.astro knows how to act on. Anything else is almost
// certainly a typo, and a silent typo means the BibTeX button quietly
// disappears — warn at build time instead.
const KNOWN_KINDS = new Set(['funding', 'peer-reviewed', 'preprints', 'presentations']);

export function remarkCvSections() {
  return (tree) => {
    let kind = null;
    const drop = new Set();

    tree.children.forEach((node, index) => {
      if (node.type === 'html') {
        const raw = node.value.trim();
        const start = raw.match(SECTION_START);
        if (start) {
          kind = start[1];
          if (!KNOWN_KINDS.has(kind)) {
            console.warn(
              `[remark-cv-sections] unknown section kind "${kind}" — ` +
                `expected one of ${[...KNOWN_KINDS].join(', ')}`,
            );
          }
          drop.add(index);
          return;
        }
        if (SECTION_END.test(raw)) {
          kind = null;
          drop.add(index);
        }
        return;
      }
      if (kind && node.type === 'list') {
        node.data = node.data ?? {};
        node.data.hProperties = {
          ...(node.data.hProperties ?? {}),
          'data-cv-section': kind,
        };
      }
    });

    if (drop.size > 0) {
      tree.children = tree.children.filter((_, index) => !drop.has(index));
    }
  };
}
