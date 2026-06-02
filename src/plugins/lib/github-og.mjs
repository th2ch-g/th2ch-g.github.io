// Shared helpers for GitHub repo OG cards, imported by BOTH the remark
// plugin (render time, src/plugins/remark-github-card.mjs) and the
// prebuild downloader (scripts/build-github-og.mjs). Keeping the repo-URL
// matcher and the self-hosted filename in one place guarantees the two
// sides always agree on the key — the downloader writes
// public/github-og/<key> and the plugin looks up the same <key>.

// Strict match: only canonical owner/repo URLs. Reject anything with an
// extra path segment (`/issues`, `/blob/main/...`, `/pull/123`, etc.) so
// in-body file/issue links are not mis-promoted into cards.
// - owner: 1–39 chars, alnum or hyphens (GitHub username spec, simplified)
// - repo: 1–100 chars, alnum + `._-`
export const REPO_URL = /^https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/?$/;

// Deterministic on-disk / on-site filename for a repo's self-hosted OG
// image. Lower-cased so a URL's owner/repo casing (GitHub is
// case-insensitive) can never split one repo across two files.
export function ogFilename(owner, repo) {
  return `${owner}__${repo}`.replace(/[^A-Za-z0-9._-]/g, '_').toLowerCase() + '.png';
}

// GitHub's auto-generated social-preview image (the same one Twitter /
// Slack render). The leading `/1/` path segment is a generic cache key;
// the service redirects to the current hash internally. Used as the
// download source and as the runtime fallback when the self-hosted copy
// is absent (offline build etc.).
export function ogRemoteUrl(owner, repo) {
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}
