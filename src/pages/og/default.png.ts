import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { renderSectionOg } from '@/lib/og-config';

// Default OG card — used by every page that doesn't supply a more
// specific image (home, archive, list pages, etc.). Title is the
// profile display name, description is the headline.
// See `renderSectionOg` for the shared composition.
export const GET: APIRoute = async () => {
  const meta = await getProfileMeta('ja');
  return renderSectionOg({
    lang: 'ja',
    title: meta.name,
    description: meta.headline ?? '',
    pageLabel: 'Home',
  });
};
