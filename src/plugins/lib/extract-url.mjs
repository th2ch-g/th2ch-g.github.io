// Shared paragraph-URL detector for remark plugins. A "standalone URL"
// is a paragraph whose only meaningful child is a single link or text
// node matching the supplied pattern, optionally surrounded by
// whitespace-only siblings. Used by remark-twitter-embed and
// remark-github-card to decide whether to promote the paragraph into an
// embed / card.

export function extractStandaloneUrl(paragraph, urlPattern) {
  const children = paragraph.children.filter(
    (c) => !(c.type === 'text' && /^\s*$/.test(c.value)),
  );
  if (children.length !== 1) return null;
  const child = children[0];
  if (child.type === 'link' && urlPattern.test(child.url)) return child.url;
  if (child.type === 'text' && urlPattern.test(child.value.trim())) {
    return child.value.trim();
  }
  return null;
}
