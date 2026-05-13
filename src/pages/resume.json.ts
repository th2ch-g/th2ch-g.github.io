import type { APIContext } from 'astro';
import { getProfileMeta } from '@/lib/content';

// JSON Resume schema (https://jsonresume.org/schema/) — a stable, portable
// representation of a CV. Many tools (HackMyResume, jsonresume-theme-*,
// resumake.io, integrations with LinkedIn) consume this format. The English
// locale is used as the canonical source for `summary` / `label` since most
// JSON Resume consumers expect English.
export async function GET(_context: APIContext) {
  const meta = await getProfileMeta('en');
  const resume = {
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: {
      name: meta.name,
      label: meta.headline,
      image: meta.icon,
      email: meta.email,
      summary: meta.affiliation,
      location: meta.location ? { city: meta.location } : undefined,
      profiles: meta.links.map((l) => ({
        network: l.label,
        url: l.url,
        // JSON Resume's `username` is best-effort; we extract the trailing
        // path segment which works for github.com/user, orcid.org/0000-...,
        // huggingface.co/user, etc. Empty when the URL has no useful tail.
        username: new URL(l.url).pathname.replace(/^\/+|\/+$/g, '').split('/').pop() || undefined,
      })),
    },
  };
  return new Response(JSON.stringify(resume, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Allow tools (LinkedIn import, jsonresume CLI) to fetch this from
      // any origin without a CORS dance.
      'access-control-allow-origin': '*',
    },
  });
}
