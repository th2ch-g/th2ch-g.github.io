// Remark plugin: convert a standalone X/Twitter status URL on its own line
// into a `<blockquote class="twitter-tweet">` block. The blockquote is later
// upgraded into a rich preview by Twitter's widgets.js loaded on the page.
import { visit } from 'unist-util-visit';
import { escapeHtml } from './lib/escape.mjs';
import { extractStandaloneUrl } from './lib/extract-url.mjs';
import { replaceWithHtml } from './lib/replace.mjs';

// Strict match: only canonical status URLs on twitter.com / x.com / mobile.twitter.com.
// Trailing query string (e.g. `?s=20`) is allowed; path suffixes like `/photo/1` are not.
const TWITTER_URL = /^https?:\/\/(?:twitter\.com|x\.com|mobile\.twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\?[^\s]*)?\/?$/;

export function remarkTwitterEmbed() {
  return (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index == null || !parent) return;
      const url = extractStandaloneUrl(node, TWITTER_URL);
      if (!url) return;
      // Wrap in a flex div so the rendered <twitter-widget> ends up centered.
      // data-dnt opts the embed out of personalized tracking.
      // The TWITTER_URL regex permits `?[^\s]*` query strings, which can
      // legally contain `"` or `>` — escapeHtml is a defense-in-depth pass
      // so the URL can't break out of the `href="..."` attribute.
      const safe = escapeHtml(url);
      const html = `<div class="tweet-embed"><blockquote class="twitter-tweet" data-dnt="true"><a href="${safe}"></a></blockquote></div>`;
      replaceWithHtml(parent, index, html);
    });
  };
}
