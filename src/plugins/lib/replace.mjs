// Replace `parent.children[index]` with a raw HTML node carrying `value`.
//
// Used by every remark plugin that promotes a Markdown node into a
// pre-rendered block of HTML (remark-twitter-embed, remark-github-card,
// remark-mermaid-block). Plugins that only retag a node — keeping its
// children as mdast — use `node.data.hName` directly instead (see
// remark-callouts, remark-figure-caption); those keep their mdast intact
// so downstream resolvers (notably `astro:assets`) can still see image
// URLs and friends.
//
// Centralising the raw-HTML path means every site that injects unescaped
// HTML is reachable from one grep — useful when auditing for XSS or for
// swapping the underlying mdast shape in a future Astro / remark upgrade.
// Callers remain responsible for escaping any untrusted substrings before
// passing them in.
export function replaceWithHtml(parent, index, value) {
  parent.children[index] = { type: 'html', value };
}
