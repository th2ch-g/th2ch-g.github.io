// Substitute `{{site}}`, `{{siteHandle}}`, `{{repo}}`, `{{repoUrl}}` in
// Markdown text / link / image URL nodes with values read from
// src/content/profile.yaml. Keeps legal pages and other content fork-safe
// without hardcoding the deployment URL or owner handle.
//
// Intentionally skips `code` / `inlineCode` nodes so posts can document the
// `{{site}}` syntax itself (e.g. in a "how this works" article) without the
// example being substituted away.
//
// IMPORTANT: We read profile.yaml inline rather than importing
// src/lib/profile-yaml.mjs. Astro pulls this plugin in through
// astro.config.mjs, and any helper imported here ends up on Vite's SSR
// chunk graph, where `import.meta.url`-based path resolution breaks when
// the chunk is later emitted under `dist/chunks/`. astro.config.mjs
// applies the same defensive pattern for the same reason.
import { visit } from 'unist-util-visit';
import { readFileSync } from 'node:fs';

const yaml = readFileSync('./src/content/profile.yaml', 'utf-8');
/** @param {string} key */
const read = (key) =>
  yaml.match(new RegExp(`^${key}:\\s*(\\S.*?)\\s*$`, 'm'))?.[1];

// Reject anything that doesn't look like an `http(s)://` URL or an
// owner/repo / handle identifier before exposing it to the substitution
// step. A malformed profile.yaml that put `javascript:alert(1)` into
// `site:` would otherwise slip a dangerous href into any Markdown link
// using `{{site}}`. Forks are an explicit use case (other people edit
// profile.yaml), so we cannot rely on the content schema alone — the
// schema is bypassed here because we read the file inline (see comment
// at the top of this module for why).
const isSafeUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const isSafeRepo = (s) => typeof s === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s);
const isSafeHandle = (s) => typeof s === 'string' && /^[\w.-]+$/.test(s);
const safe = (predicate, value) => (predicate(value) ? value : '');
const repo = safe(isSafeRepo, read('repo'));
const vars = {
  site: safe(isSafeUrl, read('site')),
  siteHandle: safe(isSafeHandle, read('siteHandle')),
  repo,
  repoUrl: repo ? `https://github.com/${repo}` : '',
};

const RE = /\{\{([a-zA-Z][\w]*)\}\}/g;
const replace = (s) => s.replace(RE, (m, k) => (k in vars ? vars[k] : m));

export function remarkProfileVars() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'text' && typeof node.value === 'string') {
        node.value = replace(node.value);
        return;
      }
      if (
        (node.type === 'link' || node.type === 'image') &&
        typeof node.url === 'string'
      ) {
        node.url = replace(node.url);
        // After substitution, a `{{var}}` URL backed by an empty profile
        // field becomes ''. Browsers resolve `<a href="">` to the current
        // page (= broken link) and `<img src="">` to a 404, so we splice
        // the now-degenerate node out: links collapse to their children
        // (the visible label), images disappear entirely. This keeps the
        // surrounding prose readable instead of leaking dangling markup.
        if (node.url === '' && parent && typeof index === 'number') {
          if (node.type === 'link') {
            parent.children.splice(index, 1, ...(node.children ?? []));
          } else {
            parent.children.splice(index, 1);
          }
          // Re-visit the same index so the inlined children (or the next
          // sibling after image removal) are processed by this visitor.
          return [visit.CONTINUE, index];
        }
      }
    });
  };
}
