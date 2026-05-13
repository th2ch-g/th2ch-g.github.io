import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';

// IndexNow ownership-verification key file. The protocol expects a single
// plaintext file at `/<key>.txt` containing exactly the key string.
//
// Astro can't generate a static path keyed off a runtime config string,
// so we expose it under a stable route (`/indexnow-key.txt`) AND expect
// the operator to add a redirect / symlink at deploy time if a search
// engine asks for `/<key>.txt`. For the canonical form, keep this file
// returning the literal key once `indexnow.key` is set in profile.yaml.
// `lang` is irrelevant for integration config; the JA flatten is reused.
export const GET: APIRoute = async () => {
  const indexnow = (await getProfileMeta('ja')).integrations.indexnow;
  if (!indexnow) {
    return new Response('IndexNow disabled', { status: 404 });
  }
  return new Response(indexnow.key, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
