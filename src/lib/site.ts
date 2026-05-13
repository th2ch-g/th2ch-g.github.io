import type { APIContext } from 'astro';

// Resolves the configured deployment URL from the Astro context, throwing a
// readable error if `site` is missing from `astro.config.mjs`. `context.site`
// is typed `URL | undefined` even though the project always sets `site:`
// (derived from `profile.yaml`'s `repo`/`site` at the top of
// `astro.config.mjs`). Centralising the assertion here lets feed and sitemap
// builders work with a plain `URL` and removes every `context.site!` in the
// codebase — if the field is ever blanked out by mistake, the build fails
// with a message that names the actual fix rather than a generic non-null
// assertion error.
export function requireSite(context: APIContext): URL {
  if (!context.site) {
    throw new Error(
      'astro.config.mjs must define `site` (resolved from profile.yaml repo/site)',
    );
  }
  return context.site;
}
