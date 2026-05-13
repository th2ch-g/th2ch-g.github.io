import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

// Singleton MarkdownIt instance shared by every posts feed (site-wide,
// per-tag, ja/en). MarkdownIt is stateless across `.render()` calls, so a
// single parser is safe and avoids re-creating the same option object
// dozens of times per build. Pre-2024 Node would benefit even more from
// the cache; modern V8 inlines this regardless, but the shared instance
// also keeps configuration in one place.
//
// `html: false` disables raw HTML passthrough. The site's posts are
// authored as pure Markdown; allowing raw HTML in the feed pipeline only
// adds a stored-XSS surface that `sanitize-html` then has to scrub. Off-
// by-default is the more robust shape: a future change that disables or
// misconfigures sanitize-html cannot promote post body into executable
// markup in a downstream feed reader.
const parser = new MarkdownIt({ html: false, linkify: true });

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
};

// Render a markdown body string to RSS-safe HTML. KaTeX/Shiki-specific
// markup is dropped (no RSS reader can render it) so payloads stay
// compact and consistent across feeds.
export function renderFeedHtml(body: string): string {
  return sanitizeHtml(parser.render(body ?? ''), sanitizeOptions);
}

// Public WebSub hub. Subscribers ping this URL to receive push updates
// when the feed changes. Empty hub = no WebSub.
export const WEBSUB_HUB = 'https://pubsubhubbub.appspot.com/';

// Build the `customData` block injected into every posts RSS feed so the
// WebSub hub is discoverable at the channel level. `<atom:link rel="hub">`
// is the canonical advertise pattern (RFC 5988).
export function feedWebSubLinks(selfUrl: string): string {
  return [
    `<atom:link href="${selfUrl}" rel="self" type="application/rss+xml"/>`,
    `<atom:link href="${WEBSUB_HUB}" rel="hub"/>`,
  ].join('');
}

export const FEED_XMLNS = { atom: 'http://www.w3.org/2005/Atom' };
