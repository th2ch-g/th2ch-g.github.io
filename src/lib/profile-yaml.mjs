// Shallow regex-based reader for src/content/profile.yaml. Lives in lib/ so
// both Astro-side .ts and build-time .mjs scripts can share one parse path.
// We avoid a real YAML dep because every field exposed here is a top-level
// scalar — `sync-citation-counts.mjs` already established this pattern.
//
// Path resolution uses `process.cwd()` rather than `import.meta.url` so the
// helper works equally from build-time scripts (running directly from src)
// and from Astro SSR chunks (where Vite has bundled this file under
// `dist/chunks/` and `import.meta.url` would point there). `npm run build`
// always invokes Node with the project root as CWD, so this is reliable.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PROFILE = resolve(process.cwd(), 'src/content/profile.yaml');

let cached;

export async function readProfileShallow() {
  if (cached) return cached;
  const text = await readFile(PROFILE, 'utf-8');
  // `icon` is a mapping (`icon:` block with `url:` / `comment:` children)
  // mirroring `links[].comment`; the legacy `icon: <scalar>` form is also
  // accepted so older forks continue to build without manual migration.
  const blockIconUrl = text.match(/^icon:\s*\n(?:\s+\S.*\n)*?\s+url:\s*(\S+)/m)?.[1];
  const flatIconUrl = text.match(/^icon:\s*(\S.*?)\s*$/m)?.[1];
  cached = {
    siteHandle: text.match(/^siteHandle:\s*(\S+)/m)?.[1],
    repo: text.match(/^repo:\s*(\S+)/m)?.[1],
    email: text.match(/^email:\s*(\S+)/m)?.[1],
    site: text.match(/^site:\s*(\S+)/m)?.[1],
    iconUrl: blockIconUrl || flatIconUrl,
  };
  return cached;
}

// GitHub Pages User-Page hostname implied by siteHandle. Used as the bare
// site identifier in HTTP User-Agent headers from build-time callers. Falls
// back to a generic "site" so a fork that hasn't filled in siteHandle still
// produces a valid (if uninformative) UA string instead of crashing the build.
export async function siteHost() {
  const { siteHandle } = await readProfileShallow();
  return siteHandle ? `${siteHandle}.github.io` : 'site';
}

// Deployment URL for `astro.config.mjs`. Resolution order:
//   1. explicit `site: https://...` in profile.yaml (custom domains)
//   2. `https://<owner>.github.io` from `repo: <owner>/<repo>` (the
//      common GitHub User/Org Pages case where this site lives)
//   3. localhost so dev still works on a fresh fork.
export async function siteUrl() {
  const { site, repo } = await readProfileShallow();
  if (site) return site;
  const owner = repo?.split('/')[0];
  return owner ? `https://${owner}.github.io` : 'http://localhost:4321';
}

// Source avatar URL for `scripts/build-icon.mjs`. Returns undefined when
// profile.yaml doesn't define one — the caller decides whether that's a
// hard failure (build-icon) or a soft skip.
export async function iconUrl() {
  const { iconUrl } = await readProfileShallow();
  return iconUrl;
}
